// v31: la galleria mostra subito carte gradate e non gradate; i tipi sono filtri, non pagine obbligatorie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('public/app.js');
const html = read('public/index.html');
const i18n = read('public/js/i18n.js');
const home = read('public/js/home-v2.js');

function boardFor(sample, opts = {}) {
  const window = { matchMedia: () => ({ matches: true }) };
  vm.runInNewContext(home, { window });
  const helper = {
    tr: (k) => ({ 'mp.all': 'Tutte', 'mp.graded': 'Gradate', 'mp.raw': 'Non gradate' })[k] || k,
    esc: (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    photoImg: (id) => '<img alt="" src="/api/cards/' + id + '/photo/front">',
    cardTitle: (l) => l.card_name, euros: (n) => n / 100 + ' €',
    state: { user: null }, langIsEn: () => false
  };
  window.DreaMintHome.init(helper);
  return window.DreaMintHome.marketBoard(sample, { typeFilters: true, ...opts });
}
const listings = [
  { id: 'grade_1', slab_id: 's1', card_name: 'Gengar gradata', game: 'pokemon', is_ungraded: false, grader: 'PSA', grade: '10', price_cents: 8500 },
  { id: 'raw_1', slab_id: 's2', card_name: 'Gengar non gradata', game: 'pokemon', is_ungraded: true, card_condition: 'NM', price_cents: 2500 }
];

test('galleria unificata: il board ha entrambe le carte già visibili e i filtri di tipo', () => {
  const rendered = boardFor(listings);
  assert.match(rendered, /data-sec="graded"/);
  assert.match(rendered, /data-sec="raw"/);
  assert.match(rendered, /data-f="sec" data-v="graded"/);
  assert.match(rendered, /data-f="sec" data-v="raw"/);
  assert.match(rendered, /data-f="all" data-v=""/);
  assert.doesNotMatch(rendered, /data-initial-section=/);
  assert.match(rendered, /Gengar gradata/);
  assert.match(rendered, /Gengar non gradata/);
  assert.match(rendered, /data-mb-grid/);
});

test('galleria: un link prefiltrato è solo una selezione iniziale modificabile', () => {
  const rendered = boardFor(listings, { initialSection: 'raw' });
  assert.match(rendered, /data-initial-section="raw"/);
  assert.match(rendered, /data-sec="graded"/);
  assert.match(rendered, /data-sec="raw"/);
  assert.match(home, /var initialSection = board\.getAttribute\("data-initial-section"\)/);
  assert.match(home, /apply\(\); \/\/ all'apertura/);
});

test('galleria: menu desktop/mobile, footer e homepage aprono la pagina unica', () => {
  assert.match(app, /\{ href: "#\/galleria", label: tr\("nav\.gallery"\) \}/);
  assert.match(app, /\["#\/galleria", "gallery", tr\("nav\.gallery"\)\]/);
  assert.match(html, /href="#\/galleria" data-i18n="nav\.gallery"/);
  assert.match(home, /href="#\/galleria" data-link>/);
  assert.match(app, /if \(p\[0\] === "galleria"\)/);
  assert.match(app, /var galData = await api\("market"\);/);
  assert.match(app, /pageGallery\(galData\.listings \|\| \[\], initialType\)/);
  assert.match(app, /bindMarketBoard\(\$app\)/);
  assert.match(app, /if \(!p\[1\]\) \{ go\(p\[0\] === "gradate"/);
});

test('galleria: traduzioni italiane e inglesi, nessun cambiamento ai dati delle offerte', () => {
  for (const key of ['nav.gallery', 'gallery.title', 'gallery.description', 'gallery.sell', 'gallery.empty']) {
    const hits = [...i18n.matchAll(new RegExp('"' + key.replaceAll('.', '\\.') + '":', 'g'))];
    assert.equal(hits.length, 2, key + ' deve esistere in italiano e inglese');
  }
  assert.match(app, /pageGallery\(listings, initialSection\)/);
  assert.match(app, /api\("market"\)/);
  assert.ok(!read('functions/api/[[path]].js').includes('gallery.title'), 'nessuna variazione API per il filtro UI');
});
