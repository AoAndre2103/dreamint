## v35 — 2026-11-15 — Rubrica iscritti e inventari amministrativi (locale, NON pubblicata)

- Aggiunta la sezione Admin → Iscritti con directory alfabetica completa, ricerca nome/username/email, paginazione e contatori di carte/annunci.
- Scheda utente admin con Album (comprende elementi in verifica e album privati) e annunci Market attivi, foto e prezzo, paginazione separata, link ai dettagli.
- API di sola lettura `GET /api/admin/users` e `GET /api/admin/users/:id` protette da `requireAdmin`, risposte `no-store` e campi personali non esposti alle API pubbliche.
- 160 test automatici superati, inclusi accessi vietati, ordine alfabetico, wildcard, paginazione, card fisiche/digitali, private e in verifica. Nessuna migrazione del database e nessun deploy online.

## v34 — 2026-11-15 — Annunci chiusi automaticamente al riscatto (locale, NON pubblicata)

- Per carte gradate e non gradate, un annuncio nel Market non blocca più la **generazione del codice**. La carta resta in vendita finché il compratore non usa validamente il codice.
- Il **riscatto** della carta chiude automaticamente gli annunci collegati nella **stessa transazione** in cui trasferisce la proprietà e cancella/rinnova il codice. Le offerte non concluse vengono annullate; quelle convertite in vere vendite vengono protette dal blocco delle transazioni.
- Resta vietato trasferire carte con richieste d'acquisto o vendite in corso (`requested`, `accepted`, `paid`, `shipped`). Inserimenti di codice errato, scaduto o già speso non alterano gli annunci.
- Non gradate: una sola sezione dedicata al passaggio della carta (codice `DMU-...`, scadenza 30 giorni). Gradate: codice `DM-...` nel certificato. La separazione dei due flussi e i controlli di sicurezza v33 sono conservati.
- Messaggi e stato del pulsante aggiornati nelle lingue IT/EN. Asset JS frontend versionati con chiave v34 per impedire cache obsolete. Nessuna migrazione database aggiuntiva. Nessuna pubblicazione sul sito online.

# Changelog

Storia ricavata dal codice, dalle migrazioni e dal lavoro recente sul frontend. Le versioni del server (v13–v21) coincidono con i file `migrate-vN.sql`. Il frontend in questo albero è la v9b, con estrazione reveal-v2 revisione rv3.

## v33 — Sicurezza e usabilità dei trasferimenti (15 novembre 2026)

- Non gradate: percorso unico di trasferimento dall'Album; confermato end-to-end il caso «annuncio chiuso come venduta fuori» → generazione `DMU` → riscatto → cambio proprietario e monouso.
- Gradate: ripristinati e verificati generazione e riscatto `DM` nel certificato; un annuncio o una vendita aperti impediscono la procedura con istruzioni chiare.
- Corretto il rischio di doppio trasferimento contemporaneo: aggiornamento atomico del proprietario, codice e storico, con verifica dell'hash originario.
- Rigenerazione del codice gradata riservata al proprietario, protetta contro cambio proprietario concorrente; pulsante nascosto per gli altri utenti e spiegazione se bloccato.
- Notifiche email non bloccanti dopo l'avvenuto trasferimento; nuova versione degli script client per evitare codice precedente in cache.
- Verificato anche il percorso di riscatto con foto approvato dall'amministratore. Nessuna nuova migrazione database.

## v32 — 2026-11-15 — Market e Album (locale, NON pubblicata)

- **Galleria** rinominata **Market** in italiano e inglese, nei menu desktop/mobile, nella home e nel footer. Percorso principale `#/market`; i vecchi collegamenti `#/galleria`, `#/mercato` e i relativi filtri rimangono compatibili tramite reindirizzamento.
- La distinzione ora è esplicita: **Market** raccoglie gli annunci in vendita e mantiene i propri filtri; **Album** mostra inizialmente **Tutte** le carte personali e pubbliche, gradate e non gradate, senza filtro lingua separato per JPN.
- Conservato il trasferimento delle non gradate vendute fuori DreaMint tramite codice monouso. È necessaria `migrate-v32.sql` quando si pubblica la funzione.
- Nessun intervento su sito o database di produzione. Asset versionati per evitare versioni vecchie nel browser.

