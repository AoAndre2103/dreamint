import { listingValidSql } from "./markets.js";

export const SITE = "https://dreamint.it";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const listingUrl = (id) => `${SITE}/annuncio/${encodeURIComponent(id)}`;
export const validListingId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);

const baseWhere = `l.status = 'active' AND COALESCE(s.is_test, 0) = 0 AND s.archived_at IS NULL AND ${listingValidSql("l")}`;
const fromSql = ` FROM listings l JOIN slabs s ON s.id = l.slab_id JOIN card_models m ON m.id = s.card_model_id `;
export async function getPublicListing(env, id) {
  return env.DB.prepare(`SELECT l.id, l.slab_id, l.price_cents, l.kind, l.created_at, s.is_ungraded, s.card_condition, s.grader, s.grade, m.game, m.name AS card_name, m.set_name, m.code_printed, m.language, m.catalog_image ${fromSql} WHERE l.id = ? AND ${baseWhere} LIMIT 1`).bind(id).first();
}
export async function getPublicListingUrls(env, limit = 10000) {
  const rows = await env.DB.prepare(`SELECT l.id, l.created_at ${fromSql} WHERE ${baseWhere} ORDER BY l.created_at DESC LIMIT ?`).bind(limit).all();
  return rows.results || [];
}
function responseHtml(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": status === 200 ? "index, follow" : "noindex, follow" } });
}
export function renderListingPage(row) {
  if (!row) return responseHtml(`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Annuncio non disponibile — DreaMint</title><main><h1>Annuncio non disponibile</h1><a href="${SITE}/">Torna a DreaMint</a></main></html>`, 404);
  const title = `${row.card_name} ${row.code_printed || ""} — ${row.set_name} | DreaMint`;
  const url = listingUrl(row.id);
  const price = (Number(row.price_cents) / 100).toFixed(2);
  const kind = row.is_ungraded ? "Non gradata" : row.kind === "digital" ? "Solo digitale" : row.kind === "physical" ? "Solo fisica" : "Gradata";
  const description = `${row.card_name} (${row.code_printed || ""}), ${row.set_name}. ${kind}. Prezzo richiesto: ${price} €. Scopri l'annuncio su DreaMint.`;
  // Never expose user-uploaded photos through SEO without a separate public-photo policy.
  const image = `${SITE}/og.png`;
  const product = { "@context": "https://schema.org", "@type": "Product", name: title, description, image: [image], sku: row.id, offers: { "@type": "Offer", url, priceCurrency: "EUR", price, availability: "https://schema.org/InStock", itemCondition: "https://schema.org/UsedCondition", seller: { "@type": "Organization", name: "Venditore su DreaMint" } } };
  const json = JSON.stringify(product).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const hash = `#/annuncio/${encodeURIComponent(row.id)}/${encodeURIComponent(row.slab_id)}`;
  return responseHtml(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}"><meta property="og:type" content="product"><meta property="og:site_name" content="DreaMint"><meta property="og:locale" content="it_IT"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${json}</script><style>body{background:#07131c;color:#e8f7f3;font:16px system-ui;padding:3rem;max-width:45rem;margin:auto}a{color:#7de8d1}h1{line-height:1.3}</style></head><body><main><h1>${esc(row.card_name)} — ${esc(row.set_name)}</h1><p>${esc(kind)} · ${esc(price)} €</p><p>${esc(description)}</p><p><a href="/">DreaMint</a> · <a href="/carte/pokemon">Pokémon</a> · <a href="/carte/one-piece">One Piece</a> · <a href="/carte/lorcana">Lorcana</a> · <a href="/carte/magic">Magic</a> · <a href="/carte/yu-gi-oh">Yu-Gi-Oh!</a></p><a href="/${esc(hash)}">Apri l'annuncio nel marketplace DreaMint</a></main></body></html>`);
}
export function renderSitemap(rows) {
  const staticUrls = ["/", "/legal/termini", "/legal/privacy", "/legal/regolamento-lancio", "/legal/faq"];
  const urls = staticUrls.map((x) => `<url><loc>${SITE}${x}</loc></url>`);
  for (const slug of ["pokemon", "one-piece", "lorcana", "magic", "yu-gi-oh"]) urls.push(`<url><loc>${SITE}/carte/${slug}</loc></url>`);
  for (const r of rows) {
    if (!validListingId(r.id)) continue;
    urls.push(`<url><loc>${listingUrl(r.id)}</loc></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}
