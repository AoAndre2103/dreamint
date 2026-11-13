#!/usr/bin/env bash
# DreaMint deploy (DO NOT RUN without Andrea's explicit OK).
# v23 (2026-11-13): fees/plans frontend (fees1) + admin sees/searches private albums, admin soft removal
#   of listings/cards, POST /api/cards double-submit dedup (migrate-v22: slabs.submit_fingerprint),
#   admin notifications to every admin, private profiles visible without cards, Assistenza
#   (migrate-v23: support_requests). Baseline: production f749c0c8 (.live-base = its public/).
# Folder: this script's directory. MIGRATIONS = migrate-v1*.sql present in the folder.
#   dreamint-deploy-v13b -> deploys on top of the live f749c0c8 (test-card admin visibility + share.js nu1, published 2026-11-12 21:45):
#     QA fixes, ungraded/archive, A/B, M4 + video-sfida (v15), username/album (v16),
#     two markets + cert search (v17), chat + /c/ live owners + social stamp (v18),
#     reserved_sale_id safety (v19), no listing reservation until payment (v20),
#     transfer-code rotation on every ownership change (v21), with the frontend.
#     v13 is already applied on the live DB: its probe skips it. v19 is skipped if the v12 column exists.
#   ./DEPLOY.sh --sync  first copies /workspace/gemint-beta/{public,functions,tests,migrate-v1*.sql,migrate-v2[0-9].sql} here.
#   Previous live baseline was 77f2cc55 (email verification). .live-base/ is a snapshot of f749c0c8 public/ (6223ccbd + share.js?v=20261112nu1).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
if [[ "${1:-}" == "--sync" ]]; then
  SRC=/workspace/gemint-beta
  rm -rf public functions tests && cp -a $SRC/public public && cp -a $SRC/functions functions && cp -a $SRC/tests tests
  cp $SRC/schema.sql .
  cp $SRC/migrate-v1[3-9].sql . 2>/dev/null || true
  cp $SRC/migrate-v2[0-9].sql . 2>/dev/null || true
  echo "synced from $SRC"