## v32 — 2026-11-15 — Trasferimento non gradate vendute fuori piattaforma (locale, NON pubblicata)

- Dall'**Album → Trasferisci / riscatta non gradata** o dal dettaglio di una carta propria si sceglie la non gradata venduta fuori DreaMint e si genera un **codice monouso** (`DMU-XXXXX-XXXXX-XXXXX-XXXXX`).
- Il codice è mostrato una sola volta al venditore (20 caratteri casuali, 100 bit di entropia); nel database è memorizzato solo l'hash SHA-256. Scade in 30 giorni; rigenerarlo invalida il precedente.
- L'acquirente accede con il proprio account con email verificata e riscatta il codice dalla stessa pagina: la **registrazione esistente** passa dal vecchio al nuovo album, con **foto fronte/retro e modello TCGdex invariati**. Non si crea una nuova carta e non viene simulato alcun pagamento.
- L'operazione conserva la cronologia proprietari e l'audit. Il prezzo richiesto viene azzerato e la carta torna allo stato `approved` senza un annuncio di vendita del nuovo proprietario. Codici usati non sono riutilizzabili.
- Blocco server in presenza di annunci (`active`, `reserved`, `paused`) o vendite (`requested`, `accepted`, `paid`, `shipped`) in corso. La carta deve essere non gradata, approvata, appartenere al venditore; sono supportate anche le non gradate **già archiviate con motivo `sold_outside`** (ma non quelle eliminate volontariamente).
- Nuova tabella `ungraded_transfer_codes` (`migrate-v32.sql`) con applicazione assistita da `DEPLOY.sh`, rate limit e verifica email. API `GET /api/ungraded-transfers/eligible`, `POST /api/cards/:id/ungraded-transfer-code`, `POST /api/ungraded-transfers/redeem`.
- La vecchia azione «Ho venduto fuori DreaMint» ora conduce al **trasferimento** anziché limitarsi a togliere la carta dall'album. Il vecchio endpoint di archiviazione resta compatibile ma non è più l'azione primaria.
- Il caricamento della v31 Galleria è incluso. Versioni asset sincronizzate per `app.js`, `strings-v2.js`, `v2-theme.css`; aggiornati anche `i18n.js` e `styles.css` per limitare i file obsoleti in cache.
- Test reali API Node/SQLite su riscatto, permessi, codici scaduti, uso singolo, trasferimento da archivio, annunci/vendite e collegamento album. Nessun database di produzione o sito online modificato.

## v31 — 2026-11-15 — Galleria unificata (locale, NON pubblicata)

- Nuova voce **Galleria** nel menu desktop/mobile e nel footer (`#/galleria`), con caricamento immediato degli annunci gradati e non gradati nella stessa griglia.
- **Tutte / Gradate / Non gradate** sono filtri visivi del medesimo elenco: non servono più scelte preliminari per visualizzare gli annunci. Restano i filtri per gioco e l'ordinamento per prezzo, nome e data.
- Link diretti `#/galleria/gradate` e `#/galleria/non-gradate` applicano solo una selezione iniziale, revocabile con **Tutte**. Le vecchie URL `#/gradate` e `#/non-gradate` reindirizzano ai filtri equivalenti; i vecchi sottopercorsi di rarità e condizione rimangono utilizzabili.
- La home e il footer aprono la nuova Galleria. Nessun cambiamento agli annunci, alle offerte, ai prezzi, ai certificati e alle API. Non richiede nuove migrazioni.
- Test unitari: 131/131; test interattivo del componente in Chromium headless per filtri e selezione iniziale. Il caricamento del sito via server locale non è stato verificabile per una restrizione del browser di test; nessun deploy effettuato.

## v30 — 2026-11-15 — Fai un’offerta e offerte al venditore (locale, NON pubblicato)

