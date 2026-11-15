import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = fs.readFileSync(new URL('public/app.js', root), 'utf8');
const html = fs.readFileSync(new URL('public/index.html', root), 'utf8');
const css = fs.readFileSync(new URL('public/styles.css', root), 'utf8');

function harness() {
  const bell = { hidden: true, attributes: {}, classNames: new Set(),
    setAttribute(k, v) { this.attributes[k] = v; },
    classList: { toggle: (name, value) => { if (value) bell.classNames.add(name); else bell.classNames.delete(name); } } };
  const count = { hidden: true, textContent: '' };
  const menuLink = { innerHTML: 'Notifiche' };
  const pending = [];
  const state = { user: { id: 'alice' }, unreadNotifications: 0 };
  const document = {
    querySelectorAll: (selector) => {
      assert.match(selector, /desk-nav/);
      assert.doesNotMatch(selector, /a\[href="#\/notifiche"\]'/); // no generic selector touching the bell
      return [menuLink];
    },
    getElementById(id) { return id === 'notification-bell' ? bell : id === 'notification-bell-count' ? count : null; }
  };
  const api = () => new Promise((resolve, reject) => pending.push({resolve, reject}));
  const scope = { document, state, api, esc: x => x, socialText: (it) => it,
    adminBadgeHtml: n => n ? '<b>' + n + '</b>' : '' };
  const code = app.slice(app.indexOf('  function updateNotificationBadges() {'), app.indexOf('  function navItems() {'));
  assert.match(code, /function refreshNotificationCount\(/);
  vm.runInNewContext(code, scope);
  return { bell, count, menuLink, pending, state, ...scope };
}

test('campanellina presente nell’header, link e versionamento della cache', () => {
  assert.match(html, /id="notification-bell"[^>]*href="#\/notifiche"/);
  assert.match(html, /id="notification-bell-count"[^>]*hidden/);
  assert.match(html, /app\.js\?v=20261115v37bell/);
  assert.match(html, /styles\.css\?v=20261115v37bell/);
  assert.match(css, /\.notification-bell\[hidden\]/);
  assert.match(css, /@media \(max-width: 540px\)/);
  assert.match(app, /function renderChrome\(\) \{\s*updateNotificationBadges\(\)/);
});

test('campanella: stato vuoto, badge 1, badge 3, e 99+ per numeri grandi', () => {
  const { bell, count, state, menuLink, updateNotificationBadges } = harness();
  updateNotificationBadges();
  assert.equal(bell.hidden, false);
  assert.equal(count.hidden, true);
  assert.match(bell.attributes['aria-label'], /nessuna da leggere/);
  for (const n of [1, 3, 99, 142]) {
    state.unreadNotifications = n;
    updateNotificationBadges();
    assert.equal(count.hidden, false);
    assert.equal(count.textContent, n > 99 ? '99+' : String(n));
    assert.match(bell.attributes['aria-label'], new RegExp(String(n)));
    assert.equal(bell.classNames.has('has-unread'), true);
    assert.match(menuLink.innerHTML, /Notifiche/);
  }
  state.unreadNotifications = 0;
  updateNotificationBadges();
  assert.equal(count.hidden, true);
  assert.equal(bell.classNames.has('has-unread'), false);
});

test('campanella nascosta per ospiti; non mostra conteggi di account precedenti', async () => {
  const h = harness();
  h.refreshNotificationCount();
  assert.equal(h.pending.length, 1);
  h.state.user = null;
  h.refreshNotificationCount();
  assert.equal(h.bell.hidden, true);
  assert.equal(h.count.hidden, true);
  h.pending[0].resolve({unread_count: 8});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.bell.hidden, true);
  assert.equal(h.state.unreadNotifications, 0);
});

test('aggiornamento campanella dopo refresh, senza mostrare risposte obsolete', async () => {
  const h = harness();
  h.refreshNotificationCount();
  h.refreshNotificationCount();
  h.pending[1].resolve({unread_count: 3});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.count.textContent, '3');
  h.pending[0].resolve({unread_count: 40});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.count.textContent, '3');
});
