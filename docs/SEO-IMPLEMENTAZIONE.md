# SEO DreaMint — implementazione v27c

- `/annuncio/:id`: pagina HTML pubblica con meta tag dedicati, canonical, OG e Product/Offer JSON-LD; reindirizzamento client al dettaglio SPA esistente.
- `/sitemap.xml`: sitemap dinamica con fino a 1000 inserzioni attive non-test e URL statici.
- Annunci chiusi, riservati, test, archiviati o non più vendibili: 404/noindex.
- Nessun dato personale del venditore o fotografia privata esposto nelle anteprime; immagine OG generica fino a definizione di una policy per foto pubbliche.

## Prima di pubblicare

Verificare su Cloudflare Pages che `/sitemap.xml` sia gestita dalla Function e non dal file statico omonimo; rimuovere il file statico `public/sitemap.xml` per evitare ambiguità. Verificare il comportamento di anteprime WhatsApp e social (alcuni crawler non eseguono redirect). Verificare le condizioni `Product`/`Offer` con Rich Results Test. Per oltre 1000 annunci implementare sitemap paginata e sitemap index.