- Nella pagina di ogni annuncio attivo, gli utenti registrati possono usare **Fai un’offerta** per proporre un importo inferiore al prezzo richiesto e lasciare un messaggio (nessuna prenotazione e nessun pagamento al solo invio).
- Nuova sezione **Vendite e offerte** nel menu: due elenchi «Offerte ricevute» e «Offerte inviate», con prezzi, nomi, messaggi, stato; il venditore accetta/rifiuta, l’acquirente può annullare.
- All’accettazione, l’acquirente può completare la normale richiesta d’acquisto scegliendo spedizione, assicurazione e recapito; la vendita registrata usa esattamente il prezzo concordato. Il pagamento è sempre diretto al venditore tramite PayPal secondo il sistema esistente e la carta non viene riservata finché non è confermato il pagamento.
- Avvisi email a venditore/acquirente se il provider email del sito è configurato, indipendenti dal buon esito delle operazioni. Il sito mostra le offerte anche senza email.
- `POST /api/listings/:id/offers`, `GET /api/offers`, `POST /api/offers/:id/{accept,reject,cancel,checkout}` con controllo della proprietà, stato annuncio, limiti richieste, prevenzione duplicati, importi validi e audit.
- Nuova migrazione **additiva** `migrate-v30.sql` (`price_offers`), integrata nello script `DEPLOY.sh`. Le v28 e v29 restano incluse. `GET /api/market?listing_id=...` evita che i collegamenti agli annunci meno recenti spariscano quando ci sono più di 100 annunci.
- Test API reali con SQLite più verifica della resa HTML nel browser Chromium headless. Nessuna operazione effettuata sul database o sul sito di produzione.

## v29 — 2026-11-15 — Correzione dati carta / collegamento TCGdex (locale, non pubblicato)

- Nella pagina di una carta Pokémon propria, menu **«Modifica dati carta / collega TCGdex»**: ricerca TCGdex con lingua, risultati cliccabili con nome, espansione, numero e miniatura, scelta variante e (solo non gradate) condizione.
- `PATCH /api/cards/:id/catalog` accetta esclusivamente un ID restituito da TCGdex: il server recupera nuovamente la scheda dettagliata, non si fida di testo o prezzi forniti dal browser e ricollega la carta a un modello corretto senza ricreare né la carta né l'annuncio.
- Anche le non gradate già in vendita sono correggibili: conservati ID carta, foto fronte/retro, prezzo e annuncio; il nuovo modello aggiorna nome, set, lingua e grafico Cardmarket. Dall'annuncio proprio si può aprire la pagina di modifica.
- Non sono correggibili le gradate già certificate/aperte e le carte con richieste di acquisto o vendite pendenti. Verifiche server proprietario, lingua, variante, condizione e audit log.
- I prezzi Cardmarket sono registrati solo quando presenti nei dati ufficiali consultati: non vengono creati storici fittizi. Se TCGdex non ha prezzi per quella stampa, il collegamento si salva comunque ma il grafico potrebbe non comparire.
- Nessuna migrazione al database, nessun intervento sui dati di produzione. Test API SQLite e integrazione grafico inclusi.

## Correzione 2026-11-15 — social fronte/retro, album e grafici Cardmarket

- Esportazione post (1080×1350) e storia (1080×1920): le **non gradate** con retro disponibile mostrano foto fronte e retro affiancate, con etichette esplicite. Le gradate restano identiche; senza retro disponibile è conservato il layout solo fronte.
- Nell’album la miniatura non gradata distingue **In vendita · carta fisica** (annuncio attivo) da **Nel tuo album** / **Non in vendita** (nessun annuncio), senza confondere la registrazione digitale con la vendita della carta fisica.
- TCGdex/Cardmarket: il refresh prezzi scarica ora la scheda completa quando la ricerca restituisce solo una lista di riepilogo senza prezzi, recupera prezzi Cardmarket disponibili nella lingua inglese e nelle varianti dettagliate. Non seleziona un modello non corrispondente solo perché è il primo risultato.
- Grafico: disegna due rilevazioni reali (giornaliere o medie Cardmarket) senza richiedere tre valori; nessun prezzo storico sintetico o inventato.
- Cache-busting delle risorse aggiornate; 6 test di regressione nuovi, totale 114 test verdi. Nessuna migrazione SQL richiesta.