fi
MIGRATIONS="${MIGRATIONS:-$(ls migrate-v1[3-9].sql migrate-v2[0-9].sql 2>/dev/null | sort -V | tr '\n' ' ')}"
EXPECTED_PROD=f749c0c8
export WRANGLER_CACHE_DIR=/workspace/cf/.cache CLOUDFLARE_ACCOUNT_ID=ec79cd9d241edf28f5a5d59cb711e9af
q() { npx wrangler d1 execute gemint-beta --remote --json --command "$1" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"])'; }
has() { grep -q "$1" "functions/api/[[path]].js"; }

# 0. frontend/server compatibility guard (the server must not require what public/app.js cannot send)
if has challenge_video_required && ! grep -q '/video"' public/app.js; then
  echo "STOP: server requires the video-sfida but public/app.js still uploads the photo"; exit 1; fi
if has 'Scegli uno username' && ! grep -q 'name="username"' public/app.js; then
  echo "STOP: signup requires username but public/app.js does not send it"; exit 1; fi

# 1. backup
TS=$(date +%Y%m%d-%H%M)
tar czf /workspace/backups-dreamint-$TS.tgz --exclude=node_modules --exclude=.wrangler --exclude=screens -C /workspace gemint-beta "$(basename "$D")"
echo "backup: /workspace/backups-dreamint-$TS.tgz"

# 2. production must still be f749c0c8, or serve exactly the files of .live-base/ (snapshot of f749c0c8 public)
npx wrangler whoami >/dev/null
CUR=$(npx wrangler pages deployment list --project-name gemint-beta 2>/dev/null | grep -m1 Production | awk -F'│' '{print $2}' | tr -d ' ')
echo "production: $CUR"
if [[ "$CUR" != $EXPECTED_PROD* ]]; then
  echo "production is not $EXPECTED_PROD: comparing its files with .live-base/ ..."
  L="https://${CUR:0:8}.gemint-beta.pages.dev"; bad=0
  for f in $(cd .live-base && find . -type f ! -name _headers | sed 's|^\./||'); do
    u="$L/$f"; [[ "$f" == index.html ]] && u="$L/"; [[ "$f" == *.html && "$f" != index.html ]] && u="$L/${f%.html}"
    [[ "$(curl -sL "$u" | sha256sum)" == "$(sha256sum < ".live-base/$f")" ]] || { echo "  differs: $f"; bad=1; }
  done
  [[ $bad == 0 ]] || { echo "STOP: live public/ changed - rebuild this folder from the new live"; exit 1; }
fi

# 3. checks
for f in $(find functions public -name '*.js'); do node --check "$f"; done
node --test tests/*.mjs
q "SELECT COUNT(*) users, SUM(role='admin') admins FROM users"
q "SELECT COUNT(*) slabs, SUM(is_ungraded) ungraded, SUM(status='in_review') in_review FROM slabs"
q "SELECT COUNT(*) open_sales FROM sales WHERE status IN ('requested','accepted','paid','shipped')"

# 4. migrations (additive, only if missing). v13 marks every existing user as verified (only allowed UPDATE).
for m in $MIGRATIONS; do
  case $m in
    migrate-v13.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='email_verified_at'";;
    migrate-v14.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('slabs') WHERE name='archived_at'";;
    migrate-v15.sql) probe="SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='challenge_codes'";;
    migrate-v16.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='username'";;
    migrate-v17.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('listings') WHERE name='kind'";;
    migrate-v18.sql) probe="SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='conversations'";;
    migrate-v19.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('listings') WHERE name='reserved_sale_id'";;
    migrate-v20.sql) probe="SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_sales_one_paid'";;
    migrate-v21.sql) probe="SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='transfer_code_reveals'";;
    migrate-v22.sql) probe="SELECT COUNT(*) n FROM pragma_table_info('slabs') WHERE name='submit_fingerprint'";;
    migrate-v23.sql) probe="SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='support_requests'";;
    *) echo "unknown migration $m"; exit 1;;
  esac
  if [[ "$(q "$probe")" == "[{'n': 0}]" ]]; then echo "applying $m"; npx wrangler d1 execute gemint-beta --remote --file "$m"; else echo "$m already applied"; fi
done
[[ " $MIGRATIONS " == *" migrate-v15.sql "* ]] && q "SELECT COUNT(*) n FROM pragma_table_info('challenge_codes') WHERE name='video_key'"   # expect n = 1
[[ " $MIGRATIONS " == *" migrate-v16.sql "* ]] && q "SELECT COUNT(*) users, SUM(username IS NOT NULL) with_username, SUM(album_public) public_albums FROM users"   # expect 0 / 0
[[ " $MIGRATIONS " == *" migrate-v17.sql "* ]] && q "SELECT COUNT(*) listings, SUM(kind IS NULL) legacy_fullset FROM listings"   # expect all legacy (kind NULL)
[[ " $MIGRATIONS " == *" migrate-v19.sql "* ]] && q "SELECT COUNT(*) n FROM pragma_table_info('listings') WHERE name='reserved_sale_id'"   # expect n = 1
[[ " $MIGRATIONS " == *" migrate-v20.sql "* ]] && q "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_sales_one_paid'"   # expect n = 1
[[ " $MIGRATIONS " == *" migrate-v21.sql "* ]] && q "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='transfer_code_reveals'"   # expect n = 1
[[ " $MIGRATIONS " == *" migrate-v22.sql "* ]] && q "SELECT COUNT(*) n, (SELECT COUNT(*) FROM slabs WHERE submit_fingerprint IS NOT NULL) filled FROM pragma_table_info('slabs') WHERE name='submit_fingerprint'"   # expect n = 1, filled = 0
[[ " $MIGRATIONS " == *" migrate-v23.sql "* ]] && q "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='support_requests'"   # expect n = 1
q "SELECT COUNT(*) users, SUM(email_verified_at IS NULL) unverified FROM users"   # expect unverified = 0
MIG_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 5. deploy
npx wrangler pages deploy public --project-name gemint-beta --branch main --commit-dirty=true

# 6. live checks (non-destructive)
B=https://dreamint.it; sleep 5
curl -s -o /dev/null -w 'home %{http_code}\n' $B/
curl -s $B/api/launch | python3 -c 'import json,sys; s=json.load(sys.stdin)["launch"]["effective_state"]; print("launch", s); assert s=="BETA"'
curl -s $B/ | grep -o 'app.js?v=[^"]*' || true
curl -s -o /dev/null -w 'verify-email bad token -> %{http_code} %{redirect_url}\n' "$B/api/auth/verify-email?token=x"
curl -s -X POST "$B/api/paypal/webhook" -H 'content-type: application/json' -d '{}' -w ' (unsigned webhook, expect 400) %{http_code}\n'
if has issueChallenge; then curl -s -X POST "$B/api/cards/challenge" -H "origin: $B" -w ' (guest challenge, expect 401) %{http_code}\n'; fi
if has searchUsers; then
  curl -s -o /dev/null -w 'users/search?q=a (expect 400) %{http_code}\n' "$B/api/users/search?q=a"
  curl -s -o /dev/null -w 'users/x/album unknown (expect 404) %{http_code}\n' "$B/api/users/nessuno_qa_x/album"
  curl -s $B/api/config | python3 -c 'import json,sys; print("sold_outside_archive", json.load(sys.stdin).get("sold_outside_archive"))'
fi
if has searchCert; then
  curl -s -o /dev/null -w 'search/cert?q=a (expect 400) %{http_code}\n' "$B/api/search/cert?q=a"
  curl -s -o /dev/null -w 'market (expect 200) %{http_code}\n' "$B/api/market"
fi
curl -s -o /dev/null -w 'share.js nu1 (expect 200) %{http_code}\n' "$B/js/share.js?v=20261112nu1"
curl -s $B/ | grep -o '?v=20261112fees1\|?v=20261112nu1\|?v=20261113adm1' | sort | uniq -c
curl -s -o /dev/null -w 'admin DELETE card as guest (expect 401) %{http_code}\n' -X DELETE -H "origin: $B" "$B/api/admin/cards/x"
curl -s "$B/api/users/search?q=naso" -w ' (guest search naso)\n'
curl -s -o /dev/null -X POST -H "origin: $B" -H 'content-type: application/json' -d '{}' -w 'guest POST /api/support (expect 401) %{http_code}\n' "$B/api/support"
if has handleChatRoutes; then
  curl -s -o /dev/null -w 'guest conversations (expect 401) %{http_code}\n' "$B/api/conversations"
fi
q "SELECT id, created_at FROM users WHERE email_verified_at IS NULL AND created_at <= '$MIG_AT'"   # signups between migration and deploy
