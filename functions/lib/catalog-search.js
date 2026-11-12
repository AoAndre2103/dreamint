/**
 * Proxied multi-game catalog lookup with KV cache.
 * Never invents prices: Cardmarket EUR only when the upstream API actually provides it.
 */
const UA = "DreaMint/1.0 (https://dreamint.it; info@dreamint.it)";
const CACHE_TTL = 6 * 60 * 60;
const MAX_HITS = 24;

const IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",
  "cards.scryfall.io",
  "images.ygoprodeck.com",
  "optcgapi.com",
  "www.optcgapi.com",
  "cards.lorcast.io"
]);

const TCGDEX_LANG = { ITA: "it", ENG: "en", FRA: "fr", DEU: "de", ESP: "es", POR: "pt", JPN: "ja" };
const TCGDEX_LANG_BACK = { it: "ITA", en: "ENG", fr: "FRA", de: "DEU", es: "ESP", pt: "POR", ja: "JPN" };

export function safeExternalCatalogImage(url) {
  const s = String(url || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (!IMAGE_HOSTS.has(host)) return null;
    if (!/\.(webp|png|jpe?g|avif)(\?|#|$)/i.test(u.pathname + u.search)) {
      // Scryfall paths end in .jpg with a cache-buster query already handled
      if (!/\.(webp|png|jpe?g|avif)$/i.test(u.pathname)) return null;
    }
    return s.replace(/\/low\.webp$/i, "/high.webp");
  } catch (e) {
    return null;
  }
}

function cacheKey(parts) {
  return "catalog:v2:" + parts.map((p) => encodeURIComponent(String(p || "").trim().toLowerCase())).join(":");
}

async function kvGetJson(env, key) {
  if (!env || !env.PHOTOS) return null;
  try {
    const raw = await env.PHOTOS.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function kvPutJson(env, key, value, ttl) {
  if (!env || !env.PHOTOS) return;
  try {
    await env.PHOTOS.put(key, JSON.stringify(value), { expirationTtl: ttl || CACHE_TTL });
  } catch (e) { /* ignore cache write failures */ }
}

async function fetchJson(url, extraHeaders) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(extraHeaders || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  return { ok: res.ok, status: res.status, body };
}

async function cachedUpstream(env, key, url, extraHeaders) {
  const hit = await kvGetJson(env, key);
  if (hit && hit._cached) return { ok: true, status: 200, body: hit.body, cached: true };
  const out = await fetchJson(url, extraHeaders);
  if (out.ok && out.body != null) {
    await kvPutJson(env, key, { _cached: 1, body: out.body });
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function eurosOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function usdOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", ".").replace(/[^0-9.+-]/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function hit({ id, game, name, set_name, set_code, code_printed, image, image_small, language, variant, cardmarket_avg_euros, market_avg_usd, market_source, cardmarket }) {
  return {
    id: String(id || ""),
    game,
    name: String(name || "").trim(),
    set_name: String(set_name || "").trim(),
    set_code: set_code ? String(set_code) : "",
    code_printed: String(code_printed || "").trim(),
    image: safeExternalCatalogImage(image) || "",
    image_small: safeExternalCatalogImage(image_small) || safeExternalCatalogImage(image) || "",
    language: language || "ENG",
    variant: variant || "normal",
    cardmarket_avg_euros: eurosOrNull(cardmarket_avg_euros),
    market_avg_usd: usdOrNull(market_avg_usd),
    market_source: market_source ? String(market_source) : "",
    cardmarket: cardmarket || null
  };
}

function cardmarketWindowsFromObject(cm) {
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

function cardmarketWindowsFromTcgdex(card) {
  const cm = (card && card.pricing && card.pricing.cardmarket)
    || ((card && card.variants_detailed && card.variants_detailed[0] && card.variants_detailed[0].pricing && card.variants_detailed[0].pricing.cardmarket) || null);
  return cardmarketWindowsFromObject(cm);
}

function normalizeOpCode(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  // OP01-024, OP-01-024, OP01 024, ST01-012, P-700, EB01-001
  let m = s.match(/^(OP|ST|EB|PRB|PR)-?(\d{1,3})-?(\d{3})([A-Z]?)$/);
  if (m) return m[1] + m[2].padStart(2, "0") + "-" + m[3] + (m[4] || "");
  m = s.match(/^(P)-?(\d{2,4})$/);
  if (m) return "P-" + m[2];
  return "";
}

function looksLikeYgoCode(q) {
  return /^[A-Z0-9]{2,8}-[A-Z]{1,3}[0-9]{1,4}[A-Z]?$/i.test(String(q || "").trim());
}

export async function lookupExternalCatalog(env, { game, q, id, lang }) {
  const g = String(game || "pokemon").trim();
  const query = String(q || "").trim();
  const sourceId = String(id || "").trim();
  const language = String(lang || "ITA").trim().toUpperCase() || "ITA";
  if (!query && !sourceId) return { hits: [] };

  const key = cacheKey(["lookup", g, sourceId || query, language]);
  const cached = await kvGetJson(env, key);
  if (cached && Array.isArray(cached.hits)) return { hits: cached.hits, cached: true };

  let hits = [];
  try {
    if (g === "pokemon") hits = sourceId ? await pokemonDetail(env, sourceId, language) : await searchPokemon(env, query, language);
    else if (g === "magic") hits = sourceId ? await magicDetail(env, sourceId) : await searchMagic(env, query);
    else if (g === "yugioh") hits = sourceId ? await ygoDetail(env, sourceId) : await searchYgo(env, query, language);
    else if (g === "one_piece") hits = sourceId ? await opDetail(env, sourceId) : await searchOnePiece(env, query);
    else if (g === "lorcana") hits = sourceId ? await lorcanaDetail(env, sourceId) : await searchLorcana(env, query, language);
    else hits = [];
  } catch (err) {
    return { hits: [], error: "Catalogo temporaneamente non disponibile" };
  }

  hits = (hits || []).filter((h) => h && h.name).slice(0, MAX_HITS);
  await kvPutJson(env, key, { hits });
  return { hits };
}

/* ---------------- Pokémon (TCGdex) ---------------- */

function tcgdexLang(language) {
  return TCGDEX_LANG[language] || "it";
}

function tcgdexImg(image, size) {
  if (!image) return "";
  return String(image).replace(/\/$/, "") + "/" + (size || "low") + ".webp";
}

function parseCatalogQuery(q) {
  const raw = String(q || "").trim();
  const slash = raw.match(/^(.*?)(\d+)\s*\/\s*(\d+)\s*$/);
  if (slash) return { text: slash[1].trim(), localId: slash[2], official: slash[3], raw };
  const trailing = raw.match(/^(.*?)(?:\s+|:)#?(\d{1,4})$/);
  if (trailing && /[a-zA-Zàèéìòù°]/i.test(trailing[1])) {
    return { text: trailing[1].trim(), localId: trailing[2], official: "", raw };
  }
  if (/^#?\d{1,4}$/.test(raw)) return { text: "", localId: raw.replace(/^#/, ""), official: "", raw };
  return { text: raw, localId: "", official: "", raw };
}

function pokemonHit(c, lang) {
  if (!c || !c.id) return null;
  const official = c.set && c.set.cardCount && c.set.cardCount.official;
  const localId = String(c.localId || "");
  let code = official ? (localId.replace(/^0+/, "") + "/" + official) : localId;
  if (/^\d+$/.test(localId) && official) {
    code = localId.padStart(String(official).length, "0") + "/" + official;
  }
  const cm = cardmarketFromTcgdex(c);
  let variant = "normal";
  if (c.variants && c.variants.holo && !c.variants.normal) variant = "holo";
  return hit({
    id: "pokemon:" + c.id,
    game: "pokemon",
    name: c.name,
    set_name: (c.set && c.set.name) || "",
    set_code: (c.set && (c.set.symbol || c.set.id)) || "",
    code_printed: code || c.id,
    image: tcgdexImg(c.image, "high"),
    image_small: tcgdexImg(c.image, "low"),
    language: TCGDEX_LANG_BACK[lang] || "ITA",
    variant,
    cardmarket_avg_euros: cm,
    cardmarket: cardmarketWindowsFromTcgdex(c)
  });
}

function cardmarketFromTcgdex(card) {
  function amt(cm) {
    if (!cm) return null;
    const avg = Number(cm.avg);
    if (Number.isFinite(avg) && avg > 0) return avg;
    const trend = Number(cm.trend);
    if (Number.isFinite(trend) && trend > 0) return trend;
    return null;
  }
  let n = amt(card && card.pricing && card.pricing.cardmarket);
  if (n != null) return n;
  const rows = (card && card.variants_detailed) || [];
  for (const row of rows) {
    n = amt(row && row.pricing && row.pricing.cardmarket);
    if (n != null) return n;
  }
  return null;
}

async function searchPokemon(env, q, language) {
  const parsed = parseCatalogQuery(q);
  const langs = [tcgdexLang(language)];
  if (langs[0] !== "en") langs.push("en");
  const tasks = [];
  for (const lg of langs) {
    const base = "https://api.tcgdex.net/v2/" + lg + "/cards";
    const listUrl = (params) => {
      const u = new URL(base);
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== "") u.searchParams.set(k, v);
      });
      u.searchParams.set("pagination:itemsPerPage", parsed.text ? "24" : "50");
      return u.toString();
    };
    const names = [];
    const seed = parsed.text || (!parsed.localId ? parsed.raw : "");
    if (seed) {
      names.push(seed);
      const spaced = seed.replace(/-/g, " ").replace(/\s+/g, " ").trim();
      const hyphen = seed.replace(/\s+/g, "-");
      if (spaced && !names.includes(spaced)) names.push(spaced);
      if (hyphen && !names.includes(hyphen)) names.push(hyphen);
    }
    for (const name of names) {
      tasks.push(cachedUpstream(env, cacheKey(["tcgdex", lg, "name", name]), listUrl({ name })).then((r) => ({ lg, body: r.body })));
    }
    if (parsed.text) {
      tasks.push(cachedUpstream(env, cacheKey(["tcgdex", lg, "set", parsed.text]), listUrl({ "set.name": parsed.text })).then((r) => ({ lg, body: r.body })));
    }
    if (parsed.localId) {
      const lp = { localId: parsed.localId };
      if (parsed.text) lp.name = parsed.text;
      if (parsed.official) lp["set.cardCount.official"] = parsed.official;
      tasks.push(cachedUpstream(env, cacheKey(["tcgdex", lg, "lid", parsed.localId, parsed.text, parsed.official]), listUrl(lp)).then((r) => ({ lg, body: r.body })));
    }
    if (/^[a-z0-9]+(?:\.[a-z0-9]+)*-[a-z0-9]+$/i.test(parsed.raw)) {
      tasks.push(cachedUpstream(env, cacheKey(["tcgdex", lg, "id", parsed.raw]), base + "/" + encodeURIComponent(parsed.raw)).then((r) => {
        const card = r.body && r.body.id ? [r.body] : [];
        return { lg, body: card };
      }));
    }
  }
  const parts = await Promise.all(tasks);
  const seen = new Set();
  const out = [];
  for (const pack of parts) {
    const arr = Array.isArray(pack.body) ? pack.body : [];
    for (const c of arr) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      const h = pokemonHit(c, pack.lg);
      if (h) out.push(h);
    }
  }
  return out;
}

async function pokemonDetail(env, id, language) {
  const raw = id.replace(/^pokemon:/, "");
  const prefer = tcgdexLang(language);
  const langs = [prefer];
  if (prefer !== "en") langs.push("en");
  for (const lg of langs) {
    const r = await cachedUpstream(env, cacheKey(["tcgdex", "detail", lg, raw]), "https://api.tcgdex.net/v2/" + lg + "/cards/" + encodeURIComponent(raw));
    if (r.ok && r.body && r.body.id) {
      const h = pokemonHit(r.body, lg);
      return h ? [h] : [];
    }
  }
  return [];
}

/* ---------------- Magic (Scryfall) ---------------- */

function scryfallImage(c) {
  if (c.image_uris && (c.image_uris.large || c.image_uris.normal)) {
    return { large: c.image_uris.large || c.image_uris.normal, small: c.image_uris.small || c.image_uris.normal };
  }
  const face = (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || null;
  if (face) return { large: face.large || face.normal, small: face.small || face.normal };
  return { large: "", small: "" };
}

function scryfallPrice(c) {
  const p = (c && c.prices) || {};
  const eur = eurosOrNull(p.eur);
  if (eur != null) return eur;
  // Foil-only printing: eur_foil is still a Cardmarket EUR price. Never use USD.
  if (c && c.foil === true && c.nonfoil === false) return eurosOrNull(p.eur_foil);
  return null;
}

function scryfallLang(c) {
  const map = { en: "ENG", it: "ITA", fr: "FRA", de: "DEU", es: "ESP", pt: "POR", ja: "JPN", ko: "KOR", zhs: "CHS", zht: "CHT" };
  return map[c.lang] || "ENG";
}

function scryfallVariant(c) {
  const f = (c.finishes || []).map((x) => String(x).toLowerCase());
  if (c.full_art) return "full_art";
  if (c.promo) return "promo";
  if (f.includes("foil") && !f.includes("nonfoil")) return "holo";
  return "normal";
}

function magicHit(c) {
  if (!c || !c.id || !c.name) return null;
  const img = scryfallImage(c);
  return hit({
    id: "magic:" + c.id,
    game: "magic",
    name: c.name,
    set_name: c.set_name || "",
    set_code: (c.set || "").toUpperCase(),
    code_printed: c.collector_number || "",
    image: img.large,
    image_small: img.small,
    language: scryfallLang(c),
    variant: scryfallVariant(c),
    cardmarket_avg_euros: scryfallPrice(c)
  });
}

function magicQuery(q) {
  const raw = String(q || "").trim();
  if (/[:!"=]/.test(raw)) return raw;
  // "LEA 232" / "lea-232" / "232/lea"
  const setNum = raw.match(/^([A-Za-z0-9]{2,5})[\s\-/]+(\d+[A-Za-z]?)$/);
  if (setNum) return "set:" + setNum[1] + " cn:" + setNum[2];
  const numSet = raw.match(/^(\d+[A-Za-z]?)[\s\-/]+([A-Za-z0-9]{2,5})$/);
  if (numSet) return "set:" + numSet[2] + " cn:" + numSet[1];
  return "name:\"" + raw.replace(/"/g, "") + "\"";
}

async function searchMagic(env, q) {
  const query = magicQuery(q);
  const url = "https://api.scryfall.com/cards/search?unique=prints&order=released&q=" + encodeURIComponent(query);
  const r = await cachedUpstream(env, cacheKey(["scryfall", "search", query]), url);
  const data = r.body && Array.isArray(r.body.data) ? r.body.data : [];
  return data.map(magicHit).filter(Boolean);
}

async function magicDetail(env, id) {
  const raw = id.replace(/^magic:/, "");
  const r = await cachedUpstream(env, cacheKey(["scryfall", "id", raw]), "https://api.scryfall.com/cards/" + encodeURIComponent(raw));
  const h = r.body && magicHit(r.body);
  return h ? [h] : [];
}

/* ---------------- Yu-Gi-Oh! (YGOPRODeck) ---------------- */

function ygoLangFromSetCode(code) {
  const c = String(code || "").toUpperCase();
  if (/-IT/.test(c)) return "ITA";
  if (/-FR/.test(c)) return "FRA";
  if (/-DE/.test(c)) return "DEU";
  if (/-SP/.test(c)) return "ESP";
  if (/-PT/.test(c)) return "POR";
  if (/-JP/.test(c)) return "JPN";
  if (/-KR/.test(c) || /-KO/.test(c)) return "KOR";
  if (/-EN/.test(c) || /-E\d/.test(c)) return "ENG";
  return "ENG";
}

function ygoImage(c, small) {
  const img = (c.card_images && c.card_images[0]) || {};
  return small ? (img.image_url_small || img.image_url) : (img.image_url || img.image_url_small);
}

function ygoCardmarket(c) {
  const row = (c.card_prices && c.card_prices[0]) || {};
  return eurosOrNull(row.cardmarket_price);
}

function ygoHitsFromCard(c, preferLang, codeFilter) {
  if (!c || !c.name) return [];
  const sets = Array.isArray(c.card_sets) && c.card_sets.length ? c.card_sets : [{ set_name: "", set_code: String(c.id || ""), set_rarity: "" }];
  const cm = ygoCardmarket(c);
  const out = [];
  for (const s of sets) {
    const code = s.set_code || String(c.id || "");
    if (codeFilter && String(code).toUpperCase() !== String(codeFilter).toUpperCase()) continue;
    let variant = "normal";
    const rar = String(s.set_rarity || "").toLowerCase();
    if (/starlight|ultimate|secret|ultra|ghost|gold/.test(rar)) variant = "holo";
    else if (/parallel/.test(rar)) variant = "parallel";
    else if (/promo|limited/.test(rar)) variant = "promo";
    else if (/1st|first/.test(rar)) variant = "first_edition";
    out.push(hit({
      id: "yugioh:" + c.id + ":" + (code || "base"),
      game: "yugioh",
      name: c.name,
      set_name: s.set_name || "",
      set_code: code,
      code_printed: code,
      image: ygoImage(c, false),
      image_small: ygoImage(c, true),
      language: ygoLangFromSetCode(code),
      variant,
      cardmarket_avg_euros: cm
    }));
  }
  if (preferLang) {
    out.sort((a, b) => (b.language === preferLang ? 1 : 0) - (a.language === preferLang ? 1 : 0));
  }
  return out;
}

async function searchYgo(env, q, language) {
  const raw = String(q || "").trim();
  const code = looksLikeYgoCode(raw) ? raw : "";
  const url = "https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=" + encodeURIComponent(code ? raw.split("-")[0] : raw) + "&num=12&offset=0";
  // If query is a set code, fname on the prefix is weak; still fetch by fname of the full string too
  const urls = [];
  if (code) {
    // name search of the full code rarely works; try fname anyway, plus a second search without the code
    urls.push(["https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=" + encodeURIComponent(raw) + "&num=20&offset=0", cacheKey(["ygo", "fname", raw])]);
  } else {
    urls.push([url, cacheKey(["ygo", "fname", raw])]);
  }
  const seenCards = new Set();
  let expanded = [];
  for (const [u, key] of urls) {
    const r = await cachedUpstream(env, key, u);
    const data = r.body && Array.isArray(r.body.data) ? r.body.data : [];
    for (const c of data) {
      if (!c || seenCards.has(c.id)) continue;
      seenCards.add(c.id);
      expanded = expanded.concat(ygoHitsFromCard(c, language, code || ""));
    }
  }
  // If searching by set code and fname failed, we cannot scan the whole catalog; return what we have.
  // If we have many printings, cap per card then overall.
  if (!code) {
    const byCard = {};
    const mixed = [];
    for (const h of expanded) {
      const cid = h.id.split(":")[1];
      byCard[cid] = byCard[cid] || [];
      if (byCard[cid].length < 4) {
        byCard[cid].push(h);
        mixed.push(h);
      }
    }
    expanded = mixed;
  }
  return expanded;
}

async function ygoDetail(env, id) {
  const raw = id.replace(/^yugioh:/, "");
  const parts = raw.split(":");
  const cid = parts[0];
  const code = parts[1] || "";
  const r = await cachedUpstream(env, cacheKey(["ygo", "id", cid]), "https://db.ygoprodeck.com/api/v7/cardinfo.php?id=" + encodeURIComponent(cid));
  const c = r.body && Array.isArray(r.body.data) ? r.body.data[0] : null;
  if (!c) return [];
  const hits = ygoHitsFromCard(c, "", code && code !== "base" ? code : "");
  return hits.length ? hits : ygoHitsFromCard(c, "", "");
}

/* ---------------- One Piece (OPTCG API) ---------------- */

function opVariant(c) {
  const n = String(c.card_name || "");
  if (/\(Parallel\)/i.test(n) || /parallel/i.test(c.rarity || "")) return "parallel";
  if ((c.set_id || "") === "P" || /^P-/.test(c.card_set_id || "") || /promo/i.test(c.set_name || "")) return "promo";
  if (/^(SR|SEC|L|SP)$/i.test(c.rarity || "")) return "holo";
  return "normal";
}

function opHit(c) {
  if (!c || !(c.card_name || c.card_set_id)) return null;
  const name = String(c.card_name || "").replace(/\s+\(Parallel\)$/i, "").replace(/\s+\(\d+\)$/, "").trim() || c.card_name;
  return hit({
    id: "one_piece:" + (c.card_set_id || name) + ":" + (c.card_image_id || c.rarity || "base") + ":" + opVariant(c),
    game: "one_piece",
    name,
    set_name: c.set_name || c.set_id || "",
    set_code: c.set_id || "",
    code_printed: c.card_set_id || "",
    image: c.card_image || "",
    image_small: c.card_image || "",
    language: "ENG",
    variant: opVariant(c),
    cardmarket_avg_euros: null,
    market_avg_usd: usdOrNull(c.market_price),
    market_source: ""
  });
}

async function searchOnePiece(env, q) {
  const code = normalizeOpCode(q);
  if (code) {
    const hits = await opDetail(env, code);
    if (hits.length) return hits;
  }
  const endpoints = [
    ["https://optcgapi.com/api/sets/filtered/?card_name=" + encodeURIComponent(q), cacheKey(["op", "sets", q])],
    ["https://optcgapi.com/api/decks/filtered/?card_name=" + encodeURIComponent(q), cacheKey(["op", "decks", q])],
    ["https://optcgapi.com/api/promos/filtered/?card_name=" + encodeURIComponent(q), cacheKey(["op", "promos", q])]
  ];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < endpoints.length; i++) {
    if (i) await sleep(80);
    const [url, key] = endpoints[i];
    const r = await cachedUpstream(env, key, url);
    const arr = Array.isArray(r.body) ? r.body : [];
    for (const c of arr) {
      const h = opHit(c);
      if (!h || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
  }
  return out;
}

async function opDetail(env, id) {
  const raw = normalizeOpCode(id.replace(/^one_piece:/, "").split(":")[0]) || String(id.replace(/^one_piece:/, "").split(":")[0]);
  if (!raw) return [];
  const urls = [
    "https://optcgapi.com/api/sets/card/" + encodeURIComponent(raw) + "/",
    "https://optcgapi.com/api/decks/card/" + encodeURIComponent(raw) + "/",
    "https://optcgapi.com/api/promos/card/" + encodeURIComponent(raw) + "/"
  ];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    if (i) await sleep(80);
    const r = await cachedUpstream(env, cacheKey(["op", "card", raw, i]), urls[i]);
    const arr = Array.isArray(r.body) ? r.body : [];
    for (const c of arr) {
      const h = opHit(c);
      if (!h || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
  }
  return out;
}

/* ---------------- Lorcana (Lorcast) ---------------- */

function lorcanaLang(c) {
  const map = { en: "ENG", it: "ITA", fr: "FRA", de: "DEU", es: "ESP", pt: "POR", ja: "JPN" };
  return map[c.lang] || "ENG";
}

function lorcanaVariant(c) {
  const rar = String(c.rarity || "").toLowerCase();
  if (rar === "enchanted" || rar === "promo") return rar === "promo" ? "promo" : "alt_art";
  if (c.prices && c.prices.usd_foil && !c.prices.usd) return "holo";
  return "normal";
}

function lorcanaHit(c) {
  if (!c || !c.id || !c.name) return null;
  const imgs = (c.image_uris && c.image_uris.digital) || c.image_uris || {};
  const name = c.version ? (c.name + " — " + c.version) : c.name;
  const set = c.set || {};
  return hit({
    id: "lorcana:" + c.id,
    game: "lorcana",
    name,
    set_name: set.name || "",
    set_code: set.code || "",
    code_printed: c.collector_number ? String(c.collector_number) : "",
    image: imgs.large || imgs.normal || "",
    image_small: imgs.small || imgs.normal || "",
    language: lorcanaLang(c),
    variant: lorcanaVariant(c),
    cardmarket_avg_euros: null,
    market_avg_usd: lorcanaUsd(c),
    market_source: lorcanaSource(c)
  });
}
function lorcanaUsd(c) {
  const p = (c && c.prices) || {};
  const usd = usdOrNull(p.usd);
  if (usd) return usd;
  // foil-only printings have usd_foil and no usd
  if (usdOrNull(p.usd_foil) && (p.usd == null || p.usd === "")) return usdOrNull(p.usd_foil);
  return null;
}
function lorcanaSource(c) {
  if (!c) return "";
  if (c.tcgplayer_id || (c.purchase_uris && c.purchase_uris.tcgplayer)) return "TCGplayer";
  return "";
}

function lorcanaQuery(q) {
  const raw = String(q || "").trim();
  if (/[:"]/.test(raw)) return raw;
  const setNum = raw.match(/^([A-Za-z0-9]{1,6})[\s\-/]+(\d+[A-Za-z]?)$/);
  if (setNum) return "set:" + setNum[1] + " number:" + setNum[2];
  const justNum = raw.match(/^#?(\d{1,4})$/);
  if (justNum) return "number:" + justNum[1];
  return raw;
}

async function searchLorcana(env, q) {
  const query = lorcanaQuery(q);
  const url = "https://api.lorcast.com/v0/cards/search?unique=prints&q=" + encodeURIComponent(query);
  const r = await cachedUpstream(env, cacheKey(["lorcast", query]), url);
  const data = r.body && Array.isArray(r.body.results) ? r.body.results : [];
  return data.map(lorcanaHit).filter(Boolean);
}

async function lorcanaDetail(env, id) {
  const raw = id.replace(/^lorcana:/, "");
  const r = await cachedUpstream(env, cacheKey(["lorcast", "id", raw]), "https://api.lorcast.com/v0/cards/" + encodeURIComponent(raw));
  if (r.body && r.body.id) {
    const h = lorcanaHit(r.body);
    return h ? [h] : [];
  }
  // fallback: search by id if no card endpoint
  const r2 = await cachedUpstream(env, cacheKey(["lorcast", "qid", raw]), "https://api.lorcast.com/v0/cards/search?q=" + encodeURIComponent(raw));
  const data = r2.body && Array.isArray(r2.body.results) ? r2.body.results : [];
  const found = data.find((c) => c.id === raw) || data[0];
  const h = found && lorcanaHit(found);
  return h ? [h] : [];
}