## Correzione 2026-11-15 — eliminazione della carta Gengar senza retro

- Aggiunto `DELETE /api/cards/:id` riservato al proprietario: ritira dall'album carte non gradate e registrazioni gradate ancora in verifica o rifiutate, anche senza retro.
- Compatibilità per vecchie carte gradate già approvate **senza retro**, ma **non ancora aperte**: è consentita la rimozione solo se il retro è realmente assente dall'archivio foto. Il certificato con rarità già assegnata rimane riservato.
- Protezioni su annunci attivi/in pausa/prenotati e vendite in corso, con controlli nel database e audit. Archiviazione non distruttiva (`owner_removed`), non accessibile da album, link e certificati pubblici.
- Pulsante **Elimina carta** visibile nel proprio album e nei dettagli, distinto da **Elimina annuncio** e **Ho venduto fuori**. Test di regressione dedicati; nessuna nuova migrazione SQL.

## Server

### v21
Tabella `transfer_code_reveals`: il codice di trasferimento in chiaro è visibile solo al proprietario digitale attuale (`GET /api/cards/:id/certificate`). L’hash su `slabs` resta la fonte di verità per il riscatto. Il codice viene ruotato a ogni cambio di proprietà.

### v20
Niente prenotazione dell’annuncio all’accettazione dell’offerta. Full Set e Solo digitale restano acquistabili in parallelo finché un pagamento non è confermato. L’indice unico passa da `accepted|paid|shipped` a solo `paid|shipped`.

### v19
Sicurezza: colonna `listings.reserved_sale_id` anche sui database locali creati senza v12 (in produzione esisteva già; la migrazione va saltata se la colonna c’è).

### v18
Chat compratore/venditore legata all’annuncio, con blocchi e segnalazioni. La pagina `/c/` mostra i proprietari attuali in tempo reale. Timbro per l’immagine social (`GET /api/copies/:id/social-stamp`) da disegnare in filigrana.

### v17
Due mercati per le carte gradate: Full Set (fisica + digitale), Solo digitale e, se i proprietari sono diversi, Solo carta fisica. Ricerca per codice di grading (`GET /api/search/cert`), anche con prefisso del grader (PSA, BGS, CGC, …).

### v16
Username pubblico e album pubblico/privato (`album_public`, default privato). Gli utenti già esistenti restano senza username e con album privato.

### v15
Codici di sfida emessi dal server e video-sfida (inquadrare la carta e leggere il codice ad alta voce), al posto della sola foto del codice.

### v14
Archivio morbido delle carte (`archived_at`) e storico di proprietà (`slab_owner_history`).

### v13
Verifica email in registrazione. Gli utenti già presenti al momento della migrazione vengono marcati come verificati (unico `UPDATE` sulle righe esistenti). In produzione risulta già applicata.

### v2–v12 (database di produzione già allineato)
Condizione e flag di prova delle carte, immagine di catalogo, campi PayPal e spedizione, prezzi richiesti, partner, certificato digitale e codici di trasferimento, storico prezzi di mercato, macchina a stati del lancio, seriali unici per modello, `reserved_sale_id` e rate limit.

## Frontend

### v9 / v9b
Interfaccia collegata al server per i due mercati (due prezzi dopo l’estrazione, badge «Solo carta fisica»), ricerca per certificato, chat con avviso PayPal / trattative fuori dal sito, pulsanti Segnala e Blocca. Copia digitale con effetto olografico, badge «Verificata» e filigrana sulle immagini social. Titolo della carta di prova: «Carta di prova». L’inclinazione della carta in pagina è gestita dall’estrazione; il riflesso olografico segue il puntatore. I testi non parlano più di prenotazione all’accettazione: l’annuncio resta visibile fino alla conferma del pagamento.

