import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, renderCategory, categoryUrl } from '../functions/lib/seo-categories.js';
import { renderSitemap, renderListingPage } from '../functions/lib/seo-listings.js';
test('SEO categories have canonical urls and valid HTML', async () => {
  for (const slug of Object.keys(CATEGORIES)) {
    const response = renderCategory(slug, [{ id:'listing123', price_cents:6000, card_name:'Gengar-ex', code_printed:'154/128', set_name:'Anniversario', language:'ITA', is_ungraded:1 }]);
    const html = await response.text();
    assert.equal(response.status,200);
    assert.match(html, new RegExp(categoryUrl(slug)));
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /annuncio\/listing123/);
    assert.match(html, /60,00 €|60\.00 €|60\.00/);
  }
});
test('empty category does not get indexed', () => assert.equal(renderCategory('pokemon', []).headers.get('x-robots-tag'), 'noindex, follow'));
test('invalid category returns 404', () => assert.equal(renderCategory('bogus', []).status,404));
test('SEO pages escape user-supplied card names', async () => {
  const response = renderCategory('pokemon', [{id:'abc', price_cents:500, card_name:'<script>alert(1)</script>', code_printed:'1', set_name:'Set', language:'ITA'}]);
  const html = await response.text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
});
test('sitemap includes SEO categories and valid listings only', () => {
  const xml = renderSitemap([{id:'abc'}, {id:'invalid id'}]);
  assert.match(xml,/carte\/pokemon/);
  assert.match(xml,/annuncio\/abc/);
  assert.ok(!xml.includes('invalid id'));
});
