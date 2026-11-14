import { getPublicListing, renderListingPage, validListingId } from "../lib/seo-listings.js";
export async function onRequest({ env, params }) {
  const id = String(params?.path || "").split("/").filter(Boolean)[0] || "";
  if (!validListingId(id)) return renderListingPage(null);
  try { return renderListingPage(await getPublicListing(env, id)); }
  catch { return new Response("Servizio temporaneamente non disponibile", { status: 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } }); }
}
