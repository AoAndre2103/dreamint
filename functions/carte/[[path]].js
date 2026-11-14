import { CATEGORIES, getCategoryListings, renderCategory } from '../lib/seo-categories.js';
export async function onRequest({ env, params }) {
  const path = String(params?.path || '').replace(/^\/+|\/+$/g, '');
  if (!Object.hasOwn(CATEGORIES, path)) return new Response('Categoria non trovata', { status:404, headers:{'x-robots-tag':'noindex'} });
  try { return renderCategory(path, await getCategoryListings(env, path)); }
  catch { return new Response('Servizio temporaneamente non disponibile', {status:503, headers:{'x-robots-tag':'noindex', 'cache-control':'no-store'}}); }
}
