import { SITE, listingUrl, validListingId } from './seo-listings.js';
import { listingValidSql } from './markets.js';

export const CATEGORIES = Object.freeze({
  pokemon: { label: 'Pokémon', values: ['pokemon', 'pokémon'] },
  'one-piece': { label: 'One Piece', values: ['one_piece', 'one piece', 'onepiece'] },
  lorcana: { label: 'Disney Lorcana', values: ['lorcana'] },
  magic: { label: 'Magic: The Gathering', values: ['magic', 'mtg', 'magic the gathering'] },
  'yu-gi-oh': { label: 'Yu-Gi-Oh!', values: ['yugioh', 'yu-gi-oh', 'yu_gi_oh'] }
});
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css = `body{background:#07131c;color:#e8f7f3;font:16px/1.6 system-ui,sans-serif;max-width:1060px;margin:auto;padding:24px}a{color:#7de8d1}nav{display:flex;gap:12px;flex-wrap:wrap}main{margin-top:32px}ul.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px;list-style:none;padding:0}li.card{border:1px solid #30545a;border-radius:14px;padding:18px}small{color:#a8bdc5}h1{line-height:1.2}`;
export function categoryUrl(slug) { return `${SITE}/carte/${slug}`; }
export async function getCategoryListings(env, slug, limit = 48) {
  const cat = CATEGORIES[slug];
  if (!cat) return null;
  const placeholders = cat.values.map(() => '?').join(',');
  const sql = `SELECT l.id, l.price_cents, l.created_at, m.name AS card_name, m.set_name, m.code_printed, m.language, s.is_ungraded FROM listings l JOIN slabs s ON s.id=l.slab_id JOIN card_models m ON m.id=s.card_model_id WHERE l.status='active' AND COALESCE(s.is_test,0)=0 AND s.archived_at IS NULL AND ${listingValidSql('l')} AND LOWER(m.game) IN (${placeholders}) ORDER BY l.created_at DESC LIMIT ?`;
  const data = await env.DB.prepare(sql).bind(...cat.values, limit).all();
  return data.results || [];
}
export function renderCategory(slug, listings) {
  const cat = CATEGORIES[slug];
  if (!cat) return new Response('Categoria non trovata', { status: 404, headers: { 'x-robots-tag': 'noindex' } });
  const url = categoryUrl(slug);
  const title = `Carte ${cat.label} in vendita | Marketplace DreaMint`;
  const description = `Scopri gli annunci di carte ${cat.label} disponibili su DreaMint. Confronta le inserzioni di carte gradate e non gradate pubblicate dai collezionisti.`;
  const hasListings = Array.isArray(listings) && listings.length > 0;
  const navigation = Object.entries(CATEGORIES).map(([key, value]) => `<a href="${categoryUrl(key)}">${escapeHtml(value.label)}</a>`).join(' · ');
  const cards = (listings || []).filter(r => validListingId(r.id)).map(r => `<li class="card"><h2><a href="${listingUrl(r.id)}">${escapeHtml(r.card_name)} ${escapeHtml(r.code_printed)}</a></h2><p>${escapeHtml(r.set_name)} · ${escapeHtml(r.language)}</p><p>${r.is_ungraded ? 'Non gradata' : 'Gradata'} · <strong>${(Number(r.price_cents)/100).toFixed(2).replace('.', ',')} €</strong></p></li>`).join('');
  const collection = { '@context':'https://schema.org', '@type':'CollectionPage', name:title, description, url, isPartOf:{'@type':'WebSite', name:'DreaMint', url:SITE} };
  const json = JSON.stringify(collection).replace(/</g,'\\u003c');
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${hasListings ? 'index,follow' : 'noindex,follow'}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="DreaMint"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${json}</script><style>${css}</style></head><body><header><a href="/">DreaMint</a><nav aria-label="Categorie">${navigation}</nav></header><main><nav aria-label="Percorso"><a href="/">Home</a> / ${escapeHtml(cat.label)}</nav><h1>Carte ${escapeHtml(cat.label)} in vendita</h1><p>${escapeHtml(description)}</p>${hasListings ? `<ul class="cards">${cards}</ul>` : '<p>Al momento non ci sono annunci disponibili in questa categoria.</p>'}<p><a href="/#/marketplace">Esplora tutto il marketplace</a></p></main></body></html>`;
  return new Response(html, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'public, max-age=120', 'x-robots-tag':hasListings ? 'index, follow' : 'noindex, follow' } });
}
