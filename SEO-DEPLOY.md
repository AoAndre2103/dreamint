# DreaMint — SEO release

## Implementato
- Pagine pubbliche HTML per annunci attivi: `/annuncio/:id`, con canonical, Open Graph e Product/Offer JSON-LD (già presenti nel pacchetto di partenza).
- Cinque pagine categoria HTML indicizzabili se contengono annunci attivi: `/carte/pokemon`, `/carte/one-piece`, `/carte/lorcana`, `/carte/magic`, `/carte/yu-gi-oh`.
- Link HTML alle categorie nel footer della homepage e link alle categorie nelle schede annuncio.
- Sitemap dinamica con categorie, pagine statiche e fino a 10.000 annunci recenti.
- Le categorie senza annunci emettono `noindex`; le inserzioni chiuse o non pubbliche non vengono esposte.
- Test SEO automatici aggiuntivi.

## Verifiche obbligatorie prima del lancio
1. Pubblicare su Cloudflare Pages con il binding D1 `DB` corretto e migrazioni già applicate.
2. Aprire `/sitemap.xml`, `/carte/pokemon`, `/annuncio/<id-reale>` e verificare status HTTP, HTML e canonical.
3. Verificare che i valori `card_models.game` del database coincidano con gli alias previsti in `functions/lib/seo-categories.js` (gli alias non riconosciuti non compariranno nelle categorie).
4. Testare i dati strutturati con Rich Results Test e controllare l'anteprima dei link condivisi.
5. Inviare `https://dreamint.it/sitemap.xml` a Google Search Console e monitorare indicizzazione e copertura.
6. Se il numero di annunci pubblici supera 10.000, introdurre sitemap paginata con sitemap index: l'attuale limite evita risposte troppo grandi ma non copre tutti gli annunci oltre la soglia.
7. Verificare che `og.png` sia un'immagine corretta e che le politiche di utilizzo delle immagini dei venditori consentano l'eventuale adozione di immagini per-annuncio.

## Limitazioni
- Le pagine categorie sono landing page HTML separate dall'app SPA; non cambiano la logica degli acquisti.
- L'indicizzazione effettiva non è garantita: dipende da crawling, contenuto, concorrenza e Search Console.
- Non sono state implementate traduzioni HTML server-side complete in inglese, né URL per filtri combinati per evitare pagine sottili/duplicate.
- Test eseguiti localmente, non in produzione.
