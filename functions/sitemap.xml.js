import { getPublicListingUrls, renderSitemap } from "./lib/seo-listings.js";
export async function onRequest({ env }) {
  try {
    const xml = renderSitemap(await getPublicListingUrls(env));
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
  } catch {
    return new Response("Sitemap temporaneamente non disponibile", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
