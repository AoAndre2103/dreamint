# DreaMint

Marketplace italiano per collezionisti di carte TCG (Pokémon, Magic, Yu-Gi-Oh!, One Piece, Lorcana): https://dreamint.it

Il progetto Cloudflare Pages si chiama **gemint-beta** e usa Functions, D1 e KV. Questo repository è pensato per restare **privato** (nome previsto su GitHub: `dreamint`).

Oggi il sito è in **beta gratuita, senza commissioni**. I pagamenti avvengono **direttamente tra le persone tramite PayPal** (Beni e servizi / WPS): DreaMint non tiene mai i soldi e non intermedia il pagamento. In chat e negli annunci va ricordato di chiudere la trattativa sul sito e di pagare con PayPal Beni e servizi: fuori dal sito si perdono la protezione acquisti PayPal, lo storico della chat e la possibilità di segnalare l’utente.

## Struttura della cartella

```
functions/                 # Cloudflare Pages Functions (API e pagine /c/)
  api/[[path]].js          # API principale
  c/[[path]].js            # pagina pubblica di verifica della copia digitale
  lib/                     # librerie server (mercati, chat, PayPal, lancio, …)
  _middleware.js
public/                    # frontend (v9b + estrazione reveal-v2 / rv3)
  js/  img/  fonts/  icons/  legal/
tests/                     # test Node (node:test), più fixtures video della sfida
  fixtures-video/
scripts/process-logo.py    # genera i file logo da logo-source.webp
docs/screens/              # poche screenshot di riferimento (retri e funzioni v9)
schema.sql                 # schema completo per un database locale nuovo (già con v2–v21)
migrate-v2.sql … v21.sql   # migrazioni additive, da applicare in ordine sul D1 di produzione
wrangler.toml              # progetto Pages, binding D1/KV e variabili pubbliche
DEPLOY.sh                  # script di deploy usato in ambiente interno: non eseguirlo
                           # senza un ok esplicito; contiene percorsi della macchina di lavoro
```

Non commettere mai `.env`, `.dev.vars`, backup `*.tgz`, lo stato locale di wrangler o file con password e chiavi.

## Avvio in locale

