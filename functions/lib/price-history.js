/**
 * Daily price history + trend payloads. Never invent prices.
 * Snapshots are taken opportunistically when a live price is fetched.
 */

import { lookupExternalCatalog } from "./catalog-search.js";

const WINDOWS_KV_PREFIX = "price:windows:";
const EUR_GAMES = new Set(["pokemon", "magic", "yugioh"]);
const USD_GAMES = new Set(["one_piece", "lorcana"]);

export function todayRome(date) {
  const d = date || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function slugPart(s) {
  return String(s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeCodeSimple(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2044\u2215\uFF0F]/g, "/")
    .replace(/\s+/g, "");
}

export function priceCardRef(fields) {
  const f = fields || {};
  const game = String(f.game || "").trim().toLowerCase();
  const set = slugPart(f.set_code || f.set_name || "");
  const code = String(f.code_normalized || normalizeCodeSimple(f.code_printed || f.code || "")).toLowerCase();
  const lang = String(f.language || "ITA").trim().toUpperCase() || "ITA";
  const vari = String(f.variant || "normal").trim().toLowerCase() || "normal";
  return [game, set, code, lang, vari].join("|");
}

export function eurosToCents(value) {
  const n = Number(String(value == null ? "" : value).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function extractCardmarketWindows(cm) {
  if (!cm || typeof cm !== "object") return null;
  const pick = (k) => {
    const n = Number(cm[k]);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  const out = {
    avg: pick("avg"),
    avg1: pick("avg1"),
    avg7: pick("avg7"),
    avg30: pick("avg30"),
    trend: pick("trend"),
    unit: cm.unit || "EUR",
    updated: cm.updated || null
  };
  if (out.avg == null && out.avg1 == null && out.avg7 == null && out.avg30 == null && out.trend == null) return null;
  return out;
}

export function currentFromWindows(win) {
  if (!win) return null;
  if (win.trend != null) return { euros: win.trend, figure: "trend" };
  if (win.avg1 != null) return { euros: win.avg1, figure: "avg1" };
  if (win.avg != null) return { euros: win.avg, figure: "avg" };
  return null;
}

function pctChange(current, baseline) {
  if (current == null || baseline == null || !(baseline > 0) || !(current > 0)) return null;
  return Math.round(((current - baseline) / baseline) * 1000) / 10;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(cors || {})
    }
  });
}

export async function snapshotPrice(env, { game, card_ref, currency, source, price_cents, day }) {
  const cents = Math.round(Number(price_cents));
  if (!game || !card_ref || !currency || !source || !Number.isFinite(cents) || cents <= 0) return false;
  const d = day || todayRome();
  await env.DB.prepare(
    `INSERT INTO price_history (game, card_ref, currency, source, price_cents, day)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(game, card_ref, currency, source, day) DO UPDATE SET price_cents = excluded.price_cents`
  ).bind(String(game).toLowerCase(), card_ref, String(currency).toUpperCase(), String(source), cents, d).run();
  return true;
}

export async function saveWindows(env, card_ref, windows) {
  if (!env.PHOTOS || !card_ref || !windows) return;
  try {
    await env.PHOTOS.put(WINDOWS_KV_PREFIX + card_ref, JSON.stringify({ ...windows, saved_at: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 14 });
  } catch (e) { /* ignore */ }
}

export async function loadWindows(env, card_ref) {
  if (!env.PHOTOS || !card_ref) return null;
  try {
    const raw = await env.PHOTOS.get(WINDOWS_KV_PREFIX + card_ref);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return extractCardmarketWindows(parsed) || parsed;
  } catch (e) {
    return null;
  }
}

export async function snapshotFromHit(env, hit) {
  if (!hit || !hit.game) return false;
  const ref = priceCardRef(hit);
  const game = String(hit.game).toLowerCase();
  let ok = false;
  const win = extractCardmarketWindows(hit.cardmarket);
  if (win) await saveWindows(env, ref, win);
  const current = currentFromWindows(win);
  if (current) {
    ok = await snapshotPrice(env, {
      game,
      card_ref: ref,
      currency: "EUR",
      source: "cardmarket",
      price_cents: eurosToCents(current.euros)
    });
  } else if (hit.cardmarket_avg_euros != null && Number(hit.cardmarket_avg_euros) > 0) {
    ok = await snapshotPrice(env, {
      game,
      card_ref: ref,
      currency: "EUR",
      source: "cardmarket",
      price_cents: eurosToCents(hit.cardmarket_avg_euros)
    });
  } else if (hit.market_avg_usd != null && Number(hit.market_avg_usd) > 0) {
    const src = String(hit.market_source || "indicative").slice(0, 40) || "indicative";
    ok = await snapshotPrice(env, {
      game,
      card_ref: ref,
      currency: "USD",
      source: src,
      price_cents: eurosToCents(hit.market_avg_usd)
    });
  }
  return ok;
}

export async function snapshotHits(env, hits) {
  const list = Array.isArray(hits) ? hits : [];
  let n = 0;
  for (const h of list) {
    try {
      if (await snapshotFromHit(env, h)) n += 1;
    } catch (e) { /* keep going */ }
  }
  return n;
}

async function loadHistory(env, { game, card_ref, currency, source }) {
  let sql = "SELECT day, price_cents, currency, source FROM price_history WHERE card_ref = ?";
  const binds = [card_ref];
  if (game) { sql += " AND game = ?"; binds.push(String(game).toLowerCase()); }
  if (currency) { sql += " AND currency = ?"; binds.push(String(currency).toUpperCase()); }
  if (source) { sql += " AND source = ?"; binds.push(source); }
  sql += " ORDER BY day ASC";
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  return rows.results || [];
}

function windowChartPoints(win) {
  if (!win) return [];
  const pts = [];
  if (win.avg30 != null) pts.push({ day: "avg30", label: "30g", price_cents: eurosToCents(win.avg30), kind: "window" });
  if (win.avg7 != null) pts.push({ day: "avg7", label: "7g", price_cents: eurosToCents(win.avg7), kind: "window" });
  const cur = currentFromWindows(win);
  if (cur) {
    const key = cur.figure === "trend" ? "trend" : (cur.figure === "avg1" ? "avg1" : "avg");
    pts.push({ day: key, label: key === "trend" ? "trend" : (key === "avg1" ? "1g" : "avg"), price_cents: eurosToCents(cur.euros), kind: "window" });
  }
  return pts.filter((p) => p.price_cents != null);
}

function filterHistory(points, days) {
  if (!days) return points.slice();
  const cutoff = new Date();
  cutoff.setTime(cutoff.getTime() - (days - 1) * 86400 * 1000);
  const min = todayRome(cutoff);
  return points.filter((p) => p.day >= min);
}

export function buildTrendPayload({ game, card_ref, history, windows, currency, source }) {
  const curWin = currentFromWindows(windows);
  const hist = (history || []).filter((r) => r && r.price_cents > 0);
  const lastHist = hist.length ? hist[hist.length - 1] : null;
  const currencyCode = (lastHist && lastHist.currency) || currency || (windows ? "EUR" : null);
  const src = (lastHist && lastHist.source) || source || (windows ? "cardmarket" : null);

  let last_cents = lastHist ? lastHist.price_cents : null;
  let last_figure = lastHist ? "history" : null;
  if (curWin && currencyCode === "EUR") {
    last_cents = eurosToCents(curWin.euros);
    last_figure = curWin.figure;
  }

  const change_7d = (curWin && windows && windows.avg7)
    ? pctChange(curWin.euros, windows.avg7)
    : (function () {
      const week = filterHistory(hist, 7);
      if (week.length < 2) return null;
      return pctChange(week[week.length - 1].price_cents, week[0].price_cents);
    })();
  const change_30d = (curWin && windows && windows.avg30)
    ? pctChange(curWin.euros, windows.avg30)
    : (function () {
      const month = filterHistory(hist, 30);
      if (month.length < 2) return null;
      return pctChange(month[month.length - 1].price_cents, month[0].price_cents);
    })();

  const histPoints = hist.map((r) => ({ day: r.day, price_cents: r.price_cents, kind: "daily" }));
  const officialPoints = windowChartPoints(windows);

  return {
    game: game || null,
    card_ref,
    currency: currencyCode,
    source: src,
    source_label: sourceLabel(src, currencyCode),
    last_cents,
    last_figure,
    change_7d,
    change_30d,
    windows: windows || null,
    points: histPoints,
    official_points: officialPoints,
    history_count: histPoints.length
  };
}

function sourceLabel(source, currency) {
  if (!source) return "";
  const s = String(source);
  if (s === "cardmarket" || currency === "EUR") return "Cardmarket";
  if (s === "indicative" || s === "indicativo") return "";
  return s;
}

export async function getTrendForRef(env, fields) {
  const game = String((fields && fields.game) || "").toLowerCase();
  const card_ref = fields.card_ref || priceCardRef(fields);
  if (!card_ref || card_ref.startsWith("|") || card_ref === "||||") return null;
  const history = await loadHistory(env, { game, card_ref });
  const windows = await loadWindows(env, card_ref);
  const currency = history[0] ? history[0].currency : (windows ? "EUR" : (USD_GAMES.has(game) ? "USD" : "EUR"));
  const source = history[0] ? history[0].source : (windows ? "cardmarket" : null);
  return buildTrendPayload({ game, card_ref, history, windows, currency, source });
}

export async function hasTodaySnapshot(env, card_ref) {
  if (!card_ref) return false;
  const row = await env.DB.prepare(
    "SELECT day FROM price_history WHERE card_ref = ? AND day = ? LIMIT 1"
  ).bind(card_ref, todayRome()).first();
  return !!row;
}

function tcgdexIdFromImage(url) {
  const m = String(url || "").match(/assets\.tcgdex\.net\/([a-z]+)\/[^/]+\/([^/]+)\/([^/]+)\//i);
  if (!m) return null;
  return { lang: m[1], id: m[2] + "-" + m[3] };
}

async function fetchLiveHit(env, model) {
  const game = String((model && model.game) || "").toLowerCase();
  if (!game) return null;
  if (game === "pokemon") {
    const parsed = tcgdexIdFromImage(model.catalog_image);
    if (parsed) {
      const res = await lookupExternalCatalog(env, { game: "pokemon", id: parsed.id, lang: model.language || "ITA" });
      if (res.hits && res.hits[0]) return res.hits[0];
    }
  }
  const q = [model.set_code || "", model.code_printed || model.code || "", model.name || ""].filter(Boolean).join(" ").trim()
    || model.name || model.code_printed || "";
  if (!q) return null;
  const res = await lookupExternalCatalog(env, { game, q, lang: model.language || "ITA" });
  const hits = res.hits || [];
  if (!hits.length) return null;
  const code = normalizeCodeSimple(model.code_printed || model.code || model.code_normalized || "");
  const named = hits.filter((h) => {
    if (code && normalizeCodeSimple(h.code_printed) === code) return true;
    if (model.name && String(h.name || "").toLowerCase() === String(model.name).toLowerCase()) return true;
    return false;
  });
  return (named[0] || hits[0]);
}

export async function refreshModelPrice(env, model, opts) {
  opts = opts || {};
  const ref = model.card_ref || priceCardRef(model);
  if (!opts.force && await hasTodaySnapshot(env, ref)) return { skipped: true, reason: "already_today", card_ref: ref };
  const hit = await fetchLiveHit(env, { ...model, card_ref: ref });
  if (!hit) return { skipped: true, reason: "no_price", card_ref: ref };
  const ok = await snapshotFromHit(env, { ...hit, language: model.language || hit.language, variant: model.variant || hit.variant, set_name: model.set_name || hit.set_name, set_code: model.set_code || hit.set_code, code_printed: model.code_printed || hit.code_printed, game: model.game || hit.game });
  // Re-snapshot under the model's own card_ref so listing/history keys match
  const aligned = { ...hit, ...model, game: model.game || hit.game };
  await snapshotFromHit(env, aligned);
  return { ok, card_ref: ref };
}

export async function maybeRefreshModelPrice(env, model) {
  try {
    if (!model || !model.game) return;
    return await refreshModelPrice(env, model, { force: false });
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

async function trendsForListings(env, listings) {
  const out = new Map();
  const refs = [];
  for (const l of listings) {
    const fields = {
      game: l.game,
      set_name: l.set_name,
      set_code: l.set_code,
      code_printed: l.code_printed,
      code_normalized: l.code_normalized,
      language: l.language,
      variant: l.variant
    };
    const ref = priceCardRef(fields);
    l._card_ref = ref;
    if (ref && !out.has(ref)) {
      out.set(ref, fields);
      refs.push(ref);
    }
  }
  if (!refs.length) return {};
  const placeholders = refs.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT game, card_ref, currency, source, price_cents, day
     FROM price_history WHERE card_ref IN (${placeholders})
     ORDER BY day ASC`
  ).bind(...refs).all();
  const byRef = {};
  for (const r of (rows.results || [])) {
    (byRef[r.card_ref] || (byRef[r.card_ref] = [])).push(r);
  }
  const trends = {};
  for (const ref of refs) {
    const windows = await loadWindows(env, ref);
    const history = byRef[ref] || [];
    const fields = out.get(ref) || {};
    trends[ref] = buildTrendPayload({
      game: fields.game,
      card_ref: ref,
      history,
      windows,
      currency: history[0] && history[0].currency,
      source: history[0] && history[0].source
    });
  }
  return trends;
}

export async function attachTrendsToListings(env, listings) {
  const list = listings || [];
  if (!list.length) return list;
  const trends = await trendsForListings(env, list);
  return list.map((l) => {
    const ref = l._card_ref || priceCardRef(l);
    const trend = trends[ref] || null;
    const copy = { ...l };
    delete copy._card_ref;
    if (trend) copy.price_trend = compactTrend(trend);
    return copy;
  });
}

export function compactTrend(t) {
  if (!t) return null;
  const spark = (t.points && t.points.length >= 3) ? t.points.slice(-30) : (t.official_points || []);
  return {
    card_ref: t.card_ref,
    currency: t.currency,
    source: t.source,
    source_label: t.source_label,
    last_cents: t.last_cents,
    last_figure: t.last_figure,
    change_7d: t.change_7d,
    change_30d: t.change_30d,
    history_count: t.history_count,
    windows: t.windows,
    official_points: t.official_points,
    points: spark
  };
}

export async function adminRefreshActiveListings(env, opts) {
  opts = opts || {};
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 40));
  const rows = await env.DB.prepare(
    `SELECT DISTINCT m.game, m.set_name, m.set_code, m.code_printed, m.code_normalized,
            m.name, m.language, m.variant, m.catalog_image
     FROM listings l
     JOIN slabs s ON s.id = l.slab_id
     JOIN card_models m ON m.id = s.card_model_id
     WHERE l.status = 'active'
     LIMIT ?`
  ).bind(limit).all();
  const models = rows.results || [];
  const results = [];
  for (const m of models) {
    try {
      const r = await refreshModelPrice(env, m, { force: !!opts.force });
      results.push({ card_ref: priceCardRef(m), name: m.name, ...r });
    } catch (e) {
      results.push({ card_ref: priceCardRef(m), name: m.name, error: String(e && e.message || e) });
    }
  }
  return {
    refreshed: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.error).length,
    total: results.length,
    note: "Pages non ha un cron: i prezzi si aggiornano quando una carta viene cercata o vista, oppure da questo endpoint. Un Worker cron dedicato si può aggiungere in seguito.",
    items: results
  };
}

export async function handlePriceRoutes(request, env, path, url, helpers) {
  const method = request.method.toUpperCase();
  const cors = (helpers && helpers.corsHeaders) || {};
  const J = (data, status) => json(data, status, cors);
  try {
    if (method === "GET" && path === "prices/trend") {
      return await getTrendHandler(request, env, url, helpers, J);
    }
    if (method === "POST" && path === "admin/prices/refresh") {
      const admin = await helpers.requireAdmin(request, env);
      const body = await helpers.readJson(request).catch(() => ({}));
      const out = await adminRefreshActiveListings(env, { force: !!body.force, limit: body.limit });
      if (helpers.audit) await helpers.audit(env, admin.id, "refresh_prices", "price_history", null, { refreshed: out.refreshed, skipped: out.skipped });
      return J(out);
    }
    return null;
  } catch (err) {
    return J({ error: err.message || "Errore interno" }, err.status || 500);
  }
}

async function getTrendHandler(request, env, url, helpers, J) {
  let fields = {
    game: url.searchParams.get("game") || "",
    set_name: url.searchParams.get("set_name") || "",
    set_code: url.searchParams.get("set_code") || "",
    code_printed: url.searchParams.get("code") || url.searchParams.get("code_printed") || "",
    code_normalized: url.searchParams.get("code_normalized") || "",
    language: url.searchParams.get("language") || url.searchParams.get("lang") || "",
    variant: url.searchParams.get("variant") || "",
    card_ref: url.searchParams.get("card_ref") || "",
    catalog_image: url.searchParams.get("catalog_image") || "",
    name: url.searchParams.get("name") || ""
  };
  const slabId = url.searchParams.get("slab_id") || "";
  if (slabId && env.DB) {
    const row = await env.DB.prepare(
      `SELECT m.game, m.set_name, m.set_code, m.code_printed, m.code_normalized, m.name,
              m.language, m.variant, m.catalog_image
       FROM slabs s JOIN card_models m ON m.id = s.card_model_id WHERE s.id = ?`
    ).bind(slabId).first();
    if (row) fields = { ...fields, ...row };
  }
  const refresh = url.searchParams.get("refresh") !== "0";
  if (refresh && fields.game) {
    await maybeRefreshModelPrice(env, fields);
  }
  const trend = await getTrendForRef(env, fields);
  if (!trend || (!trend.last_cents && !trend.history_count && !trend.windows)) {
    return J({ trend: trend || { card_ref: fields.card_ref || priceCardRef(fields), history_count: 0, points: [], official_points: [] } });
  }
  return J({ trend });
}

export { EUR_GAMES, USD_GAMES };
