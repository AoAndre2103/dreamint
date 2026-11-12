# Changelog

Storia ricavata dal codice, dalle migrazioni e dal lavoro recente sul frontend. Le versioni del server (v13–v21) coincidono con i file `migrate-vN.sql`. Il frontend in questo albero è la v9b, con estrazione reveal-v2 revisione rv3.

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
