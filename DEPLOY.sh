#!/usr/bin/env bash
# DreaMint deploy - PORTABILE (funziona su qualsiasi macchina, nessun percorso /workspace).
# NON eseguire senza l'ok esplicito di Andrea.
# Requisiti: node >= 18, npx, python3, curl, account Cloudflare con accesso al progetto Pages
#   "gemint-beta" e al DB D1 "gemint-beta" (login: npx wrangler login, oppure CLOUDFLARE_API_TOKEN).
# Uso:   ./DEPLOY.sh            (chiede conferma prima di migrazioni e deploy)
#        ./DEPLOY.sh --yes      (nessuna domanda)
#        ./DEPLOY.sh --dry-run  (solo backup + controlli, non tocca DB né sito)
# Variabili opzionali: BACKUP_DIR (default ./backups), EXPECTED_PROD (prefisso id deploy atteso:
#   se impostato e la produzione è diversa, si ferma), CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
YES=0; DRY=0
for a in "$@"; do case $a in --yes) YES=1;; --dry-run) DRY=1;; *) echo "opzione sconosciuta: $a"; exit 1;; esac; done
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ec79cd9d241edf28f5a5d59cb711e9af}"
export WRANGLER_CACHE_DIR="${WRANGLER_CACHE_DIR:-$D/.wrangler-cache}"
BACKUP_DIR="${BACKUP_DIR:-$D/backups}"; mkdir -p "$BACKUP_DIR"
for c in node npm python3 curl; do command -v $c >/dev/null || { echo "STOP: manca $c"; exit 1; }; done
[[ -x node_modules/.bin/wrangler ]] || npm install --no-audit --no-fund >/dev/null
W() { "$D/node_modules/.bin/wrangler" "$@"; }
q() { W d1 execute gemint-beta --remote --json --command "$1" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"])'; }
confirm() { [[ $YES == 1 ]] && return 0; read -r -p "$1 [s/N] " r; [[ "$r" =~ ^[sSyY]$ ]]; }
has() { grep -q "$1" "functions/api/[[path]].js"; }

# 0. login + compatibilità frontend/server
W whoami >/dev/null || { echo "STOP: esegui prima: npx wrangler login"; exit 1; }
if has 'Scegli uno username' && ! grep -q 'name="username"' public/app.js; then
  echo "STOP: il server richiede lo username ma public/app.js non lo invia"; exit 1; fi

# 1. backup: codice + dump completo del DB di produzione
TS=$(date +%Y%m%d-%H%M)
tar czf "$BACKUP_DIR/code-$TS.tgz" --exclude=node_modules --exclude=.wrangler --exclude=.wrangler-cache --exclude=backups -C "$D" .
W d1 export gemint-beta --remote --output "$BACKUP_DIR/db-$TS.sql"
echo "backup: $BACKUP_DIR/code-$TS.tgz + $BACKUP_DIR/db-$TS.sql"

# 2. produzione attuale (solo informativo, a meno che EXPECTED_PROD sia impostato)
CUR=$(W pages deployment list --project-name gemint-beta 2>/dev/null | grep -m1 Production | awk -F'│' '{print $2}' | tr -d ' ' || true)
echo "produzione attuale: ${CUR:-sconosciuta}"
if [[ -n "${EXPECTED_PROD:-}" && "$CUR" != $EXPECTED_PROD* ]]; then
  echo "STOP: la produzione non è $EXPECTED_PROD (qualcuno ha pubblicato dopo?)"; exit 1; fi

# 3. controlli
for f in $(find functions public -name '*.js'); do node --check "$f"; done
node --test tests/*.mjs
q "SELECT COUNT(*) users, SUM(role='admin') admins FROM users"
q "SELECT COUNT(*) open_sales FROM sales WHERE status IN ('requested','accepted','paid','shipped')"
[[ $DRY == 1 ]] && { echo "dry-run: fine (nessuna modifica)"; exit 0; }

# 4. migrazioni additive: applicate solo se mancano (sonda su colonna/tabella)
probe() { case $1 in
  migrate-v13.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='email_verified_at'";;
  migrate-v14.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('slabs') WHERE name='archived_at'";;
  migrate-v15.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='challenge_codes'";;
  migrate-v16.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='username'";;
  migrate-v17.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('listings') WHERE name='kind'";;
  migrate-v18.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='conversations'";;
  migrate-v19.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('listings') WHERE name='reserved_sale_id'";;
  migrate-v20.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_sales_one_paid'";;
  migrate-v21.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='transfer_code_reveals'";;
  migrate-v22.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('slabs') WHERE name='submit_fingerprint'";;
  migrate-v23.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='support_requests'";;
  migrate-v26.sql) echo "SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='plan'";;
  migrate-v27.sql) echo "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='reviews'";;
  *) echo "";; esac; }
MIGS=$(ls migrate-v1[3-9].sql migrate-v2[0-9].sql 2>/dev/null | sort -V)
confirm "Applicare le migrazioni mancanti sul DB di produzione?" || { echo "annullato"; exit 1; }
for m in $MIGS; do
  p=$(probe "$m"); [[ -z "$p" ]] && { echo "STOP: $m senza sonda: aggiungila in DEPLOY.sh"; exit 1; }
  if [[ "$(q "$p")" == "[{'n': 0}]" ]]; then echo "applico $m"; W d1 execute gemint-beta --remote --file "$m"; else echo "$m già applicata"; fi
done

# 5. deploy
confirm "Pubblicare public/ + functions/ su dreamint.it?" || { echo "annullato"; exit 1; }
W pages deploy public --project-name gemint-beta --branch main --commit-dirty=true

# 6. controlli live (non distruttivi)
B=https://dreamint.it; sleep 5
curl -s -o /dev/null -w 'home %{http_code}\n' $B/
curl -s $B/api/launch | python3 -c 'import json,sys; s=json.load(sys.stdin)["launch"]["effective_state"]; print("launch", s); assert s=="BETA"'
curl -s $B/ | grep -o 'app.js?v=[^"]*' || true
curl -s -X POST "$B/api/paypal/webhook" -H 'content-type: application/json' -d '{}' -o /dev/null -w 'webhook non firmato (atteso 400) %{http_code}\n'
curl -s -o /dev/null -X POST -H "origin: $B" -H 'content-type: application/json' -d '{}' -w 'POST /api/support da ospite (atteso 401) %{http_code}\n' "$B/api/support"
curl -s -o /dev/null -w 'DELETE admin da ospite (atteso 401) %{http_code}\n' -X DELETE -H "origin: $B" "$B/api/admin/cards/x"
echo "Deploy finito. Rollback: Cloudflare Pages > gemint-beta > Deployments > deploy precedente > Rollback; DB: $BACKUP_DIR/db-$TS.sql"