### v8
Registrazione con username e privacy dell’album (Privato predefinito). Album diviso in Gradate e Non gradate, profilo pubblico. Upload delle gradate con video-sfida al posto della foto del codice.

## Estrazione (reveal-v2, revisione rv3)

Nuova animazione di apertura delle carte gradate. Sui retri c’è il logo DM ufficiale del sito, colorato per rarità (con un alone, senza ricolorare il marchio) e la corona solo sulla Mitica. Le carte ancora da aprire hanno un retro neutro. Le particelle crescono con la rarità: polvere d’oro e scintille sulla Leggendaria; coriandoli, vortice e seconda esplosione sulla Mitica. Si tiene premuto, i retri scorrono rallentando, poi luce, ribaltamento della carta e conteggio del numero di serie.

## v23 — 2026-11-13 (deploy 4b3a6b65)
- Commissioni e piani (frontend fees1): menu, sezione home, PRO consigliato, calcolatore, admin «Gestisci».
- Profili con album privato trovabili e visibili a tutti, ma senza carte (solo proprietario e admin le vedono). Admin: ricerca anche per nome visualizzato e account senza username (`/#/u/~<id>`).
- Admin: rimozione soft di annunci (`DELETE /api/admin/listings/:id`) e carte (`DELETE /api/admin/cards/:id`, `archived_reason='admin_removed'`), atomica, con audit; bloccata con vendita pagata/spedita. Le carte rimosse spariscono per i non-admin da album, mercato, ricerche, feed e `/c/`.
- `POST /api/cards`: niente richieste doppie (bottone bloccato + dedup server 5 minuti, risposta `200 {card, dedup:true}`); migrate-v22 (`slabs.submit_fingerprint`).
- Email di verifica e notifiche admin a tutti gli admin del DB + NOTIFY_EMAIL (dedup, una mail per destinatario, batch Resend).
- Assistenza: form per utenti loggati, rate limit 3/h utente e 10/h IP, email agli admin con reply-to, pannello admin apri/chiudi; migrate-v23 (`support_requests`).

## v24 — 2026-11-13 (deploy 97fcdb59)
- Username obbligatorio all'iscrizione; `/api/me` espone `needs_username`; per gli account esistenti senza username un passaggio bloccante (tranne logout, pagine legali, `/c/`, Assistenza) con controllo disponibilità in tempo reale (`GET /api/users/username-available`, rate limit 60/min).
- Avviso «aggiungi PayPal» (con link al proprio account) solo al proprietario della carta/album; visitatori e admin vedono al massimo «Il venditore non ha ancora attivato i pagamenti», senza link. Nella pagina vendite il compratore non vede più l'invito ad aggiungere PayPal.
- Carte non gradate: retro visibile nell'album (miniatura) e nella pagina carta (flip al click/tasto Invio/Spazio); segnaposto pulito se il retro manca. Le foto restano soggette a album privato, carte test e rimozione admin.
- Dati: richieste duplicate della carta di Naso archiviate (`archived_reason='duplicate_submission'`), username `prof.oak` e `naso` assegnati ai due admin (con audit_logs).
- Nessuna migrazione nuova.

## v25 — 2026-11-13 (deploy 6308b213)
- Commissioni coerenti con i piani FREE (0 €/mese, 2,5%), PRO (9,90 €/mese, 2%), BUSINESS (29,90 €/mese, 1,5%): unica fonte `functions/lib/plans.js`; `feeAfterPercent` = aliquota FREE (non più `FEE_AFTER_BPS`).
- Tolto il fallback fisso 6,5% del banner: il banner mostra «in beta nessuna commissione… poi piani FREE/PRO/BUSINESS (1,5%–2,5%)», calcolato dai piani.
- Testi mercato (i18n.js) allineati a strings-v2: in beta nessuna commissione. `config.js` con gli stessi piani.
- Test `tests/fees-consistency.test.mjs` (piani, config, niente 6,5%, pagine legali) e `tests/qa/ui25.mjs`.
