import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('public/app.js');
const i18n = read('public/js/i18n.js');
const html = read('public/index.html');
const home = read('public/js/home-v2.js');

test('Market è nome e percorso ufficiali in desktop, mobile, footer e homepage', () => {
  assert.match(app, /\{ href: "#\/market", label: tr\("nav\.gallery"\) \}/);
  assert.match(app, /\["#\/market", "gallery", tr\("nav\.gallery"\)\]/);
  assert.match(html, /href="#\/market" data-i18n="nav\.gallery">Market<\/a>/);
  assert.match(home, /href="#\/market" data-link>/);
  assert.match(app, /if \(p\[0\] === "market"\)/);
  assert.doesNotMatch(html, /href="#\/galleria"/);
  assert.match(i18n, /"nav.gallery": "Market"/);
  assert.equal((i18n.match(/"gallery.title": "Market"/g) || []).length, 2);
});

test('Vecchi segnalibri Galleria e Mercato restano validi con filtri di tipo', () => {
  assert.match(app, /if \(p\[0\] === "galleria" \|\| p\[0\] === "mercato"\)/);
  assert.match(app, /go\("#\/market" \+ \(p\.length > 1/);
  assert.match(app, /var initialType = p\[1\] === "gradate" \? "graded" : p\[1\] === "non-gradate" \? "raw"/);
});

test('Album carica tutte le carte al primo accesso: filtri gradate e non gradate facoltativi', () => {
  assert.match(app, /function albumTabFromParts\(parts, start\) \{[\s\S]*?return "all";/);
  assert.match(app, /\{ key: "all", text: tr\("album\.filterAll"\), items: list \}/);
  assert.match(app, /tab: tab \|\| "all"/);  // Album pubblico
  assert.match(app, /albumSectionsHtml\(cards, \{ owner: true, tab: tab \}\)/);  // Album proprio
});

test('Il trasferimento delle non gradate rimane raggiungibile dall’Album', () => {
  assert.match(app, /href="#\/trasferimento-non-gradata"/);
  assert.match(app, /api\('ungraded-transfers\/redeem'/);
  assert.match(app, /ungraded-transfer-code/);
});