Serve Node.js e [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npx wrangler`, dopo `npx wrangler login` sul tuo account).

1. Crea il database D1 **locale** (solo la prima volta, o dopo aver cancellato `.wrangler/`):

```bash
npx wrangler d1 execute gemint-beta --local --file=schema.sql
```

Su un database nuovo basta `schema.sql`: contiene già le tabelle e le colonne fino a v21. **Non** rilanciare dopo anche `migrate-v2.sql` … `migrate-v21.sql` sullo stesso database, perché gli `ALTER TABLE` fallirebbero sulle colonne già presenti.

2. Avvia il sito in locale (legge `wrangler.toml`, quindi D1 e KV locali):

```bash
npx wrangler pages dev
```

Per i segreti in locale crea un file `.dev.vars` (è già nel `.gitignore`) e metti solo i nomi che ti servono, per esempio `RESEND_API_KEY=...`. Non copiare valori di produzione in questo repository.

3. Per un utente admin in locale: registrati dal form di iscrizione, poi nel D1 locale imposta `role = 'admin'` sulla tua riga in `users`. Non commettere hash di password.

## Migrazioni (produzione)

Le migrazioni `migrate-v2.sql` … `migrate-v21.sql` sono **additive** e si applicano **in ordine** al D1 remoto, solo se quella versione non è già presente. Non usarle su un database creato da zero con `schema.sql`.

```bash
npx wrangler d1 execute gemint-beta --remote --file=migrate-vXX.sql
```

`DEPLOY.sh` per le v13–v21 fa prima una sonda (`pragma_table_info` / `sqlite_master`) e salta la migrazione se è già applicata. In particolare:

- **v13** è già applicata sul database di produzione; la sonda la salta. Attenzione: v13 è l’unica che scrive sulle righe esistenti (segna come verificati gli utenti già registrati).
- **v19** (`listings.reserved_sale_id`) va saltata se la colonna esiste già da v12 (in produzione c’è già).
- **v20** sostituisce l’indice unico: dopo il pagamento confermato, non alla sola accettazione dell’offerta.

Prima di applicare una migrazione nuova, fai un backup del progetto e controlla la sonda.

## Deploy

Il progetto Pages si chiama `gemint-beta`. Prima di pubblicare: backup, test, migrazioni mancanti, poi il deploy. Non pubblicare senza un ok esplicito.

```bash
# backup prima (esempio)
tar czf ../backup-dreamint-$(date +%Y%m%d-%H%M).tgz --exclude=node_modules --exclude=.wrangler --exclude=.git .

node --test tests/*.mjs

npx wrangler pages deploy public --project-name gemint-beta
```

`DEPLOY.sh` automatizza backup, controlli, migrazioni v13–v21 e il deploy, ma è pensato per la macchina di lavoro interna (percorsi `/workspace`, confronto con un deployment di produzione atteso). Usalo solo se lo hai adattato e hai l’ok.

## Variabili e segreti

I **valori dei segreti non stanno in questo repository**. In produzione si impostano come segreti di Cloudflare Pages (`wrangler pages secret put NOME` o dalla dashboard). Qui sotto solo i **nomi**.

### Variabili pubbliche (`wrangler.toml` → `[vars]`)

- `CONTACT_EMAIL`
- `LAUNCH_PUBLIC_DATE`, `LAUNCH_PUBLIC_DATE_LABEL`
- `OFFER_DAYS` (giorni della promo di lancio, default 15)
- `FEE_OFFER_BPS`, `FEE_AFTER_BPS` (commissioni in punti base; in beta restano a zero finché lo stato di lancio non è `MONETIZATION_ENABLED`)
- `PAYPAL_ENV` (`live` o `sandbox`)
- `PAYPAL_AUTO` (`wps`, `off` / `manual`, oppure vuoto per usare REST se ci sono i segreti)
- `PAYPAL_AUTOCOMPLETE_DAYS`
- `OWNER_EMAILS` (lista di contatto del titolare; **non** assegna più il ruolo admin in automatico: l’admin sta solo in `users.role` nel D1)
- `NOTIFY_EMAIL`, `NOTIFY_PROVIDER`, `NOTIFY_FROM`

Gli id di D1 (`database_id`) e KV (`id`) in `wrangler.toml` non sono segreti e restano nel file. Non metterci mai un token API.

### Segreti (solo per nome, da impostare in Pages / `.dev.vars`)

- `RESEND_API_KEY` oppure `BREVO_API_KEY` (in alternativa si accetta anche `NOTIFY_API_KEY`): senza uno di questi l’invio email resta spento
- `RESEND_API_URL` (opzionale, override dell’endpoint Resend)
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (opzionali: servono solo per la modalità REST; oggi il default è PayPal WPS + IPN, senza credenziali REST)

Binding in `wrangler.toml`: D1 `DB` (database `gemint-beta`), KV `PHOTOS`.

## Macchina a stati della beta

Lo stato di lancio vive sul server (`functions/lib/launch-state.js`), non nel browser. Se manca la riga in `app_settings`, lo stato effettivo è **BETA**.

Transizioni permesse, **solo con ok del titolare** (un admin deve confermare con la frase `CONFERMO`, e ogni cambio è scritto in `launch_state_log`):

```
BETA → LAUNCH_PROMO → PROMO_ENDED → MONETIZATION_ENABLED
```

Dettagli:

- Da `LAUNCH_PROMO` si può tornare a `BETA` (valvola di sicurezza, comunque tracciata).
- Da `PROMO_ENDED` si può tornare a `BETA`.
- Da `MONETIZATION_ENABLED` si può solo tornare a `PROMO_ENDED`.
- Se la promo è scaduta, il sito mostra già `PROMO_ENDED` anche prima che un admin muova lo stato.
- Le commissioni si applicano **solo** quando lo stato effettivo è `MONETIZATION_ENABLED`.

## PayPal (pagamenti diretti)

DreaMint non riceve e non trattiene i pagamenti. Il compratore paga il venditore con PayPal; il sito registra lo stato della vendita (richiesta, pagamento confermato, spedizione). Senza `PAYPAL_WEBHOOK_ID` un webhook REST non viene accettato. L’accettazione di un’offerta **non** prenota più l’annuncio: Full Set e Solo digitale restano acquistabili in parallelo finché un pagamento non è confermato (migrazione v20).

## Test

I test non richiedono wrangler né il database: importano solo le librerie in `functions/`.

```bash
node --test tests/*.mjs
```

Le clip in `tests/fixtures-video/` servono ai test della video-sfida: vanno commesse. Non commettere invece i video grandi di demo (estrazioni registrate, e così via).

## Logo

`logo-source.webp` è il master. Per rigenerare le varianti in `public/`:

```bash
python3 scripts/process-logo.py
```
