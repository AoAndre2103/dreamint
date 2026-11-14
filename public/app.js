
(function () {
  "use strict";
  var state = { user: null, cfg: window.GEMINT_CONFIG || {}, revealUnmount: null };
  var $app = document.getElementById("app");
  function tr(key, vars) {
    return (window.DreamintI18n && window.DreamintI18n.t) ? window.DreamintI18n.t(key, vars) : key;
  }
  function trx(key, fallback, vars) {
    var v = tr(key, vars);
    return v === key ? (fallback == null ? key : fallback) : v;
  }
  function langIsEn() {
    return window.DreamintI18n && window.DreamintI18n.getLang && window.DreamintI18n.getLang() === "en";
  }
  // v25: commission text always comes from the plans in the config (no hard-coded rate).
  function feeRangeText(cfg) {
    var plans = (cfg && cfg.plans && cfg.plans.length) ? cfg.plans : [];
    if (!plans.length) return "";
    var bps = plans.map(function (p) { return Number(p.fee_bps) || 0; });
    var fmt = function (b) { var s = (b / 100).toFixed(1).replace(/\.0$/, ""); return (langIsEn() ? s : s.replace(".", ",")) + "%"; };
    var lo = Math.min.apply(null, bps), hi = Math.max.apply(null, bps);
    return lo === hi ? fmt(lo) : fmt(lo) + "–" + fmt(hi);
  }
  function italyShipNote() {
    return langIsEn() ? '<p class="ship-italy-note">' + tr("ship.italyOnly") + "</p>" : "";
  }
  function localizeShip(m) {
    if (!m) return m;
    var copy = Object.assign({}, m);
    copy.label = trx("ship." + m.id + ".label", m.label);
    if (m.pointLabel) copy.pointLabel = trx("ship." + m.id + ".point", m.pointLabel);
    if (m.finderLabel) copy.finderLabel = trx("ship." + m.id + ".finder", m.finderLabel);
    return copy;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (opts.body instanceof FormData) delete headers["content-type"];
    return fetch("/api/" + path, {
      credentials: "include",
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: headers,
      body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error(d.error || d.message || tr("error.generic", { status: r.status }));
          err.status = r.status;
          err.code = d.code || d.error || "";
          var ra = r.headers.get("Retry-After");
          if (ra) err.retryAfter = parseInt(ra, 10) || ra;
          throw err;
        }
        return d;
      });
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function euros(cents) { return formatEur(Number(cents || 0) / 100); }
  function priceTrendSlot(l, compact) {
    if (!window.DreaMintPrices || !l) return "";
    if (compact) return l.price_trend ? window.DreaMintPrices.placeholder({ trend: l.price_trend }, "", true) : "";
    return '<div class="price-trend pt-detail" data-slab-id="' + esc(l.slab_id) + '"></div>';
  }
  function gameLabel(id) {
    if (!id) return "";
    var translated = trx("game." + id, "");
    if (translated) return translated;
    var g = (state.cfg.games || []).find(function (x) { return x.id === id; });
    if (g && g.label) return g.label;
    return String(id).replace(/[_-]+/g, " ").replace(/(^|\s)\S/g, function (ch) { return ch.toUpperCase(); });
  }
  function variantLabel(id) {
    var translated = trx("variant." + id, "");
    if (translated) return translated;
    var v = (state.cfg.variants || []).find(function (x) { return x.id === id; });
    return v ? v.label : id;
  }
  function conditionLabel(id) {
    var c = (state.cfg.conditions || []).find(function (x) { return x.id === id; });
    return c ? c.label : (id || "");
  }
  function graderLabel(id) {
    if (id === "NONE") return tr("grader.NONE");
    var g = (state.cfg.graders || []).find(function (x) { return x.id === id; });
    return g ? g.label : id;
  }
  function statusLabel(s) {
    return trx("status." + s, s);
  }
  function pillStatus(s) {
    var cls = s === "rejected" ? "bad" : s === "in_review" ? "warn" : "gold";
    return '<span class="pill ' + cls + '">' + esc(statusLabel(s)) + '</span>';
  }
  var LANG_NAMES = { ITA: "Italiano", ENG: "Inglese", JPN: "Giapponese", FRA: "Francese", DEU: "Tedesco", ESP: "Spagnolo", POR: "Portoghese", KOR: "Coreano", CHS: "Cinese semplificato", CHT: "Cinese tradizionale" };
  var COND_TITLE = { NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Lightly Played", PL: "Played", Poor: "Poor" };
  function languageName(code) { return trx("lang." + code, LANG_NAMES[code] || code || ""); }
  function titleSuffix(c) {
    if (c.is_ungraded || c.raw) return COND_TITLE[c.card_condition] || conditionLabel(c.card_condition) || "Raw";
    var g = c.grader && c.grader !== "NONE" ? c.grader : "";
    return (g + (c.grade ? " " + c.grade : "")).trim() || "Graded";
  }
  function cardTitle(c) {
    var model = c.model || {};
    var game = gameLabel(c.game || model.game);
    var lang = languageName(c.language || model.language);
    var setName = c.set_name || model.set_name || "";
    var name = c.card_name || c.name || model.name || "";
    return [game, lang, setName, name].filter(Boolean).join(" - ") + " (" + titleSuffix(c) + ")";
  }
  function photoSrc(id, kind, w) { return window.GemintPhotos.url(id, kind, w); }
  function photoSrcset(id, kind) { return window.GemintPhotos.srcset(id, kind); }
  function photoImg(id, kind, sizes, cls) {
    return '<img class="' + (cls || "") + '" src="' + photoSrc(id, kind, 448) + '" srcset="' + photoSrcset(id, kind) + '" sizes="' + esc(sizes || "(max-width: 860px) 90vw, 420px") + '" alt="" loading="lazy" onerror="window.GemintPhotos&&window.GemintPhotos.fallback(this)">';
  }
  function catalogArt(c) {
    if (!c || c.is_ungraded) return "";
    return c.catalog_image || (c.model && c.model.catalog_image) || "";
  }
  function digitalArt(c) {
    var cat = catalogArt(c);
    if (cat) return { img: cat, srcset: "" };
    if (c && c.front_url) return { img: c.front_url, srcset: "" };
    var id = c && (c.slab_id || c.id);
    if (!id) return { img: "", srcset: "" };
    return { img: photoSrc(id, "front", 560), srcset: photoSrcset(id, "front") };
  }
  var CHARIZARD_ART = "https://assets.tcgdex.net/it/swsh/swsh4/25/high.webp";
  var PIKACHU_ART = "https://assets.tcgdex.net/it/sv/sv03.5/025/high.webp";
  var LUFFY_ART = "https://optcgapi.com/media/static/Card_Images/OP05-119_p1.jpg";
  function exampleCards() {
    return [
      { game: tr("game.pokemon"), language: tr("lang.ITA"), set_name: tr("ex.set151"), name: "Pikachu", card_name: "Pikachu", code: "25/165", grader: "CGC", grade: "10", tier: "epica", tierLabel: tr("tier.epica"), cls: "mock-a", img: PIKACHU_ART },
      { game: tr("game.pokemon"), language: tr("lang.ITA"), set_name: tr("ex.setVv"), name: "Charizard", card_name: "Charizard", code: "25/185", grader: "PSA", grade: "10", tier: "leggendaria", tierLabel: tr("tier.leggendaria"), cls: "mock-b", img: CHARIZARD_ART },
      { game: tr("game.one_piece"), language: tr("lang.ENG"), set_name: "Awakening of the New Era", name: "Monkey D. Luffy", card_name: "Monkey D. Luffy", code: "OP05-119", grader: "BGS", grade: "10", tier: "mitica", tierLabel: tr("tier.mitica"), cls: "mock-c", img: LUFFY_ART }
    ];
  }
  var TIER_INFO = {
    comune: { id: "comune", label: "Comune", pct: "70%", callout: "Il 70% delle carte" },
    rara: { id: "rara", label: "Rara", pct: "20%", callout: "Il 20% delle carte" },
    epica: { id: "epica", label: "Epica", pct: "8%", callout: "L’8% delle carte" },
    leggendaria: { id: "leggendaria", label: "Leggendaria", pct: "1,9%", callout: "Solo l’1,9% delle carte", badge: "Leggendaria" },
    mitica: { id: "mitica", label: "Mitica", pct: "0,1%", callout: "Solo lo 0,1% delle carte", badge: "Mitica · 1 su 1000" }
  };
  var TIER_ORDER = ["comune", "rara", "epica", "leggendaria", "mitica"];
  function tierInfo(id) {
    var base = TIER_INFO[id];
    if (!base) return null;
    var out = Object.assign({}, base);
    out.label = tr("tier." + id);
    out.pct = tr("tier." + id + ".pct");
    out.callout = tr("tier." + id + ".callout");
    if (id === "mitica") out.badge = tr("tier.mitica.badge");
    else if (id === "leggendaria") out.badge = tr("tier.leggendaria");
    return out;
  }
  function rarityChipHtml(tier) {
    var t = tierInfo(tier);
    if (!t) return "";
    return '<span class="slab-tier-chip">' + esc(t.badge || (t.label + " · " + t.pct)) + "</span>";
  }
  function rarityCalloutHtml(tier) {
    var t = tierInfo(tier);
    if (!t) return "";
    return '<div class="rarity-callout rarity-callout-' + t.id + '">' +
      '<span class="pill pill-' + t.id + '">' + esc(t.label) + "</span>" +
      "<strong>" + esc(t.callout) + "</strong></div>";
  }
  function rarityPillsHtml(tier) {
    var t = tierInfo(tier);
    if (!t) return "";
    return '<span class="pill pill-' + t.id + '">' + esc(t.label) + "</span>" +
      '<span class="rarity-pct">' + esc(t.callout) + "</span>";
  }
  function conditionFilterRow(active) {
    var ids = ["NM", "EX", "GD", "LP", "PL", "Poor"];
    return '<div class="chip-row" role="navigation" aria-label="' + esc(tr("filter.condition") || "Condizione") + '">' +
      '<a class="chip' + (!active ? " on" : "") + '" href="#/non-gradate" data-link>' + esc(tr("filter.all")) + "</a>" +
      ids.map(function (id) {
        return '<a class="chip' + (active === id ? " on" : "") + '" href="#/non-gradate/' + id + '" data-link>' + esc(id) + "</a>";
      }).join("") +
      "</div>";
  }
    function rarityFilterRow(active) {
    return '<div class="chip-row rarity-filters" role="navigation" aria-label="' + esc(tr("filter.rarity")) + '">' +
      '<a class="chip' + (!active ? " on" : "") + '" href="#/gradate" data-link>' + esc(tr("filter.all")) + "</a>" +
      TIER_ORDER.map(function (id) {
        var t = tierInfo(id);
        return '<a class="chip chip-' + id + (active === id ? " on" : "") + '" href="#/gradate/' + id + '" data-link>' +
          esc(t.label) + " · " + t.pct + "</a>";
      }).join("") + "</div>";
  }
  function slabSparkles(tier) {
    if (tier !== "leggendaria" && tier !== "mitica") return "";
    var n = tier === "mitica" ? 9 : 6;
    var out = '<div class="slab-sparkles" aria-hidden="true">';
    for (var i = 0; i < n; i++) out += "<i></i>";
    return out + "</div>";
  }
  function charizardFrame(tier, extra) {
    extra = extra || {};
    var t = tierInfo(tier);
    var serials = { comune: "#0142", rara: "#0088", epica: "#0031", leggendaria: "#0007", mitica: "#0001 / 1.000" };
    return slabFrame({
      img: CHARIZARD_ART,
      grader: extra.grader || "PSA",
      grade: extra.grade || "10",
      serial: extra.serial || serials[tier] || "#0001",
      cert: extra.cert || (tier === "mitica" ? "PSA 12345678" : ""),
      tier: tier,
      tierLabel: t ? t.label : "",
      sizes: extra.sizes || "(max-width:900px) 42vw, 180px",
      cls: extra.cls || ""
    });
  }
  function rarityLadder() {
    return '<section class="rarity-ladder" id="scala-rarita">' +
      '<div class="page-head"><div><h2>' + tr("ladder.title") + "</h2>" +
      "<p>" + tr("ladder.lede") + "</p></div></div>" +
      '<div class="ladder-grid">' + TIER_ORDER.map(function (id) {
        var t = tierInfo(id);
        return '<figure class="ladder-item" data-tier="' + id + '">' + charizardFrame(id) +
          "<figcaption><strong>" + esc(t.label) + "</strong><span class=\"ladder-pct\">" + t.pct +
          "</span><em>" + esc(t.callout) + "</em></figcaption></figure>";
      }).join("") + "</div></section>";
  }
  function rareShowcase() {
    return '<section class="rare-showcase" id="le-piu-rare">' +
      '<div class="page-head"><div><h2>' + tr("rare.title") + "</h2>" +
      "<p>" + tr("rare.lede") + "</p></div></div>" +
      '<div class="rare-row">' +
      '<figure class="rare-feature" data-tier="leggendaria">' + charizardFrame("leggendaria", { sizes: "(max-width:860px) 70vw, 280px", cls: "feature-slab" }) +
      "<figcaption><strong>" + esc(tr("tier.leggendaria")) + "</strong><span>" + esc(tierInfo("leggendaria").callout) + "</span></figcaption></figure>" +
      '<figure class="rare-feature mitica-closeup" id="mitica-closeup" data-tier="mitica">' + charizardFrame("mitica", { sizes: "(max-width:860px) 78vw, 320px", cls: "feature-slab feature-mitica" }) +
      "<figcaption><strong>" + esc(tr("tier.mitica.badge")) + "</strong><span>" + esc(tierInfo("mitica").callout) + "</span></figcaption></figure>" +
      "</div></section>";
  }
  var TCGDEX_LANG = { ITA: "it", ENG: "en", FRA: "fr", DEU: "de", ESP: "es", POR: "pt", JPN: "ja" };
  var TCGDEX_LANG_BACK = { it: "ITA", en: "ENG", fr: "FRA", de: "DEU", es: "ESP", pt: "POR", ja: "JPN" };
  function tcgdexLang() {
    var el = document.getElementById("language");
    return TCGDEX_LANG[(el && el.value) || "ITA"] || "it";
  }
  function tcgdexImg(image, size) {
    if (!image) return "";
    return image.replace(/\/$/, "") + "/" + (size || "low") + ".webp";
  }
  function fetchJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function parseCatalogQuery(q) {
    var raw = String(q || "").trim();
    var slash = raw.match(/^(.*?)(\d+)\s*\/\s*(\d+)\s*$/);
    if (slash) return { text: slash[1].trim(), localId: slash[2], official: slash[3], raw: raw };
    var trailing = raw.match(/^(.*?)(?:\s+|:)#?(\d{1,4})$/);
    if (trailing && /[a-zA-Zàèéìòù°]/i.test(trailing[1])) {
      return { text: trailing[1].trim(), localId: trailing[2], official: "", raw: raw };
    }
    if (/^#?\d{1,4}$/.test(raw)) return { text: "", localId: raw.replace(/^#/, ""), official: "", raw: raw };
    return { text: raw, localId: "", official: "", raw: raw };
  }
  function nameVariants(text) {
    var s = String(text || "").trim();
    if (!s) return [];
    var out = [s];
    var spaced = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
    var hyphen = s.replace(/\s+/g, "-");
    if (spaced && out.indexOf(spaced) < 0) out.push(spaced);
    if (hyphen && out.indexOf(hyphen) < 0) out.push(hyphen);
    return out;
  }
  function scoreTcgdexHit(c, parsed) {
    var name = String(c.name || "").toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
    var qtext = String(parsed.text || parsed.raw || "").toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
    var lid = String(c.localId || "").replace(/^0+/, "");
    var score = 0;
    if (qtext && name === qtext) score += 100;
    else if (qtext && name.indexOf(qtext) === 0) score += 70;
    else if (qtext && name.indexOf(qtext) >= 0) score += 40;
    else if (qtext) {
      var tokens = qtext.split(" ").filter(Boolean);
      score += 15 * tokens.filter(function (tok) { return name.indexOf(tok) >= 0; }).length;
    }
    if (parsed.localId && lid === String(parsed.localId).replace(/^0+/, "")) score += 80;
    if (parsed.official && c.set && c.set.cardCount && String(c.set.cardCount.official) === String(parsed.official)) score += 40;
    if (String(c.id).toLowerCase() === String(parsed.raw || "").toLowerCase()) score += 120;
    if (c.image) score += 5;
    return score;
  }
  function searchTcgdex(q, lang) {
    var parsed = parseCatalogQuery(q);
    var tasks = [];
    var base = "https://api.tcgdex.net/v2/" + lang + "/cards";
    function listUrl(params) {
      var u = new URL(base);
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== "") u.searchParams.set(k, params[k]);
      });
      u.searchParams.set("pagination:itemsPerPage", parsed.text ? "24" : "50");
      return u.toString();
    }
    nameVariants(parsed.text || (!parsed.localId ? parsed.raw : "")).forEach(function (name) {
      tasks.push(fetchJson(listUrl({ name: name })));
    });
    if (parsed.text) tasks.push(fetchJson(listUrl({ "set.name": parsed.text })));
    if (parsed.localId && parsed.official) {
      tasks.push(fetchJson(listUrl({ localId: parsed.localId, "set.cardCount.official": parsed.official })));
    }
    if (parsed.localId) {
      var lp = { localId: parsed.localId };
      if (parsed.text) lp.name = parsed.text;
      tasks.push(fetchJson(listUrl(lp)));
    }
    if (/^[a-z0-9]+(?:\.[a-z0-9]+)*-[a-z0-9]+$/i.test(parsed.raw)) {
      tasks.push(fetchJson(base + "/" + encodeURIComponent(parsed.raw)).then(function (card) {
        return card && card.id ? [card] : [];
      }));
    }
    if (!tasks.length) return Promise.resolve([]);
    return Promise.all(tasks).then(function (parts) {
      var seen = {}, out = [];
      parts.forEach(function (arr) {
        (Array.isArray(arr) ? arr : []).forEach(function (c) {
          if (!c || !c.id || seen[c.id]) return;
          seen[c.id] = true;
          out.push(c);
        });
      });
      out.sort(function (a, b) { return scoreTcgdexHit(b, parsed) - scoreTcgdexHit(a, parsed); });
      return out.slice(0, parsed.text ? 16 : 48);
    });
  }
  function cardmarketAmount(cm) {
    if (!cm) return null;
    var avg = Number(cm.avg);
    if (Number.isFinite(avg) && avg > 0) return avg;
    var trend = Number(cm.trend);
    if (Number.isFinite(trend) && trend > 0) return trend;
    return null;
  }
  function cardmarketHint(card) {
    if (!card) return null;
    var amount = cardmarketAmount(card.pricing && card.pricing.cardmarket);
    if (amount != null) return amount;
    var rows = card.variants_detailed || [];
    for (var i = 0; i < rows.length; i++) {
      amount = cardmarketAmount(rows[i] && rows[i].pricing && rows[i].pricing.cardmarket);
      if (amount != null) return amount;
    }
    return null;
  }
  function formatEur(n) {
    var num = Number(n);
    if (!Number.isFinite(num)) return "";
    var core = langIsEn() ? num.toFixed(2) : num.toFixed(2).replace(".", ",");
    return core + " €";
  }
  function cardmarketLabel(amountOrCents, asCents) {
    var amount = amountOrCents == null ? null : (asCents ? Number(amountOrCents) / 100 : Number(amountOrCents));
    if (amount == null || !Number.isFinite(amount) || amount <= 0) return tr("price.unavailable");
    return tr("price.cardmarket", { price: formatEur(amount) });
  }
  function formatUsd(n) {
    var num = Number(n);
    if (!Number.isFinite(num)) return "";
    return "$" + num.toFixed(2);
  }
  function catalogPriceText(h) {
    if (h && h.cardmarket_avg_euros != null && Number(h.cardmarket_avg_euros) > 0) {
      return cardmarketLabel(h.cardmarket_avg_euros, false);
    }
    if (h && h.market_avg_usd != null && Number(h.market_avg_usd) > 0) {
      var price = formatUsd(h.market_avg_usd);
      return h.market_source
        ? tr("price.indicativeUsdSource", { price: price, source: h.market_source })
        : tr("price.indicativeUsd", { price: price });
    }
    return tr("price.unavailable");
  }
  function showTcgdexRef(card, lang) {
    var box = document.getElementById("ref-card");
    if (!box) return;
    var img = document.getElementById("ref-img");
    var price = document.getElementById("ref-price");
    if (img) {
      img.src = tcgdexImg(card.image, "low");
      img.alt = tr("reg.refAlt", { name: card.name || "" });
    }
    var hint = cardmarketHint(card);
    if (price) price.textContent = cardmarketLabel(hint, false);
    var hidAvg = document.getElementById("cardmarket-avg");
    if (hidAvg) hidAvg.value = hint != null ? String(hint) : "";
    box.hidden = false;
  }
  function applyTcgdexCard(card, lang) {
    var official = card.set && card.set.cardCount && card.set.cardCount.official;
    var localId = String(card.localId || "");
    var code = official ? (localId.replace(/^0+/, "") + "/" + official) : localId;
    if (/^\d+$/.test(localId) && official) {
      code = localId.padStart(String(official).length, "0") + "/" + official;
    }
    document.getElementById("model-id").value = "";
    document.getElementById("game").value = "pokemon";
    document.getElementById("set_name").value = (card.set && card.set.name) || "";
    document.getElementById("code").value = code;
    document.getElementById("name").value = card.name || "";
    // Keep the listing language chosen by the seller (do not overwrite with the catalog locale).
    if (card.variants && card.variants.holo && !card.variants.normal) {
      document.getElementById("variant").value = "holo";
    }
    showTcgdexRef(card, lang);
    var hid = document.getElementById("catalog-image");
    if (hid) hid.value = tcgdexImg(card.image, "high");
  }
  function catalogPlaceholders(game) {
    return trx("cat.ph." + game, tr("cat.ph.default"));
  }
  function selectedCatalogGame() {
    var el = document.getElementById("cat-game") || document.getElementById("game");
    return (el && el.value) || "pokemon";
  }
  function showCatalogRef(h) {
    var box = document.getElementById("ref-card");
    if (!box || !h) return;
    var img = document.getElementById("ref-img");
    var price = document.getElementById("ref-price");
    if (img) {
      img.src = h.image_small || h.image || "";
      img.alt = tr("reg.refAlt", { name: h.name || "" });
      img.hidden = !(h.image_small || h.image);
    }
    if (price) price.textContent = catalogPriceText(h);
    var hidAvg = document.getElementById("cardmarket-avg");
    if (hidAvg) hidAvg.value = (h.cardmarket_avg_euros != null && h.cardmarket_avg_euros > 0) ? String(h.cardmarket_avg_euros) : "";
    var hidUsd = document.getElementById("market-avg-usd");
    if (hidUsd) hidUsd.value = (h.market_avg_usd != null && h.market_avg_usd > 0 && !(h.cardmarket_avg_euros > 0)) ? String(h.market_avg_usd) : "";
    var hid = document.getElementById("catalog-image");
    if (hid) hid.value = h.image || h.image_small || "";
    box.hidden = false;
  }
  function applyCatalogHit(h) {
    if (!h) return;
    var model = document.getElementById("model-id");
    if (model) model.value = "";
    var game = document.getElementById("game");
    var catGame = document.getElementById("cat-game");
    if (game && h.game) game.value = h.game;
    if (catGame && h.game) catGame.value = h.game;
    document.getElementById("set_name").value = h.set_name || "";
    document.getElementById("code").value = h.code_printed || "";
    document.getElementById("name").value = h.name || "";
    if (h.game && h.game !== "pokemon" && h.language) {
      var langEl = document.getElementById("language");
      if (langEl) {
        var opt = Array.prototype.some.call(langEl.options, function (o) { return o.value === h.language; });
        if (opt) langEl.value = h.language;
      }
    }
    if (h.variant) {
      var varEl = document.getElementById("variant");
      if (varEl) {
        var has = Array.prototype.some.call(varEl.options, function (o) { return o.value === h.variant; });
        if (has) varEl.value = h.variant;
      }
    }
    showCatalogRef(h);
  }
  function gameSearchSupported(game) {
    return ["pokemon", "magic", "yugioh", "one_piece", "lorcana"].indexOf(game) >= 0;
  }
  function exampleTitle(ex) {
    return ex.game + " - " + ex.language + " - " + ex.set_name + " - " + ex.name + " (" + ex.grader + " " + ex.grade + ")";
  }


  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  function setTheme(theme, persist) {
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#07131C" : "#F3FBFA");
    if (persist) {
      try { localStorage.setItem("gemint-theme", theme); } catch (e) {}
    }
    syncThemeToggle();
  }
  function syncThemeToggle() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var dark = currentTheme() === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.setAttribute("aria-label", dark ? tr("theme.toDay") : tr("theme.night"));
    btn.title = dark ? tr("theme.day") : tr("theme.night");
    var lab = btn.querySelector(".theme-toggle-label");
    if (lab) lab.textContent = dark ? tr("theme.day") : tr("theme.night");
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("gemint-theme"); } catch (e) {}
    if (!document.documentElement.getAttribute("data-theme")) {
      var initial = saved || "dark";
      setTheme(initial, false);
    } else {
      syncThemeToggle();
    }
    var btn = document.getElementById("theme-toggle");
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", function () {
        setTheme(currentTheme() === "dark" ? "light" : "dark", true);
      });
    }
    if (window.matchMedia && !window._gemintSchemeBound) {
      window._gemintSchemeBound = true;
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
        try { if (localStorage.getItem("gemint-theme")) return; } catch (err) { return; }
        return; // v2: dark (blu notte) is the default unless the user picks frost

      });
    }
  }

  function serialFmt(n, total) {
    if (n == null || n === "") return "";
    var left = "#" + String(n).padStart(4, "0");
    if (total == null || total === "") return left + " / ∞";
    var t = String(total);
    if (/^\d+$/.test(t)) t = t.padStart(4, "0");
    return left + " / " + t;
  }
  // Ungraded (physical-only) card: plain photo, no slab/rarity frame, no certificate wording.
  // Uses the seller's front photo; if there is none, the official image clearly labelled as a reference.
  function rawCardFigure(c, opts) {
    opts = opts || {};
    var id = c.slab_id || c.id;
    var cat = (c.model && c.model.catalog_image) || c.catalog_image_ref || "";
    var custom = c.front_url || "";
    var hasPhoto = !!custom || !(c.photos && c.photos.front === false);
    var img;
    if (custom) {
      img = '<img class="raw-photo" src="' + esc(custom) + '" alt="' + esc(tr("raw.photoAlt", { name: cardTitle(c) })) + '" loading="lazy">';
    } else if (hasPhoto) {
      img = '<img class="raw-photo" src="' + photoSrc(id, "front", 448) + '" srcset="' + photoSrcset(id, "front") + '" sizes="' + esc(opts.sizes || "(max-width:600px) 46vw, 260px") + '" alt="' + esc(tr("raw.photoAlt", { name: cardTitle(c) })) + '" loading="lazy"' +
        (cat ? ' data-ref="' + esc(cat) + '" onerror="this.onerror=null;this.src=this.dataset.ref;this.removeAttribute(\'srcset\');var f=this.closest(\'figure\');if(f)f.classList.add(\'is-ref\');"' : ' onerror="window.GemintPhotos&&window.GemintPhotos.fallback(this)"') + ">";
    } else {
      img = cat ? '<img class="raw-photo" src="' + esc(cat) + '" alt="' + esc(tr("raw.refAlt", { name: cardTitle(c) })) + '" loading="lazy">' : '<span class="raw-nophoto">' + esc(tr("raw.noPhoto")) + "</span>";
    }
    var isRef = !custom && !!(c.photos && c.photos.front === false) && !!cat;
    // v24: ungraded cards also show the seller's back photo (album: mini inset; card page: flip).
    var back = rawBackHtml(c, id, opts);
    if (opts.flip) {
      return '<figure class="raw-card raw-flip' + (isRef ? " is-ref" : "") + '" role="button" tabindex="0" aria-pressed="false" aria-label="' + esc(tr("raw.showBack")) + '" data-raw-flip>' +
        '<div class="raw-flip-inner"><div class="raw-card-img raw-face raw-face-front">' + img + '<span class="raw-ref-tag">' + esc(tr("raw.refTag")) + "</span></div>" +
        '<div class="raw-card-img raw-face raw-face-back">' + back + "</div></div>" +
        '<figcaption class="raw-flip-hint">↻ ' + esc(tr("raw.showBack")) + "</figcaption></figure>";
    }
    return '<figure class="raw-card' + (isRef ? " is-ref" : "") + (opts.album ? " is-album" : "") + '">' +
      '<div class="raw-card-img">' + img + '<span class="raw-ref-tag">' + esc(tr("raw.refTag")) + "</span>" +
      (opts.album ? '<span class="raw-back-mini" title="' + esc(tr("gal.back")) + '">' + back + "</span>" : "") + "</div>" +
      (opts.album ? '<figcaption class="raw-album-tag">' + esc(opts.albumTag || tr("raw.album")) + "</figcaption>" : "") + "</figure>";
  }
  function rawBackHtml(c, id, opts) {
    var ph = '<span class="raw-back-ph">' + esc(tr("raw.backMissing")) + "</span>";
    var missing = c.missing_back === true || (c.photos && c.photos.back === false);
    if (missing || !id) return ph;
    var src = (c.back_url && opts.album && c.back_url.indexOf("?") === -1 ? c.back_url + "?w=224" : c.back_url) || photoSrc(id, "back", opts.album ? 224 : 448);
    return '<img class="raw-back-photo" src="' + esc(src) + '" alt="' + esc(tr("gal.back") + " — " + cardTitle(c)) + '" loading="lazy">';
  }
  // CSP forbids inline handlers: swap a broken back photo for the clean placeholder (capture phase).
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || !t.classList || !t.classList.contains("raw-back-photo")) return;
    var ph = document.createElement("span");
    ph.className = "raw-back-ph";
    ph.textContent = tr("raw.backMissing");
    t.replaceWith(ph);
  }, true);
  function bindRawFlip(root) {
    (root || document).querySelectorAll("[data-raw-flip]").forEach(function (f) {
      if (f.getAttribute("data-flip-bound")) return;
      f.setAttribute("data-flip-bound", "1");
      function toggle() {
        var on = !f.classList.contains("is-flipped");
        f.classList.toggle("is-flipped", on);
        f.setAttribute("aria-pressed", on ? "true" : "false");
        f.setAttribute("aria-label", tr(on ? "raw.showFront" : "raw.showBack"));
        var hint = f.querySelector(".raw-flip-hint");
        if (hint) hint.textContent = "↻ " + tr(on ? "raw.showFront" : "raw.showBack");
      }
      f.addEventListener("click", toggle);
      f.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggle(); }
      });
    });
  }
  var USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
  function publicAlbumsOn() {
    if (state.cfg && state.cfg.public_albums === false) return false;
    if (state.cfg && state.cfg.public_albums === true) return true;
    if (state.user && Object.prototype.hasOwnProperty.call(state.user, "album_public")) return true;
    if (state.user && Object.prototype.hasOwnProperty.call(state.user, "username")) return true;
    return false;
  }
  function normalizeUsername(v) { return String(v || "").trim().toLowerCase(); }
  function usernameValid(v) { return USERNAME_RE.test(normalizeUsername(v)); }
  function pageUsernameGate() {
    var u = state.user || {};
    return '<section class="panel username-gate" style="max-width:560px;margin:24px auto"><h1>' + esc(tr("gate.title")) + "</h1>" +
      "<p>" + esc(tr("gate.lede", { name: u.display_name || "" })) + "</p>" +
      '<form id="username-gate-form" novalidate><label class="field">' + esc(tr("auth.username")) +
      '<input name="username" id="gate-username" type="text" required minlength="3" maxlength="20" autocapitalize="none" autocomplete="username" spellcheck="false" placeholder="' + esc(tr("auth.usernamePh")) + '"></label>' +
      '<p class="dim" id="gate-hint" aria-live="polite">' + esc(tr("gate.hint")) + "</p>" +
      '<p class="error" id="gate-err" hidden></p>' +
      '<p class="row-actions"><button class="btn primary" type="submit" id="gate-save" disabled>' + esc(tr("gate.save")) + "</button>" +
      '<button class="btn ghost" type="button" id="gate-logout">' + esc(tr("gate.logout")) + "</button></p></form>" +
      '<p class="dim">' + esc(tr("gate.why")) + ' <a href="/legal/privacy">' + esc(tr("footer.privacy")) + "</a> · " +
      '<a href="#/assistenza" data-link>' + esc(tr("nav.support")) + "</a></p></section>";
  }
  // v26: plan choice (preference only; BETA is free). Order FREE · PRO (Consigliato, centre) · BUSINESS.
  function planPickerHtml(selected) {
    var plans = (state.cfg && state.cfg.plans && state.cfg.plans.length) ? state.cfg.plans : ((window.GEMINT_CONFIG && window.GEMINT_CONFIG.plans) || []);
    var fmtPct = function (b) { var x = (b / 100).toFixed(1).replace(/\.0$/, ""); return (langIsEn() ? x : x.replace(".", ",")) + "%"; };
    return '<fieldset class="privacy-choice plan-choice"><legend>' + esc(tr("plan.legend")) + "</legend>" +
      plans.map(function (p) {
        var rec = p.id === "pro";
        return '<label class="privacy-option' + (rec ? " plan-recommended" : "") + '"><input type="radio" name="plan" value="' + esc(p.id) + '"' + (selected === p.id ? " checked" : "") + " required><span><strong>" + esc(p.label) +
          (rec ? ' <span class="pill pill-recommended">' + esc(tr("fee.recommended")) + "</span>" : "") + "</strong><em>" +
          esc(tr("plan.month", { price: euros(p.monthly_cents) })) + " · " + esc(tr("plan.fee", { pct: fmtPct(Number(p.fee_bps) || 0) })) + "</em></span></label>";
      }).join("") +
      '<p class="notice plan-beta-note">' + esc(tr("plan.betaNote")) + "</p></fieldset>";
  }
  // Profilo: vedere e cambiare il piano (solo preferenza in BETA). Gli admin sono esenti.
  function accountPlanHtml() {
    if (!state.user) return "";
    if (state.user.plan_exempt) return '<p class="notice plan-exempt-note">' + esc(tr("plan.exempt")) + "</p>";
    return '<form id="plan-form" class="plan-account" novalidate><h3>' + esc(tr("plan.accountTitle")) + "</h3>" + planPickerHtml(state.user.plan || "") +
      '<p class="error" id="plan-account-err" hidden></p><p class="ok" id="plan-account-ok" hidden></p>' +
      '<button class="btn" type="submit" id="plan-account-save">' + esc(tr("plan.save")) + "</button></form>";
  }
  function bindPlanForm() {
    var f = document.getElementById("plan-form");
    if (!f) return;
    var err = document.getElementById("plan-account-err"), ok = document.getElementById("plan-account-ok"), save = document.getElementById("plan-account-save");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true; ok.hidden = true;
      var plan = (new FormData(f)).get("plan");
      if (!plan) { err.hidden = false; err.textContent = tr("plan.required"); return; }
      save.disabled = true;
      api("me/plan", { method: "POST", body: { plan: plan } }).then(function (d) {
        state.user = d.user || Object.assign({}, state.user, { plan: plan, needs_plan: false });
        save.disabled = false;
        ok.hidden = false; ok.textContent = tr("plan.changed");
      }).catch(function (e2) { save.disabled = false; err.hidden = false; err.textContent = (e2 && e2.message) || tr("plan.required"); });
    });
  }
  function pagePlanGate() {
    return '<section class="panel plan-gate"><h1>' + esc(tr("plan.title")) + "</h1>" +
      "<p>" + esc(tr("plan.lede")) + "</p>" +
      '<form id="plan-gate-form" novalidate>' + planPickerHtml() +
      '<p class="error" id="plan-err" hidden></p>' +
      '<p class="row-actions"><button class="btn primary" type="submit" id="plan-save">' + esc(tr("plan.save")) + "</button>" +
      '<button class="btn ghost" type="button" id="plan-logout">' + esc(tr("gate.logout")) + "</button></p></form>" +
      '<p class="dim"><a href="/legal/termini">' + esc(tr("auth.terms")) + "</a> · " +
      '<a href="#/assistenza" data-link>' + esc(tr("nav.support")) + "</a></p></section>";
  }
  function bindPlanGate() {
    var f = document.getElementById("plan-gate-form");
    if (!f) return;
    var err = document.getElementById("plan-err"), save = document.getElementById("plan-save");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var plan = (new FormData(f)).get("plan");
      if (!plan) { err.hidden = false; err.textContent = tr("plan.required"); return; }
      save.disabled = true;
      api("me/plan", { method: "POST", body: { plan: plan } }).then(function (d) {
        state.user = d.user || Object.assign({}, state.user, { plan: plan, needs_plan: false });
        dmToast(tr("plan.done"));
        render();
      }).catch(function (e2) { save.disabled = false; err.hidden = false; err.textContent = (e2 && e2.message) || tr("plan.required"); });
    });
    document.getElementById("plan-logout").onclick = function () {
      api("auth/logout", { method: "POST", body: {} }).then(function () { state.user = null; go("#/"); render(); });
    };
  }
  function bindUsernameGate() {
    var f = document.getElementById("username-gate-form");
    if (!f) return;
    var input = document.getElementById("gate-username"), hint = document.getElementById("gate-hint"),
      err = document.getElementById("gate-err"), save = document.getElementById("gate-save"), timer = null, seq = 0, okName = "";
    function setHint(text, cls) { hint.textContent = text; hint.className = cls || "dim"; }
    function check() {
      var v = normalizeUsername(input.value);
      okName = ""; save.disabled = true; err.hidden = true;
      if (!v) { setHint(tr("gate.hint")); return; }
      if (!usernameValid(v)) { setHint(tr("user.usernameInvalid"), "error"); return; }
      var my = ++seq;
      setHint(tr("gate.checking"));
      fetch("/api/users/username-available?u=" + encodeURIComponent(v), { credentials: "include" })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { s: r.status, d: d }; }); })
        .then(function (x) {
          if (my !== seq) return;
          if (x.s === 429) { setHint(tr("gate.rate"), "error"); return; }
          if (x.d.available) { okName = x.d.username || v; save.disabled = false; setHint(tr("gate.free", { name: okName }), "ok"); }
          else setHint(x.d.code === "username_taken" ? tr("user.usernameTaken") : (x.d.error || tr("user.usernameInvalid")), "error");
        }).catch(function () { if (my === seq) setHint(tr("gate.hint")); });
    }
    input.addEventListener("input", function () { if (timer) clearTimeout(timer); timer = setTimeout(check, 350); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!okName || save.disabled) return;
      save.disabled = true;
      api("me", { method: "PATCH", body: { username: okName } }).then(function (d) {
        state.user = d.user || Object.assign({}, state.user, { username: okName, needs_username: false });
        dmToast(tr("gate.done", { name: okName }));
        render();
      }).catch(function (e2) {
        save.disabled = false;
        err.hidden = false; err.textContent = usernameErrorMessage(e2);
      });
    });
    document.getElementById("gate-logout").onclick = function () {
      api("auth/logout", { method: "POST", body: {} }).then(function () { state.user = null; go("#/"); render(); });
    };
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }
  function usernameErrorMessage(err) {
    var code = (err && (err.code || err.message)) || "";
    if (code === "username_invalid" || /username_invalid/.test(code)) return tr("user.usernameInvalid");
    if (code === "username_taken" || /username_taken/.test(code)) return tr("user.usernameTaken");
    if (code === "username_required" || /username_required/.test(code)) return tr("user.usernameRequired");
    if (code === "query_too_short" || /query_too_short/.test(code)) return tr("user.searchShort");
    return (err && err.message) || tr("error.generic", { status: "" });
  }
  function videoErrorMessage(err) {
    var code = String((err && (err.code || err.message)) || "");
    var map = {
      video_no_audio: "video.no_audio",
      video_too_long: "video.too_long",
      video_too_short: "video.too_short",
      video_too_large: "video.too_large",
      video_invalid: "video.invalid",
      challenge_invalid: "video.challenge_invalid",
      challenge_video_required: "reg.challengeVideoNeed"
    };
    var key = map[code];
    if (!key) {
      for (var k in map) { if (code.indexOf(k) !== -1) { key = map[k]; break; } }
    }
    return key ? tr(key) : ((err && err.message) || tr("error.generic", { status: "" }));
  }
  function cardsCountLabel(n) {
    n = Number(n) || 0;
    return n === 1 ? tr("user.cardsCountOne") : tr("user.cardsCount", { n: n });
  }
  function isAlbumPath(path) {
    return path === "/album" || path === "/collezione" || path.indexOf("/album/") === 0 || path.indexOf("/collezione/") === 0;
  }
  function albumBaseHash() {
    var p = route().parts;
    if (p[0] === "u" && p[1]) return "#/u/" + encodeURIComponent(p[1]);
    if (p[0] === "collezione") return "#/collezione";
    return "#/album";
  }
  function albumTabFromParts(parts, start) {
    return (parts[start] === "non-gradate" || parts[start] === "raw") ? "raw" : "graded";
  }
  function pickPriceCents(c) {
    if (!c) return null;
    var listing = c.listing || {};
    var raw = [c.listing_price_cents, c.price_cents, c.asking_price_cents, listing.price_cents, listing.listing_price_cents];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] != null && raw[i] !== "") {
        var n = Number(raw[i]);
        if (!isNaN(n)) return n;
      }
    }
    if (c.price != null && c.price !== "") {
      var p = Number(c.price);
      if (!isNaN(p)) return (p > 0 && p < 1000) ? Math.round(p * 100) : p;
    }
    return null;
  }
  function pickPhotoUrl(v, id, kind) {
    if (typeof v === "string" && v && v !== "true") return v;
    if (v && typeof v === "object") {
      if (v.url) return v.url;
      if (v.src) return v.src;
    }
    if ((v === true || v === "true") && id) return "/api/cards/" + encodeURIComponent(id) + "/photo/" + kind;
    return "";
  }
  function normalizePublicCard(c) {
    c = c || {};
    var model = c.model || {};
    var raw = !!(c.is_ungraded || c.type === "raw" || c.card_type === "raw");
    var id = c.id || c.slab_id || "";
    var name = c.name || c.card_name || c.title || model.name || "";
    var setName = c.set || c.set_name || model.set_name || "";
    var number = c.number || c.code || c.code_printed || model.code_printed || "";
    var lang = c.language || model.language || "";
    var photos = (c.photos && typeof c.photos === "object") ? c.photos : {};
    var frontUrl = pickPhotoUrl(c.front_url || c.front || c.photo_front || photos.front_url || photos.front, id, "front");
    var backUrl = pickPhotoUrl(c.back_url || c.back || c.photo_back || photos.back_url || photos.back, id, "back");
    var certUrl = c.cert_url || c.public_url || c.share_url || c.certificate_path || "";
    if (!certUrl && !raw && (c.has_c_link || c.rarity || c.rarity_tier || c.serial || c.serial_number) && id) {
      certUrl = "/c/" + encodeURIComponent(id);
    }
    var href = certUrl || (id ? "#/carta/" + encodeURIComponent(id) : "");
    var onSale = !!(c.on_sale || c.listed || c.is_on_sale || c.listing_status === "active" || listingActive(c));
    var priceCents = pickPriceCents(c);
    return {
      id: id,
      is_ungraded: raw,
      card_name: name,
      name: name,
      model: { name: name, set_name: setName, code_printed: number, language: lang, game: c.game || model.game || "" },
      grader: c.grader,
      grade: c.grade,
      rarity_tier: c.rarity_tier || c.rarity || null,
      rarity_label: c.rarity_label || null,
      serial_number: c.serial_number || c.serial || null,
      serial_total: c.serial_total || c.serial_total_at_assignment || null,
      card_condition: c.card_condition || c.condition,
      photos: { front: !!(frontUrl || (photos.front !== false && id)), back: !!(backUrl || photos.back) },
      front_url: frontUrl,
      back_url: backUrl,
      href: href,
      on_sale: onSale,
      listing_status: onSale ? "active" : null,
      listing_price_cents: priceCents,
      catalog_image: c.catalog_image || (model && model.catalog_image) || "",
      catalog_image_ref: c.catalog_image_ref || ""
    };
  }
  function listingActive(c) {
    if (!c) return false;
    if (c.listing && (c.listing.status === "active" || c.listing.on_sale)) return true;
    return false;
  }
  function usernameFormHtml(opts) {
    opts = opts || {};
    var current = (state.user && state.user.username) || "";
    return '<form class="username-form" id="' + (opts.id || "username-form") + '">' +
      "<label>" + esc(tr("account.username")) +
      ' <input name="username" type="text" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_.]{3,20}" autocapitalize="none" autocomplete="username" spellcheck="false" value="' + esc(current) + '" placeholder="' + esc(tr("auth.usernamePh")) + '">' +
      "</label>" +
      '<p class="dim">' + esc(tr("account.usernameHint")) + "</p>" +
      '<p class="error" id="username-err" hidden></p>' +
      '<p class="ok" id="username-ok" hidden></p>' +
      '<button type="submit" class="btn">' + esc(tr("account.usernameSave")) + "</button></form>";
  }
  // v27b: scelta esplicita Pubblico / Privato (prima era una casella con l'etichetta dello stato, ambigua).
  function privacyStatusHtml(on) {
    return tr("album.stateNow", { state: "<strong>" + esc(tr(on ? "album.statePublic" : "album.statePrivate")) + "</strong>" });
  }
  function privacyOptionHtml(kind, selected) {
    var K = kind === "public" ? "Public" : "Private";
    return '<label class="privacy-option' + (selected ? " is-on" : "") + '"><input type="radio" name="album-visibility" value="' + kind + '"' + (selected ? " checked" : "") + "><span><strong>" +
      esc(tr("album.opt" + K)) + '</strong> <span class="dim">— ' + esc(tr("album.opt" + K + "Hint")) + "</span></span></label>";
  }
  function privacyToggleHtml() {
    if (!publicAlbumsOn() || !state.user) return "";
    var on = !!state.user.album_public;
    var hasUser = !!(state.user.username);
    return '<div class="privacy-toggle-wrap">' +
      '<p class="privacy-status" id="album-privacy-status" aria-live="polite">' + privacyStatusHtml(on) + "</p>" +
      '<div class="privacy-choice" role="radiogroup" aria-label="' + esc(tr("account.privacyTitle")) + '">' + privacyOptionHtml("public", on) + privacyOptionHtml("private", !on) + "</div>" +
      '<p class="dim">' + esc(tr("album.privacyHint")) + "</p>" +
      (hasUser ? '<p class="privacy-current dim">@' + esc(state.user.username) + ' · <a href="#/u/' + encodeURIComponent(state.user.username) + '" data-link>' + esc(tr("album.viewPublic")) + "</a></p>" : "") +
      '<p class="error" id="album-privacy-err" hidden></p>' +
      '<p class="ok" id="album-privacy-ok" hidden></p></div>';
  }
  function accountPrivacyHtml() {
    if (!publicAlbumsOn() || !state.user) return "";
    var uname = state.user.username;
    return '<section class="account-privacy panel" id="impostazioni-privacy">' +
      "<h2>" + esc(tr("account.privacyTitle")) + "</h2>" +
      '<p class="dim">' + esc(tr("account.privacyIntro")) + "</p>" +
      (uname ? '<p class="privacy-current">' + esc(tr("account.usernameCurrent", { name: uname })) + ' <a href="#/u/' + encodeURIComponent(uname) + '" data-link>' + esc(tr("account.viewPublic")) + "</a></p>" : "") +
      usernameFormHtml() +
      privacyToggleHtml() +
      "</section>";
  }
  function isRawCard(c) {
    return !!(c && (c.is_ungraded || c.type === "raw" || c.type === "ungraded" || c.card_type === "raw" || c.card_type === "ungraded" || c.raw));
  }
  function gradedFrame(c) {
    var art = digitalArt(c);
    var serial = c.serial_number ? serialFmt(c.serial_number, c.serial_total) : "";
    return slabFrame({
      img: art.img,
      srcset: art.srcset,
      grader: isRawCard(c) ? "RAW" : graderLabel(c.grader),
      grade: isRawCard(c) ? (c.card_condition || "RAW") : (c.grade || "—"),
      cert: c.certificate_no || "",
      serial: serial,
      tier: c.rarity_tier || "",
      tierLabel: c.rarity_label || "",
      raw: isRawCard(c)
    });
  }
  // v27c: «Elimina annuncio» (con menu dei motivi) sulle miniature con annuncio attivo e nella pagina della carta.
  var CLOSE_REASONS = ["sold_outside", "not_interested", "wrong_listing", "other"];
  function closeListingBtnHtml(c, cls) {
    return '<button type="button" class="btn ghost danger ' + (cls || "") + '" data-close-listing="' + esc(c.listing_id) + '" data-raw="' + (isRawCard(c) ? "1" : "0") + '">' + esc(tr("close.btn")) + "</button>";
  }
  function closeListingTileOk(c) {
    return !!(c && c.id && c.listing_id && c.listing_status === "active");
  }
  function albumCardTile(c, opts) {
    var link = albumCardTileLink(c, opts);
    if (!opts || opts.public || !opts.owner || !closeListingTileOk(c)) return link;
    return '<div class="tile-wrap">' + link + closeListingBtnHtml(c, "tile-close") + "</div>";
  }
  function openCloseListingDialog(listingId, isRaw) {
    var prev = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "dm-modal";
    wrap.innerHTML = '<form class="dm-modal-panel" role="dialog" aria-modal="true" aria-labelledby="close-title" novalidate>' +
      '<h3 id="close-title">' + esc(tr("close.title")) + "</h3><p>" + esc(tr("close.why")) + "</p>" +
      '<div class="privacy-choice">' + CLOSE_REASONS.map(function (r) {
        return '<label class="privacy-option"><input type="radio" name="reason" value="' + r + '"><span>' + esc(tr("close.r." + r)) + "</span></label>";
      }).join("") + "</div>" +
      '<p class="dim" id="close-hint" hidden></p>' +
      '<label class="field" id="close-note-wrap" hidden>' + esc(tr("close.note")) + '<textarea name="note" maxlength="200" rows="2"></textarea></label>' +
      '<p class="dim">' + esc(tr("close.warnRequests")) + "</p>" +
      '<p class="error" id="close-err" hidden></p>' +
      '<div class="row-actions"><button type="submit" class="btn danger">' + esc(tr("close.confirm")) + '</button><button type="button" class="btn ghost" data-close-cancel>' + esc(tr("close.cancel")) + "</button></div></form>";
    document.body.appendChild(wrap);
    var form = wrap.querySelector("form"), err = wrap.querySelector("#close-err"), hint = wrap.querySelector("#close-hint"), noteWrap = wrap.querySelector("#close-note-wrap");
    function shut() {
      document.removeEventListener("keydown", onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (prev && prev.focus) prev.focus();
    }
    function onKey(e) { if (e.key === "Escape") shut(); }
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) shut(); });
    wrap.querySelector("[data-close-cancel]").onclick = shut;
    form.querySelectorAll("input[name=reason]").forEach(function (r) {
      r.addEventListener("change", function () {
        err.hidden = true;
        noteWrap.hidden = r.value !== "other";
        var h = r.value === "sold_outside" ? tr(isRaw ? "close.hintSoldRaw" : "close.hintSoldGraded") : "";
        hint.hidden = !h; hint.textContent = h;
      });
    });
    var first = form.querySelector("input[name=reason]");
    if (first) first.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(form), reason = fd.get("reason");
      if (!reason) { err.hidden = false; err.textContent = tr("close.choose"); return; }
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      api("listings/" + encodeURIComponent(listingId) + "/close", { method: "POST", body: { reason: reason, note: String(fd.get("note") || "") } }).then(function (d) {
        shut();
        if (d && d.graded_sold_outside) alert(tr("close.doneGraded"));
        else dmToast(tr(d && d.archived ? "close.doneArchived" : "close.done"));
        render();
      }).catch(function (e2) { btn.disabled = false; err.hidden = false; err.textContent = (e2 && e2.message) || tr("close.choose"); });
    });
  }
  function bindCloseListingButtons(root) {
    root.querySelectorAll("[data-close-listing]").forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.preventDefault();
        openCloseListingDialog(btn.getAttribute("data-close-listing"), btn.getAttribute("data-raw") === "1");
      };
    });
  }
  function albumCardTileLink(c, opts) {
    opts = opts || {};
    if (opts.public) c = normalizePublicCard(c);
    var raw = isRawCard(c);
    var href = opts.public ? (c.href || (c.id ? "#/carta/" + encodeURIComponent(c.id) : "#")) : ("#/carta/" + c.id);
    var model = c.model || {};
    var listed = c.listing_status === "active" || c.on_sale;
    var price = c.listing_price_cents != null ? c.listing_price_cents : pickPriceCents(c);
    var metaBits = [model.code_printed, model.language].filter(Boolean).join(" · ");
    return '<a class="slab-tile' + (raw ? " is-raw" : "") + (c.rarity_tier === "mitica" || c.rarity_tier === "leggendaria" ? " is-hype-owned" : "") + '" href="' + esc(href) + '"' + (href.charAt(0) === "#" ? " data-link" : ' target="_blank" rel="noopener"') + ">" +
      (raw ? rawCardFigure(c, { album: true, albumTag: opts.public ? tr("raw.notForSale") : tr("raw.album") }) : gradedFrame(c)) +
      '<div class="tile-meta"><strong>' + esc(cardTitle(c)) + "</strong>" +
      (metaBits ? "<span>" + esc(metaBits) + "</span>" : "") +
      "<div>" +
      (opts.owner && c.status ? pillStatus(c.status) : "") +
      (opts.owner && c.is_test ? '<span class="pill pill-test">TEST</span>' : "") +
      (raw ? '<span class="pill pill-raw">' + tr("pill.ungraded") + "</span>" : "") +
      (c.rarity_tier ? rarityPillsHtml(c.rarity_tier) : "") +
      (opts.owner && c.full_set === "yes" ? '<span class="pill pill-leggendaria">' + tr("pill.fullSet") + "</span>" : opts.owner && c.full_set === "transferring" ? '<span class="pill warn">' + tr("pill.fullSetTransfer") + "</span>" : "") +
      (listed && price != null ? "<span>" + euros(price) + "</span>" : "") +
      "</div>" +
      (opts.owner && !opts.public && (isOwnCard(c) || !c.physical_owner_id) && (c.listing_blocked_reason === "no_paypal" || needsPaypalToSell(c)) ? '<div class="tile-paypal">' + paypalNeededHtml() + "</div>" : "") +
      (opts.owner && c.listing_blocked_reason === "no_price" ? '<p class="dim tile-noprice">' + esc(tr("card.noPrice")) + "</p>" : "") +
      "</div></a>";
  }
  function saleTile(c) {
    var n = normalizePublicCard(c);
    var href = n.href || "#";
    var img = n.front_url || catalogArt(n) || (n.id ? photoSrc(n.id, "front", 448) : "");
    var price = n.listing_price_cents;
    var title = n.card_name || cardTitle(n);
    return '<a class="sale-tile" href="' + esc(href) + '"' + (href.charAt(0) === "#" ? " data-link" : ' target="_blank" rel="noopener"') + ">" +
      '<div class="sale-thumb">' + (img ? '<img src="' + esc(img) + '" alt="">' : "") + "</div>" +
      '<p class="sale-title">' + esc(title) + "</p>" +
      (price != null ? '<p class="sale-price">' + euros(price) + "</p>" : "") +
      "</a>";
  }
  function albumSectionsHtml(cards, opts) {
    opts = opts || {};
    var tab = opts.tab || "graded";
    var list = cards || [];
    var graded = list.filter(function (c) { return !isRawCard(opts.public ? normalizePublicCard(c) : c); });
    var raw = list.filter(function (c) { return isRawCard(opts.public ? normalizePublicCard(c) : c); });
    var tabs = '<div class="album-tabs" role="tablist">' +
      '<button type="button" class="album-tab' + (tab === "graded" ? " on" : "") + '" data-album-tab="graded" role="tab" aria-selected="' + (tab === "graded" ? "true" : "false") + '">' + esc(tr("nav.graded")) + ' <span class="album-tab-n">' + graded.length + "</span></button>" +
      '<button type="button" class="album-tab' + (tab === "raw" ? " on" : "") + '" data-album-tab="raw" role="tab" aria-selected="' + (tab === "raw" ? "true" : "false") + '">' + esc(tr("nav.ungraded")) + ' <span class="album-tab-n">' + raw.length + "</span></button></div>";
    function panel(items, kind, emptyKey) {
      var body = items.length
        ? '<div class="slab-gallery">' + items.map(function (c) { return albumCardTile(c, opts); }).join("") + "</div>"
        : '<p class="empty">' + esc(tr(emptyKey)) + "</p>";
      return '<div class="album-panel" data-album-panel="' + kind + '"' + (tab !== kind ? " hidden" : "") + ">" + body + "</div>";
    }
    return tabs + panel(graded, "graded", "album.emptyGraded") + panel(raw, "raw", "album.emptyRaw");
  }
  function bindAlbumTabs() {
    var base = albumBaseHash();
    document.querySelectorAll("[data-album-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-album-tab");
        go(tab === "raw" ? base + "/non-gradate" : base);
      });
    });
  }
  function bindUsernameForm() {
    var form = document.getElementById("username-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = normalizeUsername(new FormData(form).get("username"));
      var er = document.getElementById("username-err");
      var ok = document.getElementById("username-ok");
      if (er) { er.hidden = true; er.textContent = ""; }
      if (ok) ok.hidden = true;
      if (!usernameValid(name)) {
        if (er) { er.hidden = false; er.textContent = tr("user.usernameInvalid"); }
        return;
      }
      api("me", { method: "PATCH", body: { username: name } }).then(function (d) {
        state.user = d.user || Object.assign({}, state.user, { username: name });
        if (ok) { ok.hidden = false; ok.textContent = tr("account.usernameSaved"); }
        render();
      }).catch(function (err) {
        if (er) { er.hidden = false; er.textContent = usernameErrorMessage(err); }
      });
    });
  }
  function bindPrivacyToggle() {
    var radios = document.querySelectorAll("input[name='album-visibility']");
    if (!radios.length) return;
    function paint(on) {
      radios.forEach(function (r) {
        r.checked = (r.value === "public") === on;
        if (r.parentNode) r.parentNode.classList.toggle("is-on", r.checked);
      });
      var st = document.getElementById("album-privacy-status");
      if (st) st.innerHTML = privacyStatusHtml(on);
    }
    radios.forEach(function (box) {
      box.addEventListener("change", function () {
        var er = document.getElementById("album-privacy-err");
        var ok = document.getElementById("album-privacy-ok");
        var was = !!(state.user && state.user.album_public);
        var wantPublic = box.value === "public";
        if (er) { er.hidden = true; er.textContent = ""; }
        if (ok) ok.hidden = true;
        if (wantPublic === was) { paint(was); return; }
        if (wantPublic && !(state.user && state.user.username)) {
          paint(was);
          if (er) { er.hidden = false; er.textContent = tr("user.usernameRequired"); }
          var input = document.querySelector("#username-form input[name='username']");
          if (input) { input.focus(); input.scrollIntoView({ block: "center" }); }
          return;
        }
        paint(wantPublic);
        api("me", { method: "PATCH", body: { album_public: wantPublic } }).then(function (d) {
          state.user = d.user || Object.assign({}, state.user, { album_public: wantPublic });
          if (ok) { ok.hidden = false; ok.textContent = tr(wantPublic ? "album.madePublic" : "album.madePrivate"); }
        }).catch(function (err) {
          paint(was);
          if (er) { er.hidden = false; er.textContent = usernameErrorMessage(err); }
        });
      });
    });
  }
  function profileShareUrl(username) {
    return location.origin + (location.pathname || "/").replace(/\/+$/, "/") + "#/u/" + encodeURIComponent(username);
  }
  function pagePublicProfile(data, err, tab) {
    if (err || !data) {
      return '<div class="private-album"><h1>' + esc(tr("album.privateTitle")) + "</h1><p>" + esc(tr("album.privateBody")) + "</p></div>";
    }
    var username = data.username || "";
    var cards = data.cards || [];
    var count = data.cards_count != null ? data.cards_count : cards.length;
    var share = profileShareUrl(username);
    var onSale = cards.filter(function (c) { return normalizePublicCard(c).on_sale; });
    var adminView = !!(data.admin_view && state.user && state.user.role === "admin");
    var handle = username ? "@" + username : (data.display_name || tr("admin.noUsername"));
    var html = '<div class="profile-head"><div><h1 class="profile-handle">' + esc(handle) +
      (data.private ? ' <span class="pill warn">' + esc(tr("admin.albumPrivate")) + "</span>" : "") + "</h1>" +
      (adminView && data.private ? '<p class="dim">' + esc(tr("admin.albumPrivateNote")) + "</p>" : "") +
      (data.cards_count == null ? "" : "<p>" + esc(tr("album.profileLede", { name: username || handle })) + " " + esc(cardsCountLabel(count)) + ".</p>") + "</div>" +
      (username && !data.private ? '<div class="profile-share"><label class="sr-only" for="profile-share-url">' + esc(tr("album.shareHint")) + "</label>" +
      '<input id="profile-share-url" type="text" readonly value="' + esc(share) + '">' +
      '<button type="button" class="btn" id="profile-share-btn">' + esc(tr("album.share")) + "</button>" +
      '<span class="ok" id="profile-share-ok" hidden></span></div>' : "") + "</div>";
    if (onSale.length) {
      html += '<section class="album-sale"><h2>' + esc(tr("album.forSale")) + "</h2>" +
        '<div class="sale-gallery">' + onSale.map(saleTile).join("") + "</div></section>";
    }
    if (data.private && !adminView && !data.owner_view) {
      // v23: private profile, cards not shared with visitors (the API returns none).
      html += '<section class="panel private-album-cards"><h2>' + esc(tr("album.privateLabel")) + "</h2><p class=\"dim\">" + esc(tr("album.privateCardsBody")) + "</p></section>";
      return html;
    }
    if (data.private && data.owner_view && !adminView) html += '<p class="dim">' + esc(tr("album.privateOwnerNote")) + "</p>";
    html += albumSectionsHtml(cards, { public: true, tab: tab || "graded" });
    if (adminView) html += adminAlbumToolsHtml(cards);
    return html;
  }
  // v23: admin moderation of any album (soft removal via DELETE /api/admin/cards|listings/:id).
  function adminAlbumToolsHtml(cards) {
    var rows = (cards || []).map(function (c) {
      var n = normalizePublicCard(c);
      var title = n.card_name || c.name || cardTitle(n);
      return '<li class="admin-album-row" data-admin-row="' + esc(c.id) + '" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.2)"><span><strong>' + esc(title) + "</strong>" +
        (c.is_test ? ' <span class="pill pill-test">TEST</span>' : "") +
        (c.listing_id ? ' <span class="dim">' + esc(tr("admin.onSale")) + (c.price_cents != null ? " " + euros(c.price_cents) : "") + "</span>" : "") +
        '</span><span class="row">' +
        (c.listing_id ? '<button type="button" class="btn" data-admin-remove-listing="' + esc(c.listing_id) + '">' + esc(tr("admin.removeListing")) + "</button>" : "") +
        '<button type="button" class="btn danger" data-admin-remove-card="' + esc(c.id) + '">' + esc(tr("admin.removeCard")) + "</button>" +
        "</span></li>";
    }).join("");
    return '<section class="panel admin-album-tools"><h2>' + esc(tr("admin.albumTools")) + '</h2><p class="dim">' + esc(tr("admin.albumToolsNote")) + "</p>" +
      '<p class="error" id="admin-album-err" hidden></p>' +
      (rows ? '<ul class="admin-album-list" style="list-style:none;padding:0;margin:0">' + rows + "</ul>" : '<p class="empty">' + esc(tr("admin.albumEmpty")) + "</p>") + "</section>";
  }
  function bindAdminAlbumTools() {
    var err = document.getElementById("admin-album-err");
    function run(btn, path, confirmKey) {
      if (btn.disabled || !confirm(tr(confirmKey))) return;
      btn.disabled = true;
      if (err) err.hidden = true;
      api(path, { method: "DELETE" }).then(function () {
        dmToast(tr("admin.removedOk"));
        render();
      }).catch(function (e) {
        btn.disabled = false;
        if (err) { err.hidden = false; err.textContent = String(e && e.message || tr("error.generic", { status: "" })); }
      });
    }
    document.querySelectorAll("[data-admin-remove-listing]").forEach(function (b) {
      b.addEventListener("click", function () { run(b, "admin/listings/" + encodeURIComponent(b.getAttribute("data-admin-remove-listing")), "admin.confirmRemoveListing"); });
    });
    document.querySelectorAll("[data-admin-remove-card]").forEach(function (b) {
      b.addEventListener("click", function () { run(b, "admin/cards/" + encodeURIComponent(b.getAttribute("data-admin-remove-card")), "admin.confirmRemoveCard"); });
    });
  }
  function bindPublicProfile() {
    bindAlbumTabs();
    bindAdminAlbumTools();
    var btn = document.getElementById("profile-share-btn");
    var input = document.getElementById("profile-share-url");
    if (!btn || !input) return;
    btn.addEventListener("click", function () {
      var ok = document.getElementById("profile-share-ok");
      function done() {
        if (ok) { ok.hidden = false; ok.textContent = tr("album.shareCopied"); }
      }
      input.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done).catch(function () {
          try { document.execCommand("copy"); done(); } catch (e) {}
        });
      } else {
        try { document.execCommand("copy"); done(); } catch (e) {}
      }
    });
  }
  var userSearchBound = false;
  var userSearchTimer = null;
  var userSearchAbort = null;
  function bindUserSearch() {
    var root = document.getElementById("user-search");
    if (!root || userSearchBound) return;
    userSearchBound = true;
    var toggle = document.getElementById("user-search-toggle");
    var input = document.getElementById("user-search-q");
    var results = document.getElementById("user-search-results");
    function setOpen(on) {
      root.classList.toggle("open", on);
      if (toggle) toggle.setAttribute("aria-expanded", on ? "true" : "false");
      var panel = document.getElementById("user-search-panel");
      if (on && toggle && panel && window.matchMedia && window.matchMedia("(max-width: 859px)").matches) {
        var r = toggle.getBoundingClientRect();
        panel.style.top = Math.round(r.bottom + 8) + "px";
      } else if (panel) {
        panel.style.top = "";
      }
      if (on && input) input.focus();
    }
    if (toggle) toggle.addEventListener("click", function (e) {
      e.preventDefault();
      setOpen(!root.classList.contains("open"));
    });
    document.addEventListener("click", function (e) {
      if (!root.contains(e.target)) {
        setOpen(false);
        if (results) results.hidden = true;
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        setOpen(false);
        if (results) results.hidden = true;
      }
    });
    function showMsg(text) {
      if (!results) return;
      results.hidden = false;
      results.innerHTML = '<div class="user-search-msg">' + esc(text) + "</div>";
    }
    function runSearch(q) {
      q = String(q || "").trim();
      if (q.length < 2) {
        if (results) {
          if (q.length) showMsg(tr("user.searchShort"));
          else results.hidden = true;
        }
        return;
      }
      if (q.length > 30) q = q.slice(0, 30);
      if (userSearchAbort && userSearchAbort.abort) userSearchAbort.abort();
      userSearchAbort = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var ac = userSearchAbort;
      fetch("/api/users/search?q=" + encodeURIComponent(q), {
        credentials: "include",
        signal: ac ? ac.signal : undefined
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          return { res: res, d: d };
        });
      }).then(function (pack) {
        if (ac && ac.signal && ac.signal.aborted) return;
        var res = pack.res, d = pack.d;
        if (res.status === 429) {
          var ra = parseInt(res.headers.get("Retry-After") || d.retry_after || "30", 10) || 30;
          showMsg(tr("user.searchRate", { n: ra }));
          return;
        }
        if (!res.ok) {
          showMsg(d.error === "query_too_short" || d.code === "query_too_short" ? tr("user.searchShort") : tr("user.searchError"));
          return;
        }
        var users = (d && d.users) || [];
        if (!users.length) { showMsg(tr("user.searchEmpty")); return; }
        results.hidden = false;
        results.innerHTML = users.map(function (u) {
          var name = u.username || "";
          var ref = u.album_ref || name;
          var n = u.cards_count != null ? u.cards_count : 0;
          var label = name ? "@" + name : (u.display_name || tr("admin.noUsername"));
          var extra = d.admin_view && u.display_name && name ? ' <span class="dim">· ' + esc(u.display_name) + "</span>" : "";
          var priv = u.private ? ' <span class="pill warn">' + esc(tr("admin.albumPrivate")) + "</span>" : "";
          return '<a class="user-search-item" role="option" href="#/u/' + encodeURIComponent(ref) + '" data-link>' +
            '<span class="us-name">' + esc(label) + extra + priv + '</span><span class="us-count">' + esc(cardsCountLabel(n)) + "</span></a>";
        }).join("");
        results.querySelectorAll("a").forEach(function (a) {
          a.addEventListener("click", function () { setOpen(false); results.hidden = true; });
        });
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        showMsg(tr("user.searchError"));
      });
    }
    if (input) {
      input.setAttribute("placeholder", tr("user.searchPh"));
      var lab = root.querySelector("label[for='user-search-q']");
      if (lab) lab.textContent = tr("user.searchLabel");
      if (toggle) toggle.setAttribute("aria-label", tr("user.searchLabel"));
      input.addEventListener("input", function () {
        if (userSearchTimer) clearTimeout(userSearchTimer);
        var q = input.value;
        userSearchTimer = setTimeout(function () { runSearch(q); }, 280);
      });
      input.addEventListener("focus", function () {
        if (String(input.value || "").trim().length >= 2 && results && results.innerHTML) results.hidden = false;
      });
    }
  }
  function syncUserSearchChrome() {
    var root = document.getElementById("user-search");
    if (!root) return;
    var on = publicAlbumsOn();
    root.hidden = !on;
    if (on) {
      bindUserSearch();
      var input = document.getElementById("user-search-q");
      var toggle = document.getElementById("user-search-toggle");
      var lab = root.querySelector("label[for='user-search-q']");
      if (input) input.setAttribute("placeholder", tr("user.searchPh"));
      if (lab) lab.textContent = tr("user.searchLabel");
      if (toggle) toggle.setAttribute("aria-label", tr("user.searchLabel"));
    }
  }
  function slabFrame(opts) {
    opts = opts || {};
    var img = opts.img || "";
    var srcset = opts.srcset || "";
    var art;
    if (img) {
      art = '<div class="slab-art has-real-photo"><img class="slab-photo" src="' + img + '"' +
        (srcset ? ' srcset="' + srcset + '" sizes="' + esc(opts.sizes || "(max-width:600px) 46vw, 240px") + '"' : "") +
        ' alt="" onerror="window.GemintPhotos&&window.GemintPhotos.fallback(this)"></div>';
    } else {
      art = '<div class="slab-art slab-placeholder"><span class="ph-kicker">' + esc(opts.phLabel || tr("ph.sellerPhoto")) + "</span>" +
        (opts.cardName ? '<strong class="ph-name">' + esc(opts.cardName) + "</strong>" : "") +
        (opts.cardMeta ? '<span class="ph-meta">' + esc(opts.cardMeta) + "</span>" : "") + "</div>";
    }
    var grade = opts.grade || (opts.raw ? (opts.condition || "RAW") : "—");
    var grader = opts.grader || (opts.raw ? "RAW" : "DreaMint");
    var bottom = opts.serial || opts.cert || (opts.raw ? tr("slab.noCert") : "");
    var tier = opts.raw ? "" : (opts.tier || "");
    var chip = rarityChipHtml(tier);
    return '<div class="slab-3d' + (opts.cls ? (" " + opts.cls) : "") + (tier === "mitica" || tier === "leggendaria" ? " slab-hype" : "") +
      '"' + (opts.noTilt ? "" : " data-tilt") + ' data-tier="' + esc(tier) + '">' +
      '<div class="slab-aura" aria-hidden="true"></div>' +
      '<div class="slab-acrylic"><div class="slab-window">' + art +
      '<div class="slab-holo"></div><div class="slab-shine"></div><div class="slab-foil"></div>' +
      '<div class="slab-glare"></div><div class="slab-noise"></div>' +
      '<div class="slab-glass"></div>' + slabSparkles(tier) + chip + "</div>" +
      '<div class="slab-label"><div class="lab-left"><span class="lab-grader">' + esc(grader) + "</span>" +
      '<span class="lab-serial">' + esc(bottom) + "</span>" +
      (opts.cert && opts.serial ? '<span class="lab-serial">' + esc(opts.cert) + "</span>" : "") +
      "</div>" +
      '<span class="lab-grade">' + esc(grade) + "</span></div></div></div>";
  }
  function enhanceUI() {
    if (window.GemintMotion) { window.GemintMotion.enhance(); return; }
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll("[data-tilt]").forEach(function (el) {
      if (el._tiltBound) return;
      el._tiltBound = true;
      el.addEventListener("pointermove", function (e) {
        if (reduce) return;
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / Math.max(1, r.width);
        var py = (e.clientY - r.top) / Math.max(1, r.height);
        el.style.setProperty("--ry", ((px - 0.5) * 22).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - py) * 16).toFixed(2) + "deg");
        el.style.setProperty("--hx", (px * 100).toFixed(1) + "%");
        el.style.setProperty("--hy", (py * 100).toFixed(1) + "%");
        el.classList.add("is-live");
      });
      el.addEventListener("pointerleave", function () {
        el.classList.remove("is-live");
        el.style.removeProperty("--rx");
        el.style.removeProperty("--ry");
      });
    });
    document.querySelectorAll(".btn").forEach(function (el) {
      if (el._magBound) return;
      el._magBound = true;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (e.clientX - r.left) + "px");
        el.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
    if (window.DeviceOrientationEvent && !window._gemintGyro) {
      window._gemintGyro = true;
      window.addEventListener("deviceorientation", function (e) {
        if (reduce) return;
        var gy = Math.max(-25, Math.min(25, e.gamma || 0));
        var gx = Math.max(-25, Math.min(25, e.beta || 0));
        document.querySelectorAll(".hero-slab [data-tilt]").forEach(function (el) {
          if (el.classList.contains("is-live")) return;
          el.style.setProperty("--ry", (gy * 0.45).toFixed(2) + "deg");
          el.style.setProperty("--rx", ((gx - 40) * 0.15).toFixed(2) + "deg");
          el.style.setProperty("--hx", (50 + gy).toFixed(1) + "%");
          el.style.setProperty("--hy", (36 + gx * 0.3).toFixed(1) + "%");
        });
      }, { passive: true });
    }
  }

  function route() {
    var hash = (location.hash || "#/").replace(/^#/, "");
    if (!hash.startsWith("/")) hash = "/" + hash;
    var q = hash.indexOf("?");
    if (q >= 0) hash = hash.slice(0, q);
    var parts = hash.split("/").filter(Boolean);
    return { path: "/" + parts.join("/"), parts: parts };
  }
  function go(h) { location.hash = h; }

  var REF_KEY = "gemint_ref";
  var REF_DAYS = 30;
  function getStoredRef() {
    try {
      var raw = localStorage.getItem(REF_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.code && o.exp && Date.now() < o.exp) return String(o.code);
      }
    } catch (e) {}
    try {
      var parts = (document.cookie || "").split(";");
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf(REF_KEY + "=") === 0) {
          var code = decodeURIComponent(p.slice(REF_KEY.length + 1)).trim().toUpperCase();
          if (/^[A-Z0-9]{3,20}$/.test(code)) return code;
        }
      }
    } catch (e2) {}
    return "";
  }
  function setStoredRef(code) {
    var exp = Date.now() + REF_DAYS * 86400 * 1000;
    try { localStorage.setItem(REF_KEY, JSON.stringify({ code: code, exp: exp })); } catch (e) {}
    document.cookie = REF_KEY + "=" + encodeURIComponent(code) + "; Path=/; Max-Age=" + (REF_DAYS * 86400) + "; SameSite=Lax";
  }
  function clearStoredRef() {
    try { localStorage.removeItem(REF_KEY); } catch (e) {}
    document.cookie = REF_KEY + "=; Path=/; Max-Age=0; SameSite=Lax";
  }
  function captureRef() {
    var params = new URLSearchParams(location.search);
    var code = String(params.get("ref") || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
    if (/^[A-Z0-9]{3,20}$/.test(code) && !getStoredRef()) setStoredRef(code);
  }
  function partnerShareUrl(code) {
    return location.origin + "/?ref=" + encodeURIComponent(code);
  }
  function copyText(value, btn) {
    if (!value) return;
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = tr("copied"); setTimeout(function () { btn.textContent = t; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () {});
    }
  }

  function pendingReviewCount() {
    return (state.user && Number(state.user.pending_reviews)) || 0;
  }
  function adminBadgeHtml(n) {
    n = Number(n) || 0;
    if (!n) return "";
    return ' <span class="nav-badge" aria-label="' + esc(tr("nav.pending", { n: n })) + '">' + n + "</span>";
  }
  function feesHintHtml() {
    var link = '<a href="#/commissioni" data-link>' + esc(trx("sell.feesLink", "Vedi commissioni e piani")) + "</a>";
    var raw = trx("sell.feesHint", "In beta le commissioni DreaMint sono a zero. {link}");
    return '<p class="dim fees-hint">' + raw.replace("{link}", link) + "</p>";
  }
  function closeMobNav() {
    var btn = document.getElementById("nav-menu-toggle");
    var menu = document.getElementById("mob-nav");
    var bd = document.getElementById("mob-nav-backdrop");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) { menu.hidden = true; menu.classList.remove("is-open"); }
    if (bd) { bd.hidden = true; bd.classList.remove("is-open"); }
    document.body.classList.remove("mob-nav-open");
  }
  function toggleMobNav() {
    var btn = document.getElementById("nav-menu-toggle");
    var menu = document.getElementById("mob-nav");
    var bd = document.getElementById("mob-nav-backdrop");
    if (!btn || !menu) return;
    var open = btn.getAttribute("aria-expanded") === "true";
    if (open) { closeMobNav(); return; }
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    menu.classList.add("is-open");
    if (bd) { bd.hidden = false; bd.classList.add("is-open"); }
    document.body.classList.add("mob-nav-open");
  }
  function navItems() {
    var u = state.user;
    var items = [
      { href: "#/", label: tr("nav.home") },
      { href: "#/gradate", label: tr("nav.graded") },
      { href: "#/non-gradate", label: tr("nav.ungraded") },
      { href: "#/album", label: tr("nav.collection") },
      { href: "#/commissioni", label: trx("nav.fees", "Commissioni e piani"), cls: "nav-fees" }
    ];
    if (u && window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) items.push({ href: "#/messaggi", label: tr("chat.inbox") });
    if (u && u.role === "admin") items.push({ href: "#/admin", label: tr("nav.admin"), badge: pendingReviewCount() });
    items.push({ href: "#/assistenza", label: tr("nav.support"), cls: "nav-support" });
    items.push(u ? { href: "#/account", label: u.display_name } : { href: "#/accedi", label: tr("nav.login") });
    return items;
  }
  function navHtml() {
    return navItems().map(function (i) {
      return '<a href="' + i.href + '" data-link class="' + (i.cls || "") + '">' + esc(i.label) + adminBadgeHtml(i.badge) + "</a>";
    }).join("");
  }
  function ensureMobNav() {
    if (!document.getElementById("mob-nav-backdrop")) {
      var bd = document.createElement("div");
      bd.id = "mob-nav-backdrop";
      bd.className = "mob-nav-backdrop";
      bd.hidden = true;
      bd.addEventListener("click", closeMobNav);
      document.body.appendChild(bd);
    }
    if (!document.getElementById("mob-nav")) {
      var nav = document.createElement("nav");
      nav.id = "mob-nav";
      nav.className = "mob-nav";
      nav.hidden = true;
      nav.setAttribute("aria-label", trx("nav.menu", "Menu"));
      var header = document.querySelector(".topnav");
      if (header) header.appendChild(nav);
      else document.body.appendChild(nav);
    }
    if (!document.getElementById("nav-menu-toggle")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "nav-menu-toggle";
      btn.className = "nav-menu-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "mob-nav");
      var end = document.querySelector(".nav-end");
      if (end) end.insertBefore(btn, end.firstChild);
      else document.body.appendChild(btn);
    }
    var btn2 = document.getElementById("nav-menu-toggle");
    if (btn2) {
      btn2.setAttribute("aria-label", trx("nav.menu", "Menu"));
      btn2.innerHTML = '<span class="nav-menu-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
      btn2.onclick = toggleMobNav;
    }
    var menu = document.getElementById("mob-nav");
    if (menu) {
      menu.innerHTML = navHtml();
      menu.onclick = function (e) { if (e.target && e.target.closest && e.target.closest("a")) closeMobNav(); };
    }
    if (!document.documentElement.dataset.mobNavEsc) {
      document.documentElement.dataset.mobNavEsc = "1";
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMobNav();
      });
    }
  }
  function renderChrome() {
    if (window.DreaMintTradeV9) {
      window.DreaMintTradeV9.setCfg(state.cfg || {});
      window.DreaMintTradeV9.setUser(state.user);
    }
    document.getElementById("desk-nav").innerHTML = navHtml();
    ensureMobNav();
    closeMobNav();
    var tabIco = {
      home: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 11.2 12 5l8 6.2V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1v-8.8Z"/></svg>',
      graded: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.4 20.4 10 12 21 3.6 10 12 3.4Z"/></svg>',
      ungraded: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="4" width="14" height="16" rx="1.6"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
      collection: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
      admin: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.5 19 6.2v5.3c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6.2L12 3.5Z"/></svg>',
      login: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.2"/><path d="M5.2 19.2c1.2-3.2 3.6-4.6 6.8-4.6s5.6 1.4 6.8 4.6"/></svg>',
      profile: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.2"/><path d="M5.2 19.2c1.2-3.2 3.6-4.6 6.8-4.6s5.6 1.4 6.8 4.6"/></svg>'
    };
    var tabs = [
      ["#/", "home", tr("nav.home")],
      ["#/gradate", "graded", tr("nav.graded")],
      ["#/non-gradate", "ungraded", tr("nav.ungraded")],
      ["#/album", "collection", tr("nav.collection")]
    ];
    if (state.user && state.user.role === "admin") tabs.push(["#/admin", "admin", tr("nav.admin")]);
    tabs.push([state.user ? "#/account" : "#/accedi", state.user ? "profile" : "login", state.user ? tr("nav.profile") : tr("nav.login")]);
    var tabbar = document.getElementById("tabbar");
    tabbar.innerHTML = tabs.map(function (i) {
      var extra = i[1] === "admin" ? adminBadgeHtml() : "";
      return '<a href="' + i[0] + '" data-link>' + (tabIco[i[1]] || "") + "<span>" + i[2] + extra + "</span></a>";
    }).join("");
    tabbar.style.gridTemplateColumns = "repeat(" + tabs.length + ", minmax(0, 1fr))";
    var r = route();
    document.querySelectorAll(".desk-nav a, .tabbar a, .mob-nav a").forEach(function (a) {
      var href = a.getAttribute("href").replace(/^#/, "");
      if (href === "#/") href = "/";
      var on = href === r.path || (href !== "/" && r.path.startsWith(href));
      if ((href === "/album" || href === "/collezione") && isAlbumPath(r.path)) on = true;
      a.classList.toggle("on", on);
      a.classList.toggle("active", on);
    });
    var b = document.getElementById("launch-banner");
    var cfg = state.cfg;
    var dateLabel = (cfg.launchPublicDateLabel && cfg.launchPublicDateLabel !== "Data di lancio pubblico: da annunciare")
      ? cfg.launchPublicDateLabel
      : tr("banner.dateDefault");
    b.hidden = false;
    if (window.DreaMintHome) {
      b.classList.add("lb2");
      b.innerHTML = window.DreaMintHome.bannerHtml(cfg);
      syncUserSearchChrome();
      return;
    }
    b.innerHTML = '<span class="offer-badge">' + tr("banner.badge") + "</span><span>" +
      tr("banner.body", { days: (cfg.offerDays || 15), date: dateLabel, range: feeRangeText(cfg) }) +
      italyShipNote().replace("ship-italy-note", "ship-italy-note inline") +
      ' <a href="/legal/regolamento-lancio">' + tr("banner.rules") + "</a></span>";
    syncUserSearchChrome();
  }

  function gemintCardBack() {
    return '<div class="hero-card-back" aria-hidden="true"><div class="dreamint-card-back">' +
      '<img src="/img/dreamint-icon.webp?v=20261110d" width="512" height="512" alt="">' +
      "</div></div>";
  }
  function heroFlipCard(ex, slot) {
    return '<button type="button" class="hero-card" data-hero-card data-slot="' + slot + '" data-pos="' + (slot - 1) + '" aria-label="' + esc(tr("home.cardAria", { name: ex.name })) + '">' +
      '<div class="hero-card-spin" data-spin>' +
      '<div class="hero-card-face is-front">' +
      slabFrame({
        img: ex.img, grader: ex.grader, grade: ex.grade, serial: ex.code, tier: ex.tier, tierLabel: ex.tierLabel,
        cls: "hero-slab-face", noTilt: true, sizes: "(max-width:860px) 42vw, 200px"
      }) +
      '</div><div class="hero-card-face is-back">' + gemintCardBack() + "</div></div></button>";
  }
  function pageHome(recent) {
    var bits = [
      '<span class="t-comune">' + tr("tier.comune") + "</span> <b>" + tr("tier.comune.pct") + '</b> <span class="serial">#3065 / 9999</span>',
      '<span class="t-rara">' + tr("tier.rara") + "</span> <b>" + tr("tier.rara.pct") + '</b> <span class="serial">#7360 / 9999</span>',
      '<span class="t-epica">' + tr("tier.epica") + "</span> <b>" + tr("tier.epica.pct") + '</b> <span class="serial">#2593 / 9999</span>',
      '<span class="t-leggendaria">' + tr("tier.leggendaria") + "</span> <b>" + tr("tier.leggendaria.pct") + '</b> <span class="serial">#8147 / 9999</span>',
      '<span class="t-mitica">' + tr("tier.mitica") + "</span> <b>" + tr("tier.mitica.pct") + '</b> <span class="serial">#4821 / 9999</span>',
      "<span>" + tr("home.ticker.offer") + "</span>",
      "<span>Pokémon · One Piece · Lorcana · Magic · Yu-Gi-Oh!</span>",
      "<span>PSA · BGS · CGC · GRAAD · Vertex · AiGrading</span>"
    ];
    var ticker = bits.concat(bits).join('<span aria-hidden="true">  ·  </span>');
    return '<section class="hero"><div class="hero-copy">' +
      '<p class="kicker">' + tr("home.kicker") + "</p>" +
      '<h1 class="hero-title"><span class="hero-line"><span>' + tr("home.title1") + '</span></span><span class="hero-line"><span>' + tr("home.title2a") + " <em>" + tr("home.title2em") + "</em>.</span></span></h1>" +
      '<p class="games-line">' + tr("home.games") + "</p>" +
      '<p class="lede">' + tr("home.lede") + "</p>" +
      '<div class="hero-actions">' +
      '<a class="btn primary" href="#/gradate" data-link>' + tr("home.ctaGraded") + "</a>" +
      '<a class="btn ghost" href="#/non-gradate" data-link>' + tr("home.ctaUngraded") + "</a>" +
      (state.user ? '<a class="btn ghost" href="#/collezione" data-link>' + tr("home.ctaCollection") + "</a>" : '<a class="btn ghost" href="#/registrati" data-link>' + tr("home.ctaSignup") + "</a>") +
      "</div></div>" +
      '<div class="slab-stage hero-slab"><div class="hero-fan" data-hero-fan role="group" aria-label="' + esc(tr("home.fanAria")) + '">' +
      exampleCards().map(function (ex, i) { return heroFlipCard(ex, i); }).join("") +
      '</div><p class="hero-fan-hint">' + tr("home.fanHint") + "</p></div></section>" +
      '<div class="ticker-wrap" aria-hidden="true"><div class="ticker">' + ticker + "</div></div>" +
      '<section class="split">' +
      '<a class="choice" href="#/gradate" data-link><h3>' + tr("home.choiceGraded.h") + "</h3><p>" + tr("home.choiceGraded.p") + '</p><span class="go">' + tr("home.choiceGraded.go") + "</span></a>" +
      '<a class="choice" href="#/non-gradate" data-link><h3>' + tr("home.choiceRaw.h") + "</h3><p>" + tr("home.choiceRaw.p") + '</p><span class="go">' + tr("home.choiceRaw.go") + "</span></a>" +
      "</section>" +
      (window.DreaMintCert ? window.DreaMintCert.homeHowToHtml() : "") +
      rarityLadder() +
      rareShowcase() +
      '<p class="notes" style="margin-top:14px">' + tr("home.nfc") + "</p>" +
      oddsPanel() +
      '<section class="notes"><p>' + tr("home.notes") + "</p>" + italyShipNote() + "</section>" +
      justInSection(recent || []);
  }
  function step(n, t) { return '<div class="step"><div class="num">' + n + "</div><p class=\"muted\">" + t + "</p></div>"; }
  function oddsPanel() {
    return '<section class="panel"><h2>' + tr("odds.title") + '</h2><table class="odds">' +
      [[tr("tier.comune"), tr("tier.comune.pct"), "70%", "var(--comune)", "comune"], [tr("tier.rara"), tr("tier.rara.pct"), "20%", "var(--rara)", "rara"], [tr("tier.epica"), tr("tier.epica.pct"), "8%", "var(--epica)", "epica"], [tr("tier.leggendaria"), tr("tier.leggendaria.pct"), "1.9%", "var(--leggendaria)", "leggendaria"], [tr("tier.mitica"), tr("tier.mitica.pct"), "0.8%", "var(--mitica-text)", "mitica"]]
        .map(function (r) {
          return '<tr class="pill-' + r[4] + '" style="color:' + r[3] + '"><td><span class="swatch" style="background:' + r[3] + '"></span>' + r[0] + "</td><td>" + r[1] + '</td><td><div class="bar"><i style="width:' + r[2] + '"></i></div></td></tr>';
        }).join("") + "</table></section>";
  }

  function pageAuth(mode) {
    var signup = mode === "signup";
    return '<section class="panel" style="max-width:480px;margin:20px auto"><h2>' + (signup ? tr("auth.signup") : tr("auth.login")) + "</h2>" +
      '<form id="auth-form">' +
      (signup ? '<label class="field">' + tr("auth.name") + '<input name="display_name" required maxlength="60"></label>' : "") +
      (signup ? '<label class="field">' + tr("auth.username") + '<input name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_.]{3,20}" autocapitalize="none" autocomplete="username" spellcheck="false" placeholder="' + esc(tr("auth.usernamePh")) + '"></label><p class="dim">' + esc(tr("auth.usernameHint")) + "</p>" +
        '<fieldset class="privacy-choice"><legend>' + esc(tr("auth.privacyLegend")) + "</legend><p class=\"dim\">" + esc(tr("auth.privacyHint")) + "</p>" +
        '<label class="privacy-option"><input type="radio" name="album_public" value="0" checked><span><strong>' + esc(tr("auth.privacyPrivate")) + "</strong><em>" + esc(tr("auth.privacyPrivateDesc")) + "</em></span></label>" +
        '<label class="privacy-option"><input type="radio" name="album_public" value="1"><span><strong>' + esc(tr("auth.privacyPublic")) + "</strong><em>" + esc(tr("auth.privacyPublicDesc")) + "</em></span></label></fieldset>" + planPickerHtml() : "") +
      '<label class="field">' + tr("auth.email") + '<input name="email" type="email" required autocomplete="' + (signup ? "email" : "username") + '"></label>' +
      '<label class="field">' + tr("auth.password") + '<input name="password" type="password" required minlength="8" autocomplete="' + (signup ? "new-password" : "current-password") + '"></label>' +
      (signup ? (function () {
        var storedRef = getStoredRef();
        var terms = '<a href="/legal/termini">' + tr("auth.terms") + "</a>";
        var privacy = '<a href="/legal/privacy">' + tr("auth.privacy") + "</a>";
        return '<label class="field">' + tr("auth.country") + '<input name="country" value="' + esc(tr("auth.countryDefault")) + '"></label>' +
          '<label class="field invite-field">' + tr("auth.invite") + '<input name="invite_code" maxlength="20" value="' + esc(storedRef) + '" placeholder="' + esc(tr("auth.invitePh")) + '" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>' +
          (storedRef
            ? '<p class="notice invite-prefill">' + tr("auth.inviteFound", { code: esc(storedRef) }).replace(esc(storedRef), "<b>" + esc(storedRef) + "</b>") + "</p>"
            : '<p class="dim invite-hint">' + tr("auth.inviteHint") + "</p>") +
          '<p class="dim">' + tr("auth.accept", { terms: terms, privacy: privacy }) + "</p>";
      })() : "") +
      '<p class="error" id="form-err" hidden></p>' +
      '<button class="btn primary" type="submit">' + (signup ? tr("auth.submitSignup") : tr("auth.submitLogin")) + "</button></form>" +
      '<p class="muted" style="margin-top:14px">' + (signup
        ? tr("auth.haveAccount", { link: '<a href="#/accedi" data-link>' + tr("auth.login") + "</a>" })
        : tr("auth.newHere", { link: '<a href="#/registrati" data-link>' + tr("auth.signup") + "</a>" })) + "</p></section>";
  }


  function isActivelyListed(c) {
    if (!c) return false;
    return c.listing_status === "active" || c.listing_status === "reserved" ||
      !!(c.listing_id && (c.status === "listed" || c.listing_status));
  }
  // v24: the PayPal reminder (with the link to *my* account) is only for the card's owner.
  function isOwnCard(c) {
    return !!(c && state.user && c.physical_owner_id && c.physical_owner_id === state.user.id);
  }
  function sellerNoPaypalNote() {
    return '<p class="dim seller-no-paypal">' + esc(tr("card.sellerNoPaypal")) + "</p>";
  }
  function needsPaypalToSell(c) {
    if (!c || !state.user || state.user.paypal_email) return false;
    if (!isOwnCard(c)) return false;
    if (c.archived_at) return false;
    if (isActivelyListed(c)) return false;
    var hasPrice = Number(c.asking_price_cents || 0) > 0 || Number(c.listing_price_cents || 0) > 0;
    if (!hasPrice) return false;
    return c.status === "approved" || c.status === "listed" || !!c.can_list;
  }
  function paypalNeededHtml() {
    return '<div class="paypal-needed" role="status">' +
      "<p>" + esc(tr("card.needPaypal")) + "</p>" +
      '<a class="btn primary" href="#/account" data-link>' + esc(tr("card.addPaypal")) + "</a></div>";
  }
  // Soft-archive UI for ungraded cards sold off-platform.
  // Server flag: cfg.sold_outside_archive === true after Dev deploys POST /api/cards/:id/archive and migrate-v14.
  function soldOutsideReady() {
    return !!(state.cfg && state.cfg.sold_outside_archive);
  }
  function canOfferSoldOutside(c) {
    if (!c || !c.is_ungraded || !state.user || c.archived_at) return false;
    if (isActivelyListed(c)) return false;
    return !!(c.can_list || c.can_edit_price || (c.physical_owner_id && c.physical_owner_id === state.user.id));
  }
  function soldOutsideHtml(c) {
    if (!canOfferSoldOutside(c)) return "";
    return '<div class="sold-outside">' +
      '<button type="button" class="btn ghost" id="sold-outside">' + esc(tr("card.soldOutside")) + "</button>" +
      '<p class="dim">' + esc(tr("card.soldOutsideHint")) + "</p>" +
      '<p class="error" id="sold-outside-err" hidden></p></div>';
  }

  function pageAccount(pendingPaypal) {
    if (!state.user) return pageAuth("login");
    return '<section class="panel"><h2>' + tr("account.title") + "</h2><p><b>" + esc(state.user.display_name) + "</b></p><p class=\"muted\">" + esc(state.user.email) + " · " + esc(state.user.country || tr("auth.countryDefault")) + "</p>" +
      (pendingPaypal && pendingPaypal.length
        ? '<div class="paypal-needed" role="status"><p>' + esc(tr("card.needPaypal")) + "</p></div>" + '<ul class="paypal-needed-list">' + pendingPaypal.map(function (c) {
            return '<li><a href="#/carta/' + c.id + '" data-link>' + esc(cardTitle(c)) + "</a> · " + esc(euros(c.asking_price_cents || c.listing_price_cents)) + "</li>";
          }).join("") + "</ul>"
        : "") +
      (state.user.referred_by && state.user.referred_by.name
        ? '<p><span class="pill gold">' + esc(tr("account.referred", { name: state.user.referred_by.name })) + "</span></p>"
        : "") +
      accountPrivacyHtml() +
      accountPlanHtml() +
      '<form id="paypal-form" style="margin-top:18px"><label class="field">' + tr("account.paypal") + '<input name="paypal_email" type="email" value="' + esc(state.user.paypal_email || "") + '" placeholder="' + esc(tr("account.paypalPh")) + '" autocomplete="email"></label>' +
      '<p class="dim">' + tr("account.paypalHint") + "</p>" +
      '<p class="error" id="paypal-err" hidden></p><p class="ok" id="paypal-ok" hidden></p>' +
      '<button class="btn primary" type="submit">' + tr("account.paypalSave") + "</button></form>" +
      '<div class="account-fees">' + feesHintHtml() +
      '<p class="row-actions"><a class="btn secondary" href="#/commissioni" data-link>' + esc(trx("nav.fees", "Commissioni e piani")) + "</a></p></div>" +
      (state.user.role === "admin" ? '<p style="margin:12px 0"><a class="btn" href="#/admin" data-link>' + tr("account.admin") + adminBadgeHtml() + "</a></p>" +
        '<p style="margin:12px 0"><a class="btn primary" href="#/admin/lancio" data-link>' + esc(trx("al.manage", "Gestisci commissioni e piani")) + "</a></p>" : "") +
      '<p style="margin-top:16px"><button class="btn" id="logout">' + tr("account.logout") + "</button></p></section>";
  }

  function pageRegister(raw) {
    if (!state.user) return pageAuth("login") + '<p class="dim" style="text-align:center">' + tr("reg.needLogin") + "</p>";
    var games = (state.cfg.games || []).filter(function (g) { return g.id !== "fictional_demo"; }).map(function (g) { return '<option value="' + g.id + '">' + esc(gameLabel(g.id)) + "</option>"; }).join("");
    var langs = (state.cfg.languages || ["ITA"]).map(function (l) { return '<option value="' + esc(l) + '">' + esc(languageName(l)) + "</option>"; }).join("");
    var vars = (state.cfg.variants || []).map(function (v) { return '<option value="' + v.id + '">' + esc(variantLabel(v.id)) + "</option>"; }).join("");
    var graders = (state.cfg.graders || []).filter(function (g) { return g.graded; }).map(function (g) { return '<option value="' + g.id + '">' + esc(g.label) + "</option>"; }).join("");
    var conds = (state.cfg.conditions || []).map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + "</option>"; }).join("");
    var title = raw ? tr("reg.titleRaw") : tr("reg.titleGraded");
    var html = '<section class="panel"><h2>' + title + "</h2>" +
      (raw
        ? '<p class="muted">' + tr("reg.introRaw") + '</p><p class="notice">' + tr("home.nfc") + "</p>"
        : '<p class="muted">' + tr("reg.introGraded") + "</p>") +
      '<div class="cat-search-row">' +
      '<label class="field">' + tr("reg.game") + '<select id="cat-game">' + games + "</select></label>" +
      '<label class="field">' + tr("reg.search") + '<input id="cat-q" placeholder="' + esc(catalogPlaceholders("pokemon")) + '"></label>' +
      "</div>" +
      '<div id="cat-results" class="search-list"></div>' +
      '<div class="ref-card" id="ref-card" hidden>' +
      '<img id="ref-img" class="ref-thumb" alt="' + esc(tr("reg.refLabel")) + '">' +
      '<div><p class="ref-label">' + tr("reg.refLabel") + "</p>" +
      '<p class="muted">' + tr("reg.refHint") + "</p>" +
      '<p id="ref-price" class="ref-price"></p></div></div>' +
      '<p class="dim">' + tr("reg.manual") + "</p>" +
      '<input type="hidden" id="model-id">' +
      '<input type="hidden" id="catalog-image">' +
      '<input type="hidden" id="cardmarket-avg">' +
      '<input type="hidden" id="market-avg-usd">' +
      '<input type="hidden" id="kind-fixed" value="' + (raw ? "raw" : "graded") + '">' +
      '<div class="grid-2">' +
      '<label class="field">' + tr("reg.game") + '<select id="game">' + games + "</select></label>" +
      '<label class="field">' + tr("reg.set") + '<input id="set_name" placeholder="' + esc(tr("reg.setPh")) + '"></label>' +
      '<label class="field">' + tr("reg.code") + '<input id="code" placeholder="58/102"></label>' +
      '<label class="field">' + tr("reg.name") + '<input id="name" placeholder="' + esc(tr("reg.namePh")) + '"></label>' +
      '<label class="field">' + tr("reg.language") + '<select id="language">' + langs + "</select></label>" +
      '<label class="field">' + tr("reg.variant") + '<select id="variant">' + vars + "</select></label>" +
      "</div>";
    if (raw) {
      html += '<label class="field">' + tr("reg.condition") + '<select id="condition">' + conds + "</select></label>";
    } else {
      html += '<label class="field">' + tr("reg.grader") + '<select id="grader">' + graders + "</select></label>" +
        '<label class="field">' + tr("reg.cert") + '<input id="cert" autocomplete="off"></label>' +
        '<label class="field">' + tr("reg.grade") + '<input id="grade" placeholder="' + esc(tr("reg.gradePh")) + '"></label>';
    }
    html += '<label class="field sale-price-field">' + tr("reg.price") + '<input id="sale-price" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="' + esc(tr("reg.pricePh")) + '"></label>' +
      '<p class="dim">' + tr("reg.priceHint") + "</p>" +
      feesHintHtml() +
      "</section><section class=\"panel\"><h2>" + tr("reg.photos") + "</h2>";
    html += '<div class="photo-guide"><h3>' + tr("reg.how") + "</h3><ul>" +
      "<li>" + tr("reg.how1") + "</li>" +
      "<li>" + tr("reg.how2") + "</li>" +
      "<li>" + tr("reg.how3") + "</li>" +
      "<li>" + tr("reg.how4") + "</li>" +
      "<li>" + tr("reg.how5") + "</li>" +
      "</ul></div>";
    html += '<p class="notice">' + tr(raw ? "reg.photosRequiredRaw" : "reg.frontRequired") + "</p>";
    if (raw) {
      html += '<p class="muted">' + tr("reg.rawReview") + '</p><div class="photos">' +
        photoSlot("front", tr("reg.front")) +
        photoSlot("back", tr("reg.back"), { hint: tr("reg.backHintRaw") }) + "</div>";
    } else {
      html += '<p class="muted">' + tr("reg.challengeHint") + "</p>" +
        '<div class="challenge" id="challenge"></div><div class="photos">' +
        photoSlot("front", tr("reg.frontGraded"), { showSlab: true }) +
        photoSlot("back", tr("reg.backGraded"), { optional: true, hint: tr("reg.optionalHint"), showSlab: true }) +
        photoSlot("cert", tr("reg.certPhoto"), { optional: true, showSlab: true, defaultRatio: "free" }) + "</div>" +
        '<div class="challenge-video"><p><b>' + esc(tr("reg.challengeVideoTitle")) + "</b> — " + esc(tr("reg.challengeHint")) + "</p>" +
        '<input type="file" id="challenge-video" name="challenge_video" accept="video/*" capture="environment"><p class="dim" id="challenge-video-status"></p></div>';
    }
    html += '<p class="error" id="form-err" hidden></p>' +
      '<button class="btn primary" id="submit-card" type="button">' + (raw ? tr("reg.submitRaw") : tr("reg.submitGraded")) + "</button></section>";
    return html;
  }
  function photoSlot(id, label, opts) {
    opts = opts || {};
    var accept = "image/*,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
    var defaultRatio = opts.defaultRatio || "card";
    return '<div class="photo-slot" data-slot="' + id + '" data-default-ratio="' + defaultRatio + '">' +
      '<span class="photo-slot-label">' + esc(label) +
      (opts.optional ? ' <em>' + tr("reg.optional") + "</em>" : "") + "</span>" +
      (opts.hint ? '<p class="dim photo-slot-hint">' + esc(opts.hint) + "</p>" : "") +
      '<div class="photo-actions">' +
      '<button type="button" class="btn ghost" data-pick="' + id + '" data-capture="1">' + tr("photo.shoot") + "</button>" +
      '<button type="button" class="btn" data-pick="' + id + '">' + tr("photo.upload") + "</button>" +
      "</div>" +
      '<input class="photo-file-input" type="file" accept="' + accept + '" data-photo="' + id + '">' +
      '<div class="photo-editor" id="ed-' + id + '" hidden>' +
      '<div class="crop-stage" id="crop-stage-' + id + '"><canvas class="crop-canvas" id="crop-cv-' + id + '"></canvas></div>' +
      '<p class="crop-hint">' + tr("photo.cropHint") + "</p>" +
      '<div class="photo-tools">' +
      '<button type="button" class="btn ghost" data-rot="-90" data-for="' + id + '">' + tr("photo.rotLeft") + "</button>" +
      '<button type="button" class="btn ghost" data-rot="90" data-for="' + id + '">' + tr("photo.rotRight") + "</button>" +
      '<button type="button" class="btn ghost' + (defaultRatio === "card" ? " on" : "") + '" data-ratio="card" data-for="' + id + '">' + tr("photo.ratioCard") + "</button>" +
      (opts.showSlab ? '<button type="button" class="btn ghost' + (defaultRatio === "slab" ? " on" : "") + '" data-ratio="slab" data-for="' + id + '">' + tr("photo.ratioSlab") + "</button>" : "") +
      '<button type="button" class="btn ghost' + (defaultRatio === "free" ? " on" : "") + '" data-ratio="free" data-for="' + id + '">' + tr("photo.ratioFree") + "</button>" +
      '<button type="button" class="btn ghost" data-refit data-for="' + id + '">' + tr("photo.fit") + "</button>" +
      '<label class="angle-lab">' + tr("photo.straighten") + ' <input type="range" min="-15" max="15" step="0.1" value="0" data-angle data-for="' + id + '"></label>' +
      '<button type="button" class="btn ghost" data-reset-angle data-for="' + id + '">' + tr("photo.reset") + "</button>" +
      '<label class="angle-lab">' + tr("photo.zoom") + ' <input type="range" min="100" max="350" value="100" data-zoom data-for="' + id + '"></label>' +
      '</div><p class="photo-warn" id="warn-' + id + '" hidden></p></div></div>';
  }

  function pageCollection(cards) {
    var tab = albumTabFromParts(route().parts, 1);
    var head = '<div class="page-head"><div><h1>' + tr("collection.title") + "</h1><p>" + tr("collection.lede") + "</p></div>" +
      '<div class="row-actions"><a class="btn primary" href="#/registra/gradate" data-link>' + tr("collection.addGraded") + '</a><a class="btn ghost" href="#/registra/non-gradate" data-link>' + tr("collection.addRaw") + "</a>" +
      (window.DreaMintCert ? window.DreaMintCert.collectionExtraLinks() : "") +
      "</div></div>";
    if (publicAlbumsOn()) {
      if (state.user && !state.user.username) {
        head += '<div class="notice album-username-banner" id="album-username-box"><p>' + esc(tr("album.needUsername")) + "</p>" + usernameFormHtml() + "</div>";
      }
      head += '<section class="album-privacy" aria-label="' + esc(tr("account.privacyTitle")) + '">' + privacyToggleHtml() + "</section>";
    }
    var mythics = (cards || []).filter(function (c) { return c.rarity_tier === "mitica"; });
    var legends = (cards || []).filter(function (c) { return c.rarity_tier === "leggendaria"; });
    if (mythics.length || legends.length) {
      head += '<div class="owned-rare-banner">';
      if (mythics.length) head += '<p class="owned-mitica"><strong>' + tr(mythics.length === 1 ? "collection.ownedMythicOne" : "collection.ownedMythicMany", { n: mythics.length }) + "</strong>" + tr("collection.ownedMythicHint") + "</p>";
      if (legends.length) head += '<p class="owned-legen"><strong>' + tr(legends.length === 1 ? "collection.ownedLegendOne" : "collection.ownedLegendMany", { n: legends.length }) + "</strong>" + tr("collection.ownedLegendHint") + "</p>";
      head += "</div>";
    }
    cards = (cards || []).slice().sort(function (a, b) {
      return TIER_ORDER.indexOf(b.rarity_tier) - TIER_ORDER.indexOf(a.rarity_tier);
    });
    return head + albumSectionsHtml(cards, { owner: true, tab: tab });
  }

  function pageCard(c) {
    var serial = c.serial_number ? serialFmt(c.serial_number, c.serial_total) : "";
    var html = '<section class="card-hero"><div class="slab-stage' + (c.is_ungraded ? " raw-stage" : "") + '">' +
      (c.is_ungraded ? rawCardFigure(c, { sizes: "(max-width:860px) 70vw, 280px", flip: true }) : slabFrame({
        img: digitalArt(c).img,
        srcset: digitalArt(c).srcset,
        sizes: "(max-width:860px) 70vw, 280px",
        grader: c.is_ungraded ? "RAW" : (c.grader || "DreaMint"),
        grade: c.is_ungraded ? (c.card_condition || "RAW") : (c.grade || "—"),
        cert: c.certificate_no ? ((c.grader || "") + " " + c.certificate_no) : "",
        serial: serial,
        tier: c.rarity_tier || "",
        tierLabel: c.rarity_label || "",
        raw: c.is_ungraded
      })) + '</div><div class="facts">' +
      '<p class="kicker">' + esc(c.is_ungraded ? tr("card.sellerPhotos") : (catalogArt(c) ? tr("card.digitalCatalog") : tr("card.digital"))) + "</p>" +
      "<h1>" + esc(cardTitle(c)) + "</h1>" +
      (serial ? '<p class="serial serial-lg">' + esc(serial) + "</p>" : "") +
      "<p>" + pillStatus(c.status) +
      (c.is_test ? '<span class="pill pill-test">TEST</span>' : "") +
      (c.is_ungraded ? '<span class="pill pill-raw">' + tr("pill.ungraded") + "</span>" : '<span class="pill">' + esc(graderLabel(c.grader)) + (c.grade ? " " + esc(c.grade) : "") + "</span>") +
      (c.card_condition ? '<span class="pill">' + esc(conditionLabel(c.card_condition)) + "</span>" : "") +
      (c.rarity_tier ? rarityPillsHtml(c.rarity_tier) : "") +
      (function () {
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) return window.DreaMintTradeV9.ownershipPillsHtml(c);
        return c.full_set === "yes" ? '<span class="pill pill-leggendaria">' + tr("pill.fullSet") + "</span>" : "";
      })() + "</p>" +
      (c.rarity_tier ? rarityCalloutHtml(c.rarity_tier) : "");
    if (c.status === "rejected") html += '<p class="error">' + tr("card.rejected", { reason: esc(c.rejection_reason) }) + "</p>";
    if (c.status === "in_review") html += c.is_ungraded
      ? '<p class="muted">' + tr("card.reviewRaw") + "</p>"
      : '<p class="muted">' + tr("card.reviewGraded") + "</p>";
    if (c.can_update_photos) {
      html += '<section class="panel photo-replace" id="photo-replace"><h3>' + tr("photo.replace") + "</h3>" +
        '<p class="muted">' + tr("photo.replaceHint") + '</p><div class="photos">' +
        photoSlot("front", tr("reg.front"), { showSlab: !c.is_ungraded }) +
        photoSlot("back", tr("reg.back"), c.is_ungraded
          ? { hint: tr("reg.backHintRaw"), showSlab: false }
          : { optional: true, hint: tr("reg.optionalHint"), showSlab: true }) +
        (c.is_ungraded ? "" :
          photoSlot("challenge", tr("reg.challengePhoto"), { showSlab: true }) +
          photoSlot("cert", tr("reg.certPhoto"), { optional: true, showSlab: true, defaultRatio: "free" })) +
        '</div><button class="btn primary" type="button" id="save-photos">' + tr("photo.save") + "</button>" +
        '<p class="ok" id="photos-ok" hidden></p><p class="error" id="form-err" hidden></p></section>';
    }
    if (c.cardmarket_avg_cents) html += '<p class="ref-price">' + esc(cardmarketLabel(c.cardmarket_avg_cents, true)) + "</p>";
    if (c.id && c.model && c.model.game) html += priceTrendSlot({ slab_id: c.id }, false);
    if (c.listing_status === "reserved" || c.listing_status === "paused") {
      html += '<p class="price">' + tr("card.soldPendingShip") + "</p>";
    } else if (c.listing_price_cents && (c.status === "listed" || c.listing_status === "active")) {
      html += '<p class="price">' + tr("card.listedAt", { price: euros(c.listing_price_cents) }) + "</p>";
    } else if (c.asking_price_cents) {
      html += '<p class="price">' + tr("card.asking", { price: euros(c.asking_price_cents) }) + "</p>";
      if (c.status === "in_review") {
        html += c.is_ungraded
          ? '<p class="dim">' + tr("card.askHintRaw") + "</p>"
          : '<p class="dim">' + tr("card.askHintGraded") + "</p>";
      }
    }
    var v9Sell = (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? window.DreaMintTradeV9.listFormHtml(c) : null;
    if (c.listing_blocked_reason === "no_price" && !v9Sell) html += '<p class="dim">' + esc(tr("card.noPrice")) + "</p>";
    if (c.is_ungraded && c.status === "approved") html += '<p class="muted">' + tr("card.rawNote") + "</p>";
    if (c.rarity_tier || c.rarity_label) html += '<p class="price">' + esc((tierInfo(c.rarity_tier) && tierInfo(c.rarity_tier).label) || c.rarity_label) + (serial ? " · " + esc(serial) : "") + "</p>";
    if (c.can_open) html += '<p class="row-actions"><a class="btn primary" href="#/apri/' + c.id + '" data-link>' + tr("card.open") + "</a></p>";
    if (c.can_replay) html += '<p class="row-actions"><a class="btn ghost" href="#/apri/' + c.id + '" data-link>' + tr("card.replay") + "</a></p>";
    if (c.can_edit_price && !v9Sell) {
      var current = (c.listing_price_cents || c.asking_price_cents || 0) / 100;
      html += '<form id="price-form" style="margin-top:16px"><label class="field">' + tr("reg.price") + '<input name="price" type="number" min="0.01" step="0.01" inputmode="decimal" required value="' + (current ? current.toFixed(2) : "") + '"></label>' +
        feesHintHtml() +
        '<p class="error" id="price-err" hidden></p><p class="ok" id="price-ok" hidden></p>' +
        '<button class="btn" type="submit">' + tr("card.updatePrice") + "</button></form>";
    }
    if (c.can_edit_price && c.listing_id && c.listing_status === "active") {
      html += '<p class="row-actions">' + closeListingBtnHtml(c) + "</p>";
    }
    if (isOwnCard(c) && (needsPaypalToSell(c) || c.listing_blocked_reason === "no_paypal")) {
      html += paypalNeededHtml();
    } else if (!isOwnCard(c) && c.listing_blocked_reason === "no_paypal") {
      html += sellerNoPaypalNote();
    } else if (c.can_list && !c.listing_id) {
      var v9form = (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? window.DreaMintTradeV9.listFormHtml(c) : null;
      if (v9form) {
        html += v9form;
      } else {
        var prefill = c.asking_price_cents ? (Number(c.asking_price_cents) / 100).toFixed(2) : "";
        html += '<form id="list-form" style="margin-top:16px"><label class="field">' + tr("reg.price") + '<input name="price" type="number" min="0.01" step="0.01" inputmode="decimal" required value="' + prefill + '"></label>' +
          feesHintHtml() +
          '<button class="btn primary" type="submit">' + tr("card.publish") + "</button></form>";
      }
    } else if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on() && window.DreaMintTradeV9.listFormHtml(c)) {
      html += window.DreaMintTradeV9.listFormHtml(c);
    }
    html += soldOutsideHtml(c);
    html += "</div></section>";
    var galFlags = Object.assign({}, c.photos || {});
    if (c.missing_back) galFlags.back = false;
    if (c.is_ungraded && galFlags.back === false) galFlags.backPlaceholder = true;
    html += photoGallery(c.id, galFlags, c.is_ungraded ? tr("card.photosTitle") : tr("card.photosProof"));
    if (c.commit_hash && !c.is_ungraded) {
      html += '<section class="panel"><h3>' + tr("card.extract") + "</h3>" +
        '<div class="kv"><dt>Commit</dt><dd>' + esc(c.commit_hash) + "</dd></div>" +
        (c.server_seed ? '<div class="kv"><dt>Seed</dt><dd>' + esc(c.server_seed) + "</dd></div>" : '<p class="dim">' + tr("card.seedLater") + "</p>") +
        (c.digest ? '<div class="kv"><dt>Digest</dt><dd>' + esc(c.digest) + (c.roll != null ? " → roll " + Number(c.roll).toFixed(6) : "") + "</dd></div>" : "") +
        "</section>";
    }
    if (window.DreaMintCert) html += window.DreaMintCert.cardActionButtons(c);
    else if (c.rarity_tier && !c.is_ungraded) {
      html += '<p class="row-actions"><button type="button" class="btn ghost" id="share-rarity" data-share="1">' + tr("card.share") + "</button></p>";
    }
    if (c.status !== "in_review" && c.status !== "rejected") html += shareRowHtml(c);
    return html;
  }

  // Public share URL: /c/<id> for graded digital copies (server page with OG tags);
  // otherwise the public SPA route: the active listing if there is one, else the card page.
  // (A server-rendered /l/<id> with OG tags is prepared in /workspace/dreamint-handoff for Dev.)
  function publicCardUrl(c, listing) {
    var id = c && (c.slab_id || c.id);
    if (!id) return location.origin + "/";
    if (c.rarity_tier && !c.is_ungraded) return location.origin + "/c/" + encodeURIComponent(id);
    var lid = (listing && listing.id) || ((c.listing_status === "active" || c.listing_status === "reserved") ? c.listing_id : "");
    return location.origin + "/#/" + (lid ? "annuncio/" + encodeURIComponent(lid) + "/" : "carta/") + encodeURIComponent(id);
  }
  function shareRowHtml(c, listing) {
    var url = publicCardUrl(c, listing);
    return '<div class="share-row" data-share-row>' +
      '<p class="share-links"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + tr("card.pageLink") + "</a>" +
      ' · <button type="button" class="linklike" data-share-link>' + tr("card.shareLink") + "</button>" +
      ' <span class="share-url mono">' + esc(url.replace(/^https?:\/\//, "")) + "</span></p>" +
      '<p class="row-actions"><button type="button" class="btn ghost" data-share-img="post">' + tr("share.socialImg") + "</button>" +
      '<button type="button" class="btn ghost small" data-share-img="story">' + tr("share.storyImg") + "</button></p></div>";
  }
  function dmToast(msg) {
    var t = document.getElementById("dm-toast");
    if (!t) { t = document.createElement("div"); t.id = "dm-toast"; t.className = "dm-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? res() : rej(new Error("copy")); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }
  function shareImageData(c, listing) {
    var m = c.model || {};
    var id = c.slab_id || c.id;
    var graded = !c.is_ungraded;
    var tier = graded ? (c.rarity_tier || "") : "";
    var name = (listing && listing.card_name) || m.name || c.card_name || c.name || tr("share.card");
    var meta = [(listing && listing.set_name) || m.set_name || c.set_name, (listing && listing.code_printed) || m.code_printed || c.code_printed, languageName((listing && listing.language) || m.language || c.language)].filter(Boolean).join(" · ");
    var badge = graded
      ? [graderLabel(c.grader) + (c.grade ? " " + c.grade : ""), tier ? ((tierInfo(tier) && tierInfo(tier).label) || c.rarity_label) : ""].filter(Boolean).join(" · ")
      : [tr("pill.ungraded"), c.card_condition ? c.card_condition : ""].filter(Boolean).join(" · ");
    var cm = (listing && listing.cardmarket_avg_cents) || c.cardmarket_avg_cents;
    if (!graded && cm) meta = [meta, tr("share.cmAvg", { price: euros(cm) })].filter(Boolean).join(" · ");
    var cents = (listing && listing.price_cents) || c.listing_price_cents || c.asking_price_cents || 0;
    var art = (graded && tier) ? location.origin + "/api/copies/" + encodeURIComponent(id) + "/art" : photoSrc(id, "front", 672);
    var refArt = (!graded && c.photos && c.photos.front === false) ? ((c.model && c.model.catalog_image) || "") : "";
    if (refArt) art = refArt;
    var watermark = (window.DreaMintTradeV9 && window.DreaMintTradeV9.watermarkText)
      ? window.DreaMintTradeV9.watermarkText(c, state.user) : "";
    return { name: name, meta: meta, badge: badge, price: cents ? euros(cents) : "", url: publicCardUrl(c, listing), art: art,
      tier: tier, ungraded: !graded, slug: name, refLabel: refArt ? tr("raw.refTag") : "", watermark: watermark };
  }
  function bindShareRow(c, listing) {
    var row = document.querySelector("[data-share-row]");
    if (!row || !c) return;
    var url = publicCardUrl(c, listing);
    var lk = row.querySelector("[data-share-link]");
    if (lk) lk.onclick = function () {
      var mobile = /iP(hone|ad|od)|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var data = shareImageData(c, listing);
      if (mobile && navigator.share) {
        navigator.share({ title: "DreaMint", text: data.name, url: url }).then(function () { dmToast(tr("share.shared")); }).catch(function (e) {
          if (e && e.name === "AbortError") return;
          copyText(url).then(function () { dmToast(tr("share.copied")); });
        });
        return;
      }
      copyText(url).then(function () { dmToast(tr("share.copied")); }).catch(function () { window.prompt(tr("card.shareLink"), url); });
    };
    row.querySelectorAll("[data-share-img]").forEach(function (b) {
      b.onclick = function () {
        if (!window.DreaMintShare || !window.DreaMintShare.shareListingImage) return;
        b.disabled = true; dmToast(tr("share.making"));
        var data = shareImageData(c, listing);
        var id = c && (c.slab_id || c.id);
        var goShare = function () {
          window.DreaMintShare.shareListingImage(data, b.getAttribute("data-share-img"))
            .then(function (r) { if (r && r.downloaded) dmToast(tr("share.downloaded")); else if (r && r.shared) dmToast(tr("share.shared")); })
            .catch(function () { dmToast(tr("share.failed")); })
            .then(function () { b.disabled = false; });
        };
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.loadStamp && id && !c.is_ungraded) {
          window.DreaMintTradeV9.loadStamp(id).then(function (text) {
            if (text) data.watermark = text;
            goShare();
          }).catch(function () { goShare(); });
        } else goShare();
      };
    });
  }

  function pageRevealShell() { return '<div id="reveal-root"></div>'; }

  function tradeLookbook() {
    var samples = [
      { title: "Pokémon - Italian - Voltaggio Sfolgorante - Charizard (Near Mint)", cond: "Near Mint", price: "—" },
      { title: "One Piece - English - Romance Dawn - Monkey D. Luffy (Excellent)", cond: "Excellent", price: "—" },
      { title: "Lorcana - English - The First Chapter - Elsa - Snow Queen (Lightly Played)", cond: "Lightly Played", price: "—" }
    ];
    return '<div class="trade-grid lookbook-trade" aria-hidden="true">' + samples.map(function (s) {
      return '<div class="trade-card is-demo"><div class="trade-thumb demo-thumb"><span class="ph-kicker">' + tr("ph.sellerPhoto") + '</span></div><div><h3>' + esc(s.title) +
        '</h3><div class="muted">' + s.cond + '</div><div class="price">' + s.price +
        '</div><div class="muted">' + tr("look.preview") + "</div></div></div>";
    }).join("") + "</div>";
  }
  function lookbook() {
    return '<div class="lookbook" aria-hidden="true">' + exampleCards().map(function (ex) {
      return "<figure>" + slabFrame({
        img: ex.img || "", grader: ex.grader, grade: ex.grade, serial: ex.code, tier: ex.tier, tierLabel: ex.tierLabel,
        cardName: ex.name, cardMeta: exampleTitle(ex), phLabel: tr("ph.sellerPhoto")
      }) + "<figcaption>" + esc(exampleTitle(ex)) + "</figcaption></figure>";
    }).join("") + "</div>";
  }
  function justInSection(items) {
    var html = '<section class="just-in"><div class="page-head"><div><h2>' + tr("justin.title") + '</h2><p class="muted">' + tr("justin.lede") + "</p></div></div>";
    if (items && items.length) {
      html += '<div class="just-grid">' + items.map(function (it) {
        return '<a class="just-card" href="#/carta/' + it.id + '" data-link>' +
          '<div class="just-thumb">' + (catalogArt(it) ? '<img src="' + catalogArt(it) + '" alt="">' : photoImg(it.id, "front", "(max-width:600px) 46vw, 180px")) + "</div>" +
          '<p class="just-title">' + esc(cardTitle(it)) + "</p></a>";
      }).join("") + "</div></section>";
      return html;
    }
    html += '<div class="just-grid" aria-hidden="true">' + exampleCards().map(function (ex) {
      return '<div class="just-card is-demo"><div class="just-thumb' + (ex.img ? "" : " demo-thumb") + '">' +
        (ex.img ? '<img src="' + ex.img + '" alt="">' : '<span class="ph-kicker">' + tr("ph.sellerPhoto") + '</span><strong class="ph-name">' + esc(ex.name) + "</strong>") +
        "</div><p class=\"just-title\">" + esc(exampleTitle(ex)) + "</p></div>";
    }).join("") + "</div></section>";
    return html;
  }
  function photoGallery(cardId, flags, title) {
    flags = flags || { front: true, back: true };
    var kinds = [];
    if (flags.front !== false) kinds.push(["front", tr("gal.front")]);
    if (flags.back !== false) kinds.push(["back", tr("gal.back")]);
    if (flags.cert) kinds.push(["cert", tr("gal.label")]);
    if (!kinds.length) return "";
    var main = kinds[0][0];
    return '<section class="panel product-photos"><h3>' + esc(title || tr("gal.photos")) + "</h3>" +
      '<div class="product-gallery" data-card="' + cardId + '">' +
      '<button type="button" class="product-main" id="gal-main" data-kind="' + main + '" aria-label="' + esc(tr("gal.zoom")) + '">' +
      photoImg(cardId, main, "(max-width:860px) 92vw, 420px", "gal-main-img") + "</button>" +
      '<div class="product-thumbs">' + kinds.map(function (k) {
        return '<button type="button" class="product-thumb' + (k[0] === main ? " on" : "") + '" data-kind="' + k[0] + '" aria-label="' + esc(k[1]) + '">' +
          photoImg(cardId, k[0], "72px") + "<span>" + esc(k[1]) + "</span></button>";
      }).join("") +
      (flags.backPlaceholder ? '<span class="product-thumb is-missing" aria-label="' + esc(tr("raw.backMissing")) + '"><span class="raw-back-ph">' + esc(tr("raw.backMissing")) + "</span><span>" + esc(tr("gal.back")) + "</span></span>" : "") +
      "</div></div>" +
      '<div class="lightbox" id="lightbox" hidden><button type="button" class="lightbox-close" aria-label="' + esc(tr("gal.close")) + '">×</button>' +
      '<img id="lb-img" alt="' + esc(tr("gal.full")) + '"></div></section>';
  }
  function pageMarket(listings, section, tierFilter, condFilter) {
    var raw = section === "ungraded";
    condFilter = condFilter || "";
    var dateLabel = (state.cfg.launchPublicDateLabel && state.cfg.launchPublicDateLabel !== "Data di lancio pubblico: da annunciare")
      ? state.cfg.launchPublicDateLabel
      : tr("banner.dateDefault");
    var html = raw
      ? '<div class="page-head"><div><h1>' + tr("market.ungraded.h") + "</h1><p>" + tr("market.ungraded.p") + "</p></div>" +
        '<a class="btn primary" href="#/registra/non-gradate" data-link>' + tr("market.sell") + "</a></div>" +
        conditionFilterRow(condFilter) +
        '<p class="notes">' + tr("market.ungraded.notes", { date: dateLabel, range: feeRangeText(state.cfg) }) + italyShipNote() + "</p>"
      : '<div class="page-head"><div><h1>' + tr("market.graded.h") + "</h1><p>" +
        ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? tr("market.graded.pV9") : tr("market.graded.p")) + "</p></div>" +
        '<a class="btn primary" href="#/registra/gradate" data-link>' + tr("market.register") + "</a></div>" +
        '<p class="notes">' + tr("market.graded.notes", { date: dateLabel, range: feeRangeText(state.cfg) }) + italyShipNote() + "</p>" +
        rarityFilterRow(tierFilter) +
        ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? window.DreaMintTradeV9.certSearchCompact() + window.DreaMintTradeV9.offerFilterRow(window.DreaMintTradeV9.activeOffer()) : "");
    html += '<p class="row-actions"><a class="btn ghost" href="#/vendite" data-link>' + tr("market.sales") + "</a></p>";
    if (!raw && window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
      listings = window.DreaMintTradeV9.filterByOffer(listings, window.DreaMintTradeV9.activeOffer());
    }
    if (!raw && tierFilter) {
      listings = listings.filter(function (l) { return l.rarity_tier === tierFilter; });
    }
    if (raw && condFilter) {
      listings = listings.filter(function (l) { return l.card_condition === condFilter; });
    }
    if (window.DreaMintHome && window.DreaMintHome.marketBoard) {
      if (listings.length) return html + window.DreaMintHome.marketBoard(listings, { section: section });
      html += window.DreaMintHome.marketBoard([], { section: section });
    }
    if (!listings.length) {
      // Empty state: no demo/placeholder cards (demo cards live only in the home hero).
      var emptyMsg = raw ? tr("market.emptyRaw")
        : (tierFilter && tierInfo(tierFilter)) ? tr("market.emptyTier", { tier: tierInfo(tierFilter).label })
        : tr("market.emptyGraded");
      var sellHref = raw ? "#/registra/non-gradate" : "#/registra/gradate";
      if (window.DreaMintHome && window.DreaMintHome.emptyState) return html + window.DreaMintHome.emptyState("", emptyMsg, sellHref, tr("es.cta"));
      return html + '<p class="empty">' + emptyMsg + ' <a href="' + sellHref + '" data-link>' + tr("es.cta") + "</a></p>";
    }
    if (raw) {
      html += '<div class="trade-grid">' + listings.map(function (l) {
        return '<a class="trade-card" href="#/annuncio/' + l.id + "/" + l.slab_id + '" data-link>' +
          '<div class="trade-thumb">' + photoImg(l.slab_id, "front", "(max-width:600px) 46vw, 180px") + "</div>" +
          "<div><h3>" + esc(cardTitle(l)) + (l.is_test ? ' <span class="pill pill-test">TEST</span>' : "") + "</h3>" +
          '<div class="muted">' + esc(l.code_printed) + " · " + esc([l.card_condition, languageName(l.language), variantLabel(l.variant)].filter(Boolean).join(" · ")) + "</div>" +
          '<div class="price">' + euros(l.price_cents) + "</div>" + priceTrendSlot(l, true) +
          '<div class="muted">' + tr("market.seller", { name: esc(l.seller_name) }) + "</div></div></a>";
      }).join("") + "</div>";
    } else {
      html += '<div class="slab-gallery">' + listings.map(function (l) {
        return '<a class="slab-tile" href="#/annuncio/' + l.id + "/" + l.slab_id + '" data-link>' +
          slabFrame({
            img: digitalArt(l).img,
            srcset: digitalArt(l).srcset,
            grader: l.grader || "DreaMint",
            grade: l.grade || "—",
            serial: l.serial_number ? serialFmt(l.serial_number, l.serial_total) : "",
            cert: l.certificate_no ? (l.grader + " " + l.certificate_no) : "",
            tier: l.rarity_tier || "",
            tierLabel: l.rarity_label || ""
          }) +
          '<div class="tile-meta"><strong>' + esc(cardTitle(l)) + "</strong>" +
          (l.is_test ? '<span class="pill pill-test">TEST</span>' : "") +
          (window.DreaMintTradeV9 && window.DreaMintTradeV9.on() ? window.DreaMintTradeV9.offerBadgeHtml(l) : "") +
          (l.rarity_tier ? rarityPillsHtml(l.rarity_tier) : "") +
          '<span class="price">' + euros(l.price_cents) + "</span>" + priceTrendSlot(l, true) +
          (window.DreaMintTradeV9 && window.DreaMintTradeV9.on() ? window.DreaMintTradeV9.physicalSplitNoteHtml(l) : "") +
          "</div></a>";
      }).join("") + "</div>";
    }
    return html;
  }


  function shippingConfig() {
    return state.cfg.shipping || { insurance_cents: 300, insurance_cover_cents: 300000, methods: [] };
  }
  function salePayable(s) {
    if (!s) return 0;
    if (s.total_cents) return Number(s.total_cents);
    return (Number(s.price_cents) || 0) + (Number(s.shipping_cents) || 0) + (Number(s.insurance_cents) || 0);
  }
  function saleBreakdown(s) {
    var parts = [euros(s.price_cents) + " " + tr("sale.card")];
    if (s.shipping_cents) parts.push(euros(s.shipping_cents) + " " + tr("sale.shipping"));
    if (s.insurance_cents) parts.push(euros(s.insurance_cents) + " " + tr("sale.insurance"));
    var line = parts.join(" + ");
    if (parts.length > 1) line += " = " + euros(salePayable(s));
    return line;
  }
  function isOpenBuyerSale(sale) {
    return sale && ["requested", "accepted", "paid", "shipped"].indexOf(sale.status) >= 0;
  }
  function listingBuyCta(listing, slab, merged, mySale) {
    var isSeller = state.user && (state.user.id === listing.seller_id || listing.mine);
    if (!state.user || isSeller) {
      return '<p class="dim">' + tr("buy.needOther") + "</p>";
    }
    var digitalOnly = window.DreaMintTradeV9 && window.DreaMintTradeV9.isDigitalListing && window.DreaMintTradeV9.isDigitalListing(listing);
    if (digitalOnly) {
      if (mySale && isOpenBuyerSale(mySale)) {
        return '<p class="notice">' + tr("buy.sent", { link: '<a href="#/vendite" data-link>' + tr("buy.gotoSales") + "</a>" }) + "</p>";
      }
      return '<form id="buy-form" class="buy-form" data-digital="1">' +
        '<p class="notice">' + tr("buy.noticeDigital") + "</p>" +
        '<p class="error" id="form-err" hidden></p><button class="btn primary" type="submit">' + tr("buy.submit") + "</button></form>";
    }
    if (mySale && isOpenBuyerSale(mySale)) {
      return '<p class="notice">' + tr("buy.sent", { link: '<a href="#/vendite" data-link>' + tr("buy.gotoSales") + "</a>" }) + "</p>";
    }
    var ship = shippingConfig();
    var methods = (ship.methods || []).map(localizeShip);
    var methodHtml = methods.map(function (m, i) {
      return '<label class="ship-option"><input type="radio" name="shipping_method" value="' + esc(m.id) + '"' + (i === 0 ? " required" : "") + '>' +
        "<span><strong>" + esc(m.label) + "</strong><span class=\"ship-price\">" + euros(m.price_cents) + "</span>" +
        (m.finderUrl ? '<a class="ship-find" href="' + esc(m.finderUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(m.finderLabel || tr("buy.pointDefault")) + "</a>" : "") +
        "</span></label>";
    }).join("");
    return '<form id="buy-form" class="buy-form">' +
      '<fieldset class="ship-box"><legend>' + tr("buy.shipLegend") + "</legend>" +
      '<p class="dim">' + tr("buy.shipHint") + "</p>" + italyShipNote() +
      '<div class="ship-methods">' + methodHtml + "</div>" +
      '<label class="ship-insure" id="ship-insure" hidden><input type="checkbox" name="insurance" value="1"> ' + tr("buy.insurance", { price: euros(ship.insurance_cents || 300) }) + "</label>" +
      '<div id="ship-dest" class="ship-dest">' +
      '<label class="field">' + tr("buy.destName") + '<input name="ship_name" required autocomplete="name"></label>' +
      '<label class="field">' + tr("buy.destPhone") + '<input name="ship_phone" type="tel" required autocomplete="tel" placeholder="' + esc(tr("buy.phonePh")) + '"></label>' +
      '<label class="field ship-point" id="ship-point-field"><span id="ship-point-label">' + tr("buy.pointDefault") + '</span><input name="ship_point_code" autocomplete="off"></label>' +
      '<div class="ship-address" id="ship-address-fields" hidden>' +
      '<label class="field">' + tr("buy.address") + '<input name="ship_address" autocomplete="street-address"></label>' +
      '<div class="grid-2"><label class="field">' + tr("buy.zip") + '<input name="ship_zip" inputmode="numeric" maxlength="5" autocomplete="postal-code"></label>' +
      '<label class="field">' + tr("buy.city") + '<input name="ship_city" autocomplete="address-level2"></label></div>' +
      '<label class="field">' + tr("buy.province") + '<input name="ship_province" maxlength="2" autocomplete="address-level1" placeholder="' + esc(tr("buy.provincePh")) + '"></label>' +
      "</div></div>" +
      '<p class="ship-total" id="ship-total"></p></fieldset>' +
      '<label class="field">' + tr("buy.message") + '<textarea name="message" placeholder="' + esc(tr("buy.messagePh")) + '"></textarea></label>' +
      '<label class="field">' + tr("buy.contact") + '<input name="contact" required></label>' +
      '<p class="notice">' + (merged.is_ungraded ? tr("buy.noticeRaw") : tr("buy.noticeGraded")) + "</p>" +
      '<p class="error" id="form-err" hidden></p><button class="btn primary" type="submit">' + tr("buy.submit") + "</button></form>";
  }
  function bindBuyShipping(form, listing) {
    if (!form) return;
    if (form.getAttribute("data-digital") === "1") {
      form.onsubmit = function (e) {
        e.preventDefault();
        api("listings/" + listing.id + "/request", { body: {} })
          .then(function () { go("#/vendite"); })
          .catch(function (err) {
            var el = document.getElementById("form-err");
            if (el) { el.hidden = false; el.textContent = err.message; }
            else alert(err.message);
          });
      };
      return;
    }
    var ship = shippingConfig();
    function methodOf() {
      var el = form.querySelector('input[name="shipping_method"]:checked');
      if (!el) return null;
      return (ship.methods || []).map(localizeShip).find(function (m) { return m.id === el.value; }) || null;
    }
    function refresh() {
      var m = methodOf();
      var insureBox = document.getElementById("ship-insure");
      var pointField = document.getElementById("ship-point-field");
      var addrFields = document.getElementById("ship-address-fields");
      var pointInput = form.querySelector('input[name="ship_point_code"]');
      var addrInputs = form.querySelectorAll("#ship-address-fields input");
      var canInsure = !!(m && m.insuranceAllowed);
      if (insureBox) insureBox.hidden = !canInsure;
      if (!canInsure) {
        var chk = form.querySelector('input[name="insurance"]');
        if (chk) chk.checked = false;
      }
      var isPoint = !!(m && (m.destType === "locker" || m.destType === "punto_poste"));
      var isAddr = !!(m && m.destType === "address");
      if (pointField) {
        pointField.hidden = !isPoint;
        var lab = document.getElementById("ship-point-label");
        if (lab && m && m.pointLabel) lab.textContent = m.pointLabel;
        if (pointInput) pointInput.required = isPoint;
      }
      if (addrFields) addrFields.hidden = !isAddr;
      addrInputs.forEach(function (inp) { inp.required = isAddr; });
      var totalEl = document.getElementById("ship-total");
      if (totalEl) {
        var price = Number(listing.price_cents) || 0;
        var shipC = m ? Number(m.price_cents) || 0 : 0;
        var insC = (canInsure && form.querySelector('input[name="insurance"]') && form.querySelector('input[name="insurance"]').checked) ? (ship.insurance_cents || 300) : 0;
        var bits = [tr("buy.cardBit", { price: euros(price) })];
        if (m) bits.push(tr("buy.shipBit", { price: euros(shipC) }));
        if (insC) bits.push(tr("buy.insBit", { price: euros(insC) }));
        totalEl.innerHTML = m
          ? "<strong>" + tr("buy.total", { total: euros(price + shipC + insC) }) + "</strong><span> " + bits.join(" + ") + "</span>"
          : tr("buy.chooseMethod");
      }
    }
    form.addEventListener("change", refresh);
    refresh();
    form.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var method = String(fd.get("shipping_method") || "");
      if (!method) { showErr(tr("buy.needMethod")); return; }
      var m = (ship.methods || []).find(function (x) { return x.id === method; });
      var dest = { name: fd.get("ship_name"), phone: fd.get("ship_phone") };
      if (m && (m.destType === "locker" || m.destType === "punto_poste")) dest.point_code = fd.get("ship_point_code");
      if (m && m.destType === "address") {
        dest.address = fd.get("ship_address");
        dest.city = fd.get("ship_city");
        dest.zip = fd.get("ship_zip");
        dest.province = fd.get("ship_province");
      }
      api("listings/" + listing.id + "/request", {
        body: {
          message: fd.get("message"),
          contact: fd.get("contact"),
          shipping_method: method,
          insurance: fd.get("insurance") ? 1 : 0,
          shipping_dest: dest
        }
      }).then(function () { go("#/vendite"); }).catch(function (err) { showErr(err.message); });
    };
  }
  function pageListing(listing, slab, mySale) {
    var merged = {
      game: listing.game || slab.model.game,
      language: listing.language || slab.model.language,
      set_name: listing.set_name || slab.model.set_name,
      card_name: listing.card_name || slab.model.name,
      grader: listing.grader || slab.grader,
      grade: listing.grade || slab.grade,
      is_ungraded: listing.is_ungraded || slab.is_ungraded,
      card_condition: listing.card_condition || slab.card_condition,
      model: slab.model
    };
    var serial = slab.serial_number ? serialFmt(slab.serial_number, slab.serial_total) : "";
    return '<section class="product-page">' +
      photoGallery(slab.id, slab.photos, slab.is_ungraded ? tr("card.photosTitle") : tr("card.photosProof")) +
      '<section class="panel product-info"><h1>' + esc(cardTitle(merged)) + "</h1>" +
      ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on())
        ? ('<p class="dm-offer-line">' + window.DreaMintTradeV9.offerBadgeHtml(listing, slab) + "</p>" +
           window.DreaMintTradeV9.physicalSplitNoteHtml(listing, slab))
        : "") +
      (slab.is_ungraded ? "" : '<div class="slab-stage product-digital">' + slabFrame({
        img: digitalArt(slab).img,
        srcset: digitalArt(slab).srcset,
        grader: slab.grader || "DreaMint",
        grade: slab.grade || "—",
        cert: slab.certificate_no ? (slab.grader + " " + slab.certificate_no) : "",
        serial: serial,
        tier: slab.rarity_tier || "",
        tierLabel: slab.rarity_label || ""
      }) + '<p class="dim">' + (catalogArt(slab) ? tr("list.digitalCatalog") : tr("list.digitalPhoto")) + "</p>" +
      rarityCalloutHtml(slab.rarity_tier) +
      (slab.rarity_tier ? '<p class="row-actions"><button type="button" class="btn ghost" id="share-rarity">' + tr("card.share") + "</button></p>" : "") +
      "</div>") +
      '<p class="price">' + euros(listing.price_cents) + "</p>" +
      priceTrendSlot({ slab_id: slab.id }, false) +
      ((listing.cardmarket_avg_cents || slab.cardmarket_avg_cents)
        ? '<p class="ref-price">' + esc(cardmarketLabel(listing.cardmarket_avg_cents || slab.cardmarket_avg_cents, true)) + "</p>"
        : "") +
      "<p class=\"muted\">" + (merged.is_ungraded
        ? tr("list.rawMeta", { cond: merged.card_condition ? " · " + conditionLabel(merged.card_condition) : "" })
        : tr("list.gradedMeta")) +
      tr("list.shipMeta") + "</p>" + italyShipNote() +
      (listing.is_test || slab.is_test ? '<p><span class="pill gold">TEST</span></p>' : "") +
      "<p>" + tr("list.seller", { name: esc(listing.seller_name || listing.seller_username || "") }) + "</p>" +
      ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on())
        ? window.DreaMintTradeV9.dealNoticeHtml() + window.DreaMintTradeV9.contactSellerHtml(listing)
        : "") +
      listingBuyCta(listing, slab, merged, mySale) +
      shareRowHtml(slab, listing) +
      "</section></section>";
  }

  function saleStatusLabel(s) {
    if (s && typeof s === "object") {
      if (s.status === "paid" && s.kind === "digital") return trx("sale.paidDigital", trx("sale.paid", "Venduta"));
      return trx("sale." + s.status, s.status);
    }
    return trx("sale." + s, s);
  }
  // v27: recensioni (voto 1-5 + commento) tra venditore e acquirente
  function starsHtml(n) {
    var s = "";
    for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
    return '<span class="stars" aria-label="' + n + '/5">' + s + "</span>";
  }
  function saleReviewHtml(s) {
    var r = s.review;
    if (s.status !== "completed" || !r) return "";
    if (r.mine) {
      return '<div class="review-mine"><b>' + esc(tr("rev.mine")) + "</b> " + starsHtml(r.mine.rating) +
        (r.mine.comment ? '<p class="muted">' + esc(r.mine.comment) + "</p>" : "") + '<p class="dim">' + esc(tr("rev.visibility")) + "</p></div>";
    }
    if (!r.can_review) return "";
    var opts = "";
    for (var i = 5; i >= 1; i--) opts += '<label class="star-opt"><input type="radio" name="rating" value="' + i + '" required><span>' + i + " ★</span></label>";
    return '<form class="review-form" data-sale="' + esc(s.id) + '" novalidate><b>' + esc(tr("rev.leave")) + '</b><div class="star-pick">' + opts + "</div>" +
      '<label class="field">' + esc(tr("rev.comment")) + '<textarea name="comment" maxlength="500" rows="3"></textarea></label>' +
      '<p class="dim">' + esc(tr("rev.hint")) + '</p><p class="error" hidden></p><button class="btn primary" type="submit">' + esc(tr("rev.send")) + "</button></form>";
  }
  function bindReviewForms(root) {
    root.querySelectorAll(".review-form").forEach(function (f) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var err = f.querySelector(".error"), btn = f.querySelector("button[type=submit]");
        err.hidden = true;
        var fd = new FormData(f), rating = fd.get("rating");
        if (!rating) { err.hidden = false; err.textContent = tr("rev.rateRequired"); return; }
        btn.disabled = true;
        api("sales/" + f.getAttribute("data-sale") + "/review", { method: "POST", body: { rating: Number(rating), comment: String(fd.get("comment") || "") } })
          .then(function () { render(); })
          .catch(function (e2) { btn.disabled = false; err.hidden = false; err.textContent = (e2 && e2.message) || tr("rev.rateRequired"); });
      });
    });
  }
  function reviewsPanelHtml(d, own) {
    var sm = d.summary || { count: 0 };
    var head;
    if (!sm.count) head = '<p class="muted">' + esc(tr("rev.none")) + "</p>";
    else {
      var fmt = function (x) { return String(x).replace(".", ","); };
      head = '<p class="review-summary">' + starsHtml(Math.round(sm.avg)) + " " + esc(tr("rev.avg", { avg: fmt(sm.avg), n: sm.count })) + "</p>" +
        '<p class="dim">' + [
          sm.as_seller && sm.as_seller.count ? tr("rev.asSeller", { avg: fmt(sm.as_seller.avg), n: sm.as_seller.count }) : "",
          sm.as_buyer && sm.as_buyer.count ? tr("rev.asBuyer", { avg: fmt(sm.as_buyer.avg), n: sm.as_buyer.count }) : ""
        ].filter(Boolean).map(esc).join(" · ") + "</p>";
    }
    var items = (d.reviews || []).map(function (r) {
      var role = r.reviewee_role === "seller" ? tr("rev.roleSeller") : tr("rev.roleBuyer");
      return '<div class="review-item"><div>' + starsHtml(r.rating) + ' <span class="dim">' + esc(role) + " · @" + esc(r.reviewer_username) + " · " + esc(String(r.created_at || "").slice(0, 10)) + "</span></div>" +
        (r.comment ? '<p class="review-text">' + esc(r.comment) + "</p>" : "") +
        (d.can_moderate ? '<button class="btn ghost danger" type="button" data-review-hide="' + esc(r.id) + '">' + esc(tr("rev.hide")) + "</button>" : "") + "</div>";
    }).join("");
    return '<section class="panel reviews"><h2>' + esc(own ? tr("rev.mineTitle") : tr("rev.title")) + "</h2>" + head + items + "</section>";
  }
  function loadReviewsInto(username, box, own) {
    api("users/" + encodeURIComponent(username) + "/reviews").then(function (d) {
      box.innerHTML = reviewsPanelHtml(d, own);
      box.querySelectorAll("[data-review-hide]").forEach(function (b) {
        b.onclick = function () {
          if (!window.confirm(tr("rev.hideConfirm"))) return;
          api("admin/reviews/" + b.getAttribute("data-review-hide"), { method: "DELETE" })
            .then(function () { loadReviewsInto(username, box, own); })
            .catch(function (err) { alert(err.message); });
        };
      });
    }).catch(function () { box.innerHTML = ""; });
  }

  function pageSales(sales) {
    if (!sales.length) return '<section class="panel"><h2>' + tr("sales.title") + '</h2><p class="muted">' + tr("sales.empty") + "</p></section>";
    var mode = (state.cfg.paypal && state.cfg.paypal.mode) || "wps";
    return "<h2>" + tr("sales.title") + "</h2><div class=\"list\">" + sales.map(function (s) {
      var isSeller = state.user && state.user.id === s.seller_id;
      var isBuyer = state.user && state.user.id === s.buyer_id;
      var role = isSeller ? tr("sales.sale") : tr("sales.purchase");
      var unpaid = s.status === "requested" || s.status === "accepted";
      var actions = "";
      if (isSeller && s.status === "requested") {
        actions += '<button class="btn" data-act="accept" data-id="' + s.id + '">' + tr("sales.accept") + "</button> ";
      }
      if (isSeller && unpaid) {
        actions += '<button class="btn" data-act="mark-paid" data-id="' + s.id + '">' + tr("sales.markPaid") + "</button> ";
      }
      if (s.status === "accepted") {
        actions += '<p class="dim">' + tr("sales.waitPay") + "</p>";
      }
      if (isBuyer && unpaid && s.paypal_checkout_url && mode !== "manual") {
        actions += '<a class="btn primary" href="' + s.paypal_checkout_url + '" rel="noopener noreferrer">' + tr("sales.payPaypal", { amount: euros(salePayable(s)) }) + "</a> ";
      }
      if (isBuyer && unpaid && s.seller_paypal_email) {
        actions += '<p class="notice">' + tr("sales.payNotice", { amount: "<b>" + euros(salePayable(s)) + "</b>", email: "<b>" + esc(s.seller_paypal_email) + "</b>", breakdown: esc(saleBreakdown(s)) }) + "</p>";
        actions += '<p class="dim">' + tr("sales.paypalHint") + "</p>";
      }
      if (unpaid && !s.seller_paypal_email) {
        actions += isSeller ? paypalNeededHtml() : sellerNoPaypalNote();
      }
      if (isSeller && s.status === "paid" && s.kind === "digital") {
        actions += '<p class="notice">' + tr("sales.paidHintDigital") + "</p>";
      } else if (isSeller && s.status === "paid") {
        actions += '<div class="ship-instructions"><p class="notice">' + tr("sales.paidHint") + "</p>";
        if (s.shipping_dest_text) {
          actions += '<pre class="ship-dest-copy" id="dest-' + s.id + '">' + esc(s.shipping_dest_text) + "</pre>" +
            '<button type="button" class="btn ghost" data-copy-dest="dest-' + s.id + '">' + tr("sales.copyDest") + "</button> ";
        }
        if (s.label_url) {
          actions += '<a class="btn" href="' + esc(s.label_url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label_label || tr("sales.makeLabel")) + "</a>";
        }
        actions += '<form class="track-form" data-sale="' + s.id + '"><label class="field">' + tr("sales.tracking") + '<input name="tracking" required minlength="5" placeholder="' + esc(tr("sales.trackingPh")) + '"></label>' +
          '<button class="btn primary" type="submit">' + tr("sales.recordTrack") + "</button></form></div>";
      }
      if (s.tracking) {
        actions += "<p>" + tr("sales.trackLine", { code: "<b>" + esc(s.tracking) + "</b>" }) +
          (s.tracking_url ? ' — <a href="' + esc(s.tracking_url) + '" target="_blank" rel="noopener noreferrer">' + tr("sales.trackLink") + "</a>" : "") + "</p>";
      }
      if (isBuyer && s.status === "shipped") {
        actions += '<button class="btn primary" data-act="receive" data-id="' + s.id + '">' + tr("sales.received") + "</button> ";
        actions += '<p class="dim">' + tr("sales.autoComplete", { days: ((state.cfg.paypal && state.cfg.paypal.autoCompleteDays) || 14) }) + "</p>";
      }
      actions += saleReviewHtml(s);
      return '<div class="list-item"><div></div><div><b>' + esc(s.card_name) + "</b><div class=\"dim\">" + role + " · " + esc(saleStatusLabel(s)) + " · " + saleBreakdown(s) + "</div>" +
        (s.shipping_label ? "<div class=\"dim\">" + tr("sales.shipLine", { label: esc(s.shipping_label) }) + (s.insurance ? " · " + tr("sales.insured") : "") + "</div>" : "") +
        "<div class=\"dim\">" + tr("sales.fromTo", { seller: esc(s.seller_name), buyer: esc(s.buyer_name) }) + (s.contact ? " · " + tr("sales.contact", { contact: esc(s.contact) }) : "") + "</div>" +
        (s.message ? "<p class=\"muted\">" + esc(s.message) + "</p>" : "") +
        '<div class="sale-actions" style="margin-top:8px">' + actions + "</div></div></div>";
    }).join("") + "</div>";
  }

  function pageAdmin(items) {
    return '<section class="panel al-jump"><h2>' + esc(trx("al.manage", "Gestisci commissioni e piani")) + "</h2>" +
      "<p>" + esc(trx("al.manageP", "Apri il pannello per cambiare lo stato di lancio. Ogni passaggio richiede una conferma esplicita e resta registrato.")) + "</p>" +
      '<p class="row-actions"><a class="btn primary" href="#/admin/lancio" data-link>' + esc(trx("al.manage", "Gestisci commissioni e piani")) + "</a></p></section>" +
      '<p class="row-actions"><a class="btn ghost" href="#/admin/assistenza" data-link>' + esc(tr("support.adminTitle")) + '</a><a class="btn ghost" href="#/admin/vendite" data-link>Vendite e spedizioni</a><a class="btn ghost" href="#/admin/partner" data-link>Partner</a><a class="btn ghost" href="#/admin/lancio" data-link>' + esc(trx("al.manage", "Gestisci commissioni e piani")) + "</a>" +
      (window.DreaMintCert ? window.DreaMintCert.adminNavLink() : '<a class="btn ghost" href="#/admin/riscatti" data-link>Riscatti</a>') +
      "</p>" +
      '<section class="panel"><h2>Crea una carta TEST (solo admin)</h2>' +
      '<p class="muted">Assegna a un utente già registrato una carta gradata fittizia, con badge TEST, per provare l’estrazione. Non incrementa i seriali dei modelli veri: usa il catalogo «Laboratorio TEST».</p>' +
      '<form id="test-card-form" class="grid-2"><label class="field">Email dell’utente<input name="email" type="email" required placeholder="es. il tuo account personale"></label>' +
      '<div style="align-self:end"><button class="btn primary" type="submit">Crea carta TEST</button></div></form>' +
      '<p class="error" id="test-err" hidden></p><p class="ok" id="test-ok" hidden></p></section>' +
      '<section class="panel"><h2>' + esc(tr("admin.removeAnyTitle")) + '</h2><p class="muted">' + esc(tr("admin.removeAnyNote")) + "</p>" +
      '<form id="admin-remove-form" class="grid-2"><label class="field">' + esc(tr("admin.removeAnyField")) + '<input name="card" required placeholder="https://dreamint.it/#/carta/…"></label>' +
      '<div style="align-self:end"><button class="btn danger" type="submit">' + esc(tr("admin.removeCard")) + "</button></div></form>" +
      '<p class="error" id="admin-remove-err" hidden></p><p class="ok" id="admin-remove-ok" hidden></p></section>' +
      "<h2>Coda di verifica" + (items.length ? " (" + items.length + ")" : "") + "</h2>" + (items.length ? '<div class="list">' + items.map(function (it) {
      return '<a class="list-item" href="#/admin/carta/' + it.id + '" data-link><img src="/api/cards/' + it.id + '/photo/front" alt="">' +
        "<div><b>" + esc(it.card_name) + "</b>" + (it.missing_back ? ' <span class="pill warn">Retro mancante</span>' : "") + "<div class=\"dim\">" + esc(it.code_printed) + " · " + esc(it.language) + " · " + (it.is_ungraded ? "Non gradata" + (it.card_condition ? " · " + it.card_condition : "") : esc(it.grader + " " + (it.certificate_no || ""))) + (it.asking_price_cents ? " · " + euros(it.asking_price_cents) : "") + "</div>" +
        "<div class=\"dim\">" + esc(it.display_name) + " · " + esc(it.email) + "</div></div></a>";
    }).join("") + "</div>" : '<section class="panel"><p class="muted">Nessuna carta in verifica.</p></section>');
  }

  function pageAdminSales(sales) {
    var head = '<div class="page-head"><div><h1>Vendite e spedizioni</h1><p>Metodo, tracking e stato di ogni vendita.</p></div>' +
      '<a class="btn ghost" href="#/admin/partner" data-link>Partner</a>' +
      '<a class="btn ghost" href="#/admin" data-link>Torna alla verifica</a></div>';
    if (!sales.length) return head + '<section class="panel"><p class="muted">Nessuna vendita.</p></section>';
    return head + '<div class="list">' + sales.map(function (s) {
      return '<div class="list-item"><div></div><div><b>' + esc(s.card_name) + "</b>" +
        "<div class=\"dim\">" + esc(saleStatusLabel(s)) + " · " + saleBreakdown(s) + "</div>" +
        "<div class=\"dim\">" + esc(s.seller_name) + " → " + esc(s.buyer_name) + "</div>" +
        (s.shipping_label ? "<div class=\"dim\">Spedizione: " + esc(s.shipping_label) + (s.insurance ? " · assicurata" : "") + "</div>" : "") +
        (s.shipping_dest_text ? "<pre class=\"ship-dest-copy\">" + esc(s.shipping_dest_text) + "</pre>" : "") +
        (s.tracking ? "<p>Tracking: <b>" + esc(s.tracking) + "</b>" + (s.tracking_url ? ' — <a href="' + esc(s.tracking_url) + '" target="_blank" rel="noopener noreferrer">traccia</a>' : "") + "</p>" : "<p class=\"dim\">Nessun tracking ancora.</p>") +
        "</div></div>";
    }).join("") + "</div>";
  }

  function pageAdminPartners(partners) {
    var head = '<div class="page-head"><div><h1>Partner</h1><p>Codici referral per negozi, scuole e pagine TCG. In beta conteggiamo iscritti e vendite, senza pagamenti.</p></div>' +
      '<div class="row-actions"><a class="btn ghost" href="#/admin" data-link>Verifica</a><a class="btn ghost" href="#/admin/vendite" data-link>Vendite</a></div></div>';
    var form = '<section class="panel" id="partner-create"><h2>Nuovo codice</h2>' +
      '<form id="partner-form">' +
      '<label class="field">Nome del partner<input name="name" required maxlength="80" placeholder="es. Gengar Shop"></label>' +
      '<label class="field">Codice (3–20 lettere o numeri)<input name="code" required maxlength="20" placeholder="es. GENGARSHOP" autocapitalize="characters"></label>' +
      '<label class="field">Nota di contatto (facoltativa)<input name="contact_note" maxlength="200" placeholder="riferimento interno, non è pubblico"></label>' +
      '<p class="error" id="partner-err" hidden></p><p class="ok" id="partner-ok" hidden></p>' +
      '<button class="btn primary" type="submit">Crea codice</button></form></section>';
    var list;
    if (!partners.length) {
      list = '<section class="panel"><p class="muted">Nessun partner ancora. Quando crei un codice, compare qui il link da condividere.</p></section>';
    } else {
      list = partners.map(function (p) {
        return '<section class="panel partner-card">' +
          '<div class="partner-card-head"><h2>' + esc(p.name) + '</h2><span class="pill gold">' + esc(p.code) + "</span></div>" +
          (p.contact_note ? '<p class="dim">' + esc(p.contact_note) + "</p>" : "") +
          '<div class="partner-stats">' +
          '<div><span>Iscritti</span><b>' + p.signup_count + "</b></div>" +
          '<div><span>Vendite completate</span><b>' + p.sales_count + "</b></div>" +
          '<div><span>Volume</span><b>' + euros(p.volume_cents) + "</b></div>" +
          '<div><span>Quota potenziale (1% del volume)</span><b>' + euros(p.quota_cents) + "</b></div>" +
          "</div>" +
          '<p class="notice">Nessun pagamento durante la beta. La quota è solo informativa.</p>' +
          '<label class="field">Link da condividere<input readonly value="' + esc(p.share_url) + '"></label>' +
          '<p class="row-actions"><button type="button" class="btn" data-copy="' + esc(p.share_url) + '">Copia link</button></p>' +
          '<label class="field">Pagina statistiche (solo per il partner)<input readonly value="' + esc(p.stats_url) + '"></label>' +
          '<p class="row-actions"><button type="button" class="btn ghost" data-copy="' + esc(p.stats_url) + '">Copia pagina stats</button></p>' +
          "</section>";
      }).join("");
    }
    return head + form + list;
  }

  function pagePartnerPublic(p) {
    if (!p) return '<section class="panel"><h2>' + tr("partner.invalid") + '</h2><p class="muted">' + tr("partner.missing") + "</p></section>";
    return '<div class="page-head"><div><h1>' + esc(p.name) + "</h1><p>" + tr("partner.statsOf", { code: "<b>" + esc(p.code) + "</b>" }) + "</p></div></div>" +
      '<section class="panel">' +
      '<div class="partner-stats">' +
      "<div><span>" + tr("partner.signups") + "</span><b>" + p.signup_count + "</b></div>" +
      "<div><span>" + tr("partner.sales") + "</span><b>" + p.sales_count + "</b></div>" +
      "<div><span>" + tr("partner.volume") + "</span><b>" + euros(p.volume_cents) + "</b></div>" +
      "<div><span>" + tr("partner.quota") + "</span><b>" + euros(p.quota_cents) + "</b></div>" +
      "</div>" +
      '<p class="notice">' + tr("partner.beta") + "</p>" +
      "</section>";
  }

  function pageAdminCard(c) {
    function ph(kind, label) {
      if (kind === "back" && c.missing_back) {
        return '<div class="panel"><h3>Retro</h3><p class="notice">Retro mancante — puoi chiedere al venditore la foto del retro prima di pubblicare.</p></div>';
      }
      return '<div class="panel"><h3>' + label + '</h3><img src="/api/cards/' + c.id + "/photo/" + kind + '" alt="' + label + '" style="max-width:100%;border-radius:12px" onerror="this.parentNode.style.display=\'none\'"></div>';
    }
    return "<h2>Verifica</h2>" +
      (c.missing_back ? '<p class="notice">Retro mancante</p>' : "") +
      ph("front", "Fronte") + ph("back", "Retro") + (c.challenge_video ? '<div class="panel"><h3>Video-sfida (codice ' + esc(c.challenge_code || "") + ')</h3><video controls playsinline preload="metadata" src="/api/cards/' + encodeURIComponent(c.id) + '/challenge-video" style="max-width:100%;border-radius:12px"></video></div>' : (c.photos && c.photos.challenge ? ph("challenge", "Foto-sfida (codice " + esc(c.challenge_code || "") + ")") : (c.is_ungraded ? "" : '<p class="notice">Video-sfida mancante</p>'))) + ph("cert", "Certificato") +
      '<section class="panel"><p><b>' + esc(c.model.name) + "</b> · " + esc(c.model.set_name) + " · " + esc(c.model.code_printed) + " · " + esc(c.model.language) + " · " + esc(c.model.variant) + "</p>" +
      "<p>" + (c.is_ungraded ? ("Non gradata" + (c.card_condition ? " · " + esc(conditionLabel(c.card_condition)) : "") + " — la pubblicazione non assegna rarità né seriale") : esc(graderLabel(c.grader)) + " " + esc(c.certificate_no || "") + (c.grade ? " voto " + esc(c.grade) : "")) + "</p>" +
      (c.asking_price_cents ? "<p>Prezzo di vendita chiesto: <b>" + euros(c.asking_price_cents) + "</b></p>" : '<p class="notice">Nessun prezzo di vendita impostato.</p>') +
      (c.cardmarket_avg_cents ? '<p class="ref-price">' + esc(cardmarketLabel(c.cardmarket_avg_cents, true)) + "</p>" : "") +
      '<div class="row"><button class="btn primary" id="approve">' + (c.is_ungraded ? "Pubblica l’annuncio" : "Approva e assegna rarità") + "</button></div>" +
      '<label class="field">Motivo del rifiuto (obbligatorio per rifiutare)<input id="rej-reason"></label>' +
      '<button class="btn danger" id="reject">Rifiuta</button><p class="error" id="form-err" hidden></p></section>' +
      '<section class="panel"><h3>' + esc(tr("admin.removeAnyTitle")) + '</h3><p class="muted">' + esc(tr("admin.albumToolsNote")) + "</p>" +
      '<button class="btn danger" id="admin-remove-card" type="button">' + esc(tr("admin.removeCard")) + '</button><p class="error" id="admin-remove-err" hidden></p></section>';
  }
  // v23: shared admin soft removal (explicit confirm, DELETE /api/admin/cards/:id)
  function adminRemoveCardFlow(id, errEl, done) {
    if (!id || !confirm(tr("admin.confirmRemoveCard"))) return Promise.resolve(false);
    if (errEl) errEl.hidden = true;
    return api("admin/cards/" + encodeURIComponent(id), { method: "DELETE" }).then(function (d) {
      dmToast(tr("admin.removedOk"));
      if (done) done(d);
      return true;
    }).catch(function (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = String(e && e.message || ""); } else alert(e && e.message);
      return false;
    });
  }
  function cardIdFromInput(v) {
    v = String(v || "").trim();
    var m = v.match(/(?:carta|cards|c|carta\/admin|admin\/carta)\/([A-Za-z0-9-]{8,64})/) || v.match(/^([A-Za-z0-9-]{8,64})$/);
    return m ? m[1] : "";
  }
  // v23 Assistenza
  function supportCatOptions(sel) {
    return ["technical", "user_report", "payment", "other"].map(function (k) {
      return '<option value="' + k + '"' + (sel === k ? " selected" : "") + ">" + esc(tr("support.cat." + k)) + "</option>";
    }).join("");
  }
  function pageSupport() {
    if (!state.user) {
      return '<section class="panel support-page"><h1>' + esc(tr("support.title")) + "</h1><p>" + esc(tr("support.loginNeeded")) + "</p>" +
        '<p class="row-actions"><a class="btn primary" href="#/accedi" data-link>' + esc(tr("nav.login")) + '</a><a class="btn ghost" href="#/registrati" data-link>' + esc(tr("support.signup")) + "</a></p>" +
        '<p class="dim">' + esc(tr("support.mailAlt")) + ' <a href="mailto:info@dreamint.it">info@dreamint.it</a></p></section>';
    }
    return '<section class="panel support-page"><h1>' + esc(tr("support.title")) + "</h1><p>" + esc(tr("support.lede")) + "</p>" +
      '<form id="support-form" novalidate>' +
      '<label class="field">' + esc(tr("support.subject")) + '<input name="subject" required minlength="3" maxlength="120"></label>' +
      '<label class="field">' + esc(tr("support.category")) + '<select name="category" required><option value="">' + esc(tr("support.catPick")) + "</option>" + supportCatOptions("") + "</select></label>" +
      '<label class="field">' + esc(tr("support.message")) + '<textarea name="message" rows="7" required minlength="10" maxlength="4000"></textarea><span class="dim" id="support-count">0 / 4000</span></label>' +
      '<label class="field">' + esc(tr("support.link")) + '<input name="link" type="url" maxlength="500" placeholder="https://"></label>' +
      '<p class="error" id="support-err" hidden></p><p class="ok" id="support-ok" hidden></p>' +
      '<button class="btn primary" type="submit" id="support-submit">' + esc(tr("support.send")) + "</button></form></section>";
  }
  function bindSupport() {
    var f = document.getElementById("support-form");
    if (!f) return;
    var msg = f.querySelector("textarea[name=message]"), cnt = document.getElementById("support-count");
    if (msg && cnt) msg.addEventListener("input", function () { cnt.textContent = msg.value.length + " / 4000"; });
    var busy = false;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      var fd = new FormData(f), er = document.getElementById("support-err"), ok = document.getElementById("support-ok"), btn = document.getElementById("support-submit");
      var body = { subject: String(fd.get("subject") || "").trim(), category: String(fd.get("category") || ""), message: String(fd.get("message") || "").trim(), link: String(fd.get("link") || "").trim() || undefined };
      er.hidden = true; ok.hidden = true;
      var bad = body.subject.length < 3 || body.subject.length > 120 ? tr("support.errSubject")
        : !body.category ? tr("support.errCategory")
        : body.message.length < 10 || body.message.length > 4000 ? tr("support.errMessage")
        : body.link && !/^https?:\/\//i.test(body.link) ? tr("support.errLink") : "";
      if (bad) { er.hidden = false; er.textContent = bad; return; }
      busy = true; btn.disabled = true; btn.textContent = tr("reg.submitting");
      api("support", { body: body }).then(function () {
        f.reset(); if (cnt) cnt.textContent = "0 / 4000";
        ok.hidden = false; ok.textContent = tr("support.sent");
      }).catch(function (err) {
        er.hidden = false;
        er.textContent = err.status === 429 ? tr("support.rate") : String(err.message || "");
      }).then(function () { busy = false; btn.disabled = false; btn.textContent = tr("support.send"); });
    });
  }
  function pageAdminSupport(d) {
    var st = d.status || "open";
    var tabs = ["open", "closed", "all"].map(function (k) {
      return '<a class="btn ' + (k === st ? "primary" : "ghost") + '" href="#/admin/assistenza/' + k + '" data-link>' + esc(tr("support.st." + k)) +
        (k !== "all" && d.counts ? " (" + (d.counts[k] || 0) + ")" : "") + "</a>";
    }).join("");
    var list = (d.requests || []).map(function (r) {
      var who = (r.username ? "@" + r.username + " · " : "") + (r.display_name || "");
      return '<article class="panel support-item"><p><span class="pill ' + (r.status === "open" ? "warn" : "") + '">' + esc(tr("support.st." + r.status)) + "</span> " +
        '<span class="pill">' + esc(r.category_label || r.category) + "</span> <span class=\"dim\">" + esc(new Date(r.created_at).toLocaleString()) + "</span></p>" +
        "<h3>" + esc(r.subject) + "</h3>" +
        '<p class="dim">' + esc(who) + (r.email ? ' · <a href="mailto:' + esc(r.email) + "?subject=" + encodeURIComponent("Re: " + r.subject) + '">' + esc(r.email) + "</a>" : "") + "</p>" +
        '<p style="white-space:pre-wrap">' + esc(r.message) + "</p>" +
        (r.link ? '<p><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(r.link) + "</a></p>" : "") +
        (r.status === "closed" && r.closed_at ? '<p class="dim">' + esc(tr("support.closedBy", { name: r.closed_by_name || "admin", date: new Date(r.closed_at).toLocaleString() })) + "</p>" : "") +
        '<p class="row-actions"><button type="button" class="btn ' + (r.status === "open" ? "primary" : "ghost") + '" data-support-id="' + esc(r.id) + '" data-support-to="' + (r.status === "open" ? "closed" : "open") + '">' +
        esc(tr(r.status === "open" ? "support.close" : "support.reopen")) + "</button></p></article>";
    }).join("");
    return '<section class="panel"><h1>' + esc(tr("support.adminTitle")) + '</h1><p class="row-actions">' + tabs + "</p></section>" +
      '<p class="error" id="support-admin-err" hidden></p>' +
      (list || '<section class="panel"><p class="muted">' + esc(tr("support.none")) + "</p></section>");
  }

  var photos = { front: null, back: null, challenge: null, cert: null };
  var photoWork = { front: null, back: null, challenge: null, cert: null };
  var challengeCode = "", challengeId = "", challengeVideoOk = false;

  var exportTimers = {};
  function updateRatioButtons(kind) {
    var work = photoWork[kind];
    var name = work && work.cropper ? work.cropper.getRatioName() : (work && work.ratioName);
    document.querySelectorAll('[data-ratio][data-for="' + kind + '"]').forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-ratio") === name);
    });
    if (work && work.cropper) {
      var z = document.querySelector('input[data-zoom][data-for="' + kind + '"]');
      if (z) z.value = String(Math.round((work.cropper.getZoom() || 1) * 100));
    }
  }
  function exportWork(kind) {
    var work = photoWork[kind];
    if (!work || !(work.img || work.file) || !work.cropper) return Promise.resolve();
    var crop = work.cropper.getCrop();
    return window.GemintPhotos.process(work.img || work.file, {
      rotate90: work.rotate90 || 0,
      angle: work.angle || 0,
      autoCrop: false,
      crop: crop,
      straighten: false
    }).then(function (out) {
      photos[kind] = { original: out.original, variants: out.variants };
      work.warnings = out.warnings || [];
      var warn = document.getElementById("warn-" + kind);
      if (warn) {
        warn.hidden = !work.warnings.length;
        warn.textContent = work.warnings.join(" ");
      }
      updateRatioButtons(kind);
    });
  }
  function scheduleExport(kind) {
    clearTimeout(exportTimers[kind]);
    exportTimers[kind] = setTimeout(function () {
      exportWork(kind).catch(function (err) { showErr(err.message); });
    }, 180);
  }
  function setupCropper(kind) {
    var work = photoWork[kind];
    var ed = document.getElementById("ed-" + kind);
    var stage = document.getElementById("crop-stage-" + kind);
    if (ed) ed.hidden = false;
    if (!stage || !work || !work.file) return Promise.resolve();
    return window.GemintPhotos.loadFile(work.file).then(function (img) {
      work.img = img;
      if (work.cropper) work.cropper.destroy();
      work.cropper = window.GemintPhotos.createCropper(stage, {
        image: img,
        rotate90: work.rotate90 || 0,
        angle: work.angle || 0,
        ratioName: work.ratioName || "card",
        onChange: function () { updateRatioButtons(kind); }
      });
      updateRatioButtons(kind);
      return null;
    });
  }
  function initWorkFromFile(kind, file) {
    var slot = document.querySelector('[data-slot="' + kind + '"]');
    var defaultRatio = (slot && slot.getAttribute("data-default-ratio")) || "card";
    if (photoWork[kind] && photoWork[kind].cropper) photoWork[kind].cropper.destroy();
    if (photoWork[kind] && photoWork[kind].img && photoWork[kind].img.getContext) { photoWork[kind].img.width = 0; photoWork[kind].img.height = 0; }
    photoWork[kind] = {
      file: file,
      rotate90: 0,
      angle: 0,
      ratioName: defaultRatio,
      userAngle: false,
      warnings: []
    };
    var slider = document.querySelector('input[data-angle][data-for="' + kind + '"]');
    if (slider) slider.value = "0";
    return setupCropper(kind);
  }
  function loadExistingPhoto(kind, url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Foto non disponibile");
      return r.blob();
    }).then(function (blob) {
      var ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      return initWorkFromFile(kind, new File([blob], kind + "." + ext, { type: blob.type || "image/jpeg" }));
    });
  }
  function bindPhotoSlots() {
    document.querySelectorAll("[data-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-pick");
        var inp = document.querySelector('input[data-photo="' + kind + '"]');
        if (!inp) return;
        if (btn.getAttribute("data-capture") === "1") inp.setAttribute("capture", "environment");
        else inp.removeAttribute("capture");
        inp.click();
      });
    });
    document.querySelectorAll("input[data-photo]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var file = inp.files && inp.files[0]; if (!file) return;
        var kind = inp.getAttribute("data-photo");
        initWorkFromFile(kind, file).catch(function (err) { showErr(err.message); });
      });
    });
    document.querySelectorAll("[data-rot]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-for");
        var work = photoWork[kind];
        if (!work || !work.cropper) return;
        work.rotate90 = ((work.rotate90 || 0) + Number(btn.getAttribute("data-rot"))) % 360;
        work.cropper.setOrientation(work.rotate90, work.angle || 0, true);
      });
    });
    document.querySelectorAll("[data-ratio]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-for");
        var work = photoWork[kind];
        if (!work || !work.cropper) return;
        work.ratioName = btn.getAttribute("data-ratio") || "card";
        work.cropper.setRatioName(work.ratioName, true);
        updateRatioButtons(kind);
      });
    });
    document.querySelectorAll("[data-refit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-for");
        if (photoWork[kind] && photoWork[kind].cropper) photoWork[kind].cropper.refit();
      });
    });
    document.querySelectorAll("[data-reset-angle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-for");
        var work = photoWork[kind];
        if (!work || !work.cropper) return;
        work.angle = 0;
        work.userAngle = false;
        var slider = document.querySelector('input[data-angle][data-for="' + kind + '"]');
        if (slider) slider.value = "0";
        if (work.cropper.reset) work.cropper.reset();
        else work.cropper.setOrientation(work.rotate90 || 0, 0, true);
      });
    });
    var angleTimers = {};
    document.querySelectorAll("input[data-angle]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var kind = inp.getAttribute("data-for");
        var work = photoWork[kind];
        if (!work || !work.cropper) return;
        work.angle = Number(inp.value) || 0;
        work.userAngle = true;
        if (angleTimers[kind]) return;
        angleTimers[kind] = requestAnimationFrame(function () {
          angleTimers[kind] = 0;
          if (work.cropper) work.cropper.setOrientation(work.rotate90 || 0, work.angle || 0, false);
        });
      });
    });
    document.querySelectorAll("input[data-zoom]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var kind = inp.getAttribute("data-for");
        var work = photoWork[kind];
        if (!work || !work.cropper) return;
        work.cropper.setZoom((Number(inp.value) || 100) / 100);
      });
    });
  }
  function bindPhotoReplace(card) {
    photos = { front: null, back: null, challenge: null, cert: null };
    photoWork = { front: null, back: null, challenge: null, cert: null };
    bindPhotoSlots();
    var kinds = card.is_ungraded ? ["front", "back"] : ["front", "back", "challenge", "cert"];
    kinds.forEach(function (k) {
      if (card.photos && card.photos[k]) {
        loadExistingPhoto(k, "/api/cards/" + card.id + "/photo/" + k).catch(function () {});
      }
    });
    var save = document.getElementById("save-photos");
    if (!save) return;
    save.addEventListener("click", function () {
      Promise.all(kinds.map(function (k) { return photoWork[k] ? exportWork(k) : Promise.resolve(); })).then(function () {
        var payload = {};
        kinds.forEach(function (k) { if (photos[k]) payload[k] = photos[k]; });
        if (!payload.front && !(card.photos && card.photos.front !== false)) {
          showErr(tr("photo.needFront"));
          return null;
        }
        if (card.is_ungraded && !payload.back && (card.missing_back || !(card.photos && card.photos.back))) {
          showErr(tr("photo.needBack"));
          return null;
        }
        if (!Object.keys(payload).length) {
          showErr(tr("photo.needSave"));
          return null;
        }
        return api("cards/" + card.id + "/photos", { method: "POST", body: { photos: payload } });
      }).then(function (d) {
        if (!d) return;
        var ok = document.getElementById("photos-ok");
        if (ok) { ok.hidden = false; ok.textContent = tr("photo.saved"); }
        var er = document.getElementById("form-err");
        if (er) er.hidden = true;
      }).catch(function (err) { showErr(err.message); });
    });
  }
  function newChallenge() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "";
    var a = new Uint8Array(8); crypto.getRandomValues(a);
    for (var i = 0; i < 8; i++) out += chars[a[i] % chars.length];
    return out;
  }

  function bindRegister() {
    var raw = document.getElementById("kind-fixed").value === "raw";
    var ch = document.getElementById("challenge");
    challengeVideoOk = false;
    var cv = document.getElementById("challenge-video");
    if (cv) cv.addEventListener("change", function () {
      var f = cv.files && cv.files[0], st = document.getElementById("challenge-video-status");
      challengeVideoOk = false;
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { st.textContent = tr("video.too_large"); return; }
      if (!challengeId) { st.textContent = tr("reg.challengeCodeWait"); return; }
      var probe = document.createElement("video"); probe.preload = "metadata"; probe.muted = true;
      var url = URL.createObjectURL(f);
      var send = function () {
        URL.revokeObjectURL(url);
        if (isFinite(probe.duration) && probe.duration > 10.5) { st.textContent = tr("video.too_long"); return; }
        st.textContent = tr("reg.challengeVideoUploading");
        fetch("/api/cards/challenge/" + encodeURIComponent(challengeId) + "/video", { method: "POST", credentials: "include", headers: { "content-type": f.type || "application/octet-stream" }, body: f })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) {
              var err = new Error(d.error || d.message || ("Errore " + r.status));
              err.code = d.code || d.error || "";
              err.status = r.status;
              throw err;
            }
            return d;
          }); })
          .then(function () { challengeVideoOk = true; st.textContent = tr("reg.challengeVideoStatus"); })
          .catch(function (err) { st.textContent = videoErrorMessage(err); });
      };
      probe.onloadedmetadata = send; probe.onerror = send; probe.src = url;
    });
    if (ch) { challengeCode = ""; challengeId = ""; ch.textContent = "…"; api("cards/challenge", { method: "POST", body: {} }).then(function (d) { challengeCode = d.code; challengeId = d.challenge_id; ch.textContent = d.code; }).catch(function (err) { ch.textContent = ""; showErr(err.message); }); }
    var q = document.getElementById("cat-q");
    var catGame = document.getElementById("cat-game");
    var gameEl = document.getElementById("game");
    if (catGame && gameEl) {
      if (!gameEl.value) gameEl.value = "pokemon";
      catGame.value = gameEl.value || "pokemon";
      catGame.addEventListener("change", function () {
        if (gameEl) gameEl.value = catGame.value;
        if (q) q.placeholder = catalogPlaceholders(catGame.value);
        q.dispatchEvent(new Event("input"));
      });
      gameEl.addEventListener("change", function () {
        catGame.value = gameEl.value;
        q.placeholder = catalogPlaceholders(gameEl.value);
      });
    }
    if (q) q.placeholder = catalogPlaceholders(selectedCatalogGame());
    var t = 0;
    var lastRemoteHits = [];
    function renderCatalogResults(localModels, remoteHits) {
      lastRemoteHits = remoteHits || [];
      var local = (localModels || []).map(function (m) {
        return '<button type="button" class="search-item" data-id="' + m.id + '"><b>' + esc(m.name) + "</b> · " + esc(m.code_printed) + " · " + esc(m.set_name) + " · " + esc(gameLabel(m.game)) + " · " + esc(m.language) + " · " + esc(variantLabel(m.variant)) + "</button>";
      }).join("");
      var seen = {}, remote = "";
      (remoteHits || []).forEach(function (h) {
        if (!h || !h.id || seen[h.id]) return;
        seen[h.id] = true;
        remote += '<button type="button" class="search-item tcgdex-hit catalog-hit" data-catalog-id="' + esc(h.id) + '">' +
          ((h.image_small || h.image) ? '<img class="cat-ref-thumb" src="' + esc(h.image_small || h.image) + '" alt="">' : "") +
          "<div><b>" + esc(h.name) + "</b> · " + esc(h.code_printed || "") +
          (h.set_name ? " · " + esc(h.set_name) : "") +
          " · " + esc(gameLabel(h.game)) +
          (h.language ? " · " + esc(h.language) : "") +
          '<div class="dim">' + tr("reg.refLabel") + "</div></div></button>";
      });
      document.getElementById("cat-results").innerHTML = local + remote || '<p class="dim">' + tr("reg.noResults") + "</p>";
    }
    function runCatalogSearch() {
      var v = q.value.trim();
      if (v.length < 2) { document.getElementById("cat-results").innerHTML = ""; return; }
      var game = selectedCatalogGame();
      var langVal = (document.getElementById("language") && document.getElementById("language").value) || "ITA";
      var localReq = api("catalog?q=" + encodeURIComponent(v) + "&game=" + encodeURIComponent(game)).catch(function () { return { models: [] }; });
      var remoteReq;
      if (gameSearchSupported(game)) {
        remoteReq = api("catalog/lookup?game=" + encodeURIComponent(game) + "&q=" + encodeURIComponent(v) + "&lang=" + encodeURIComponent(langVal))
          .catch(function () { return null; })
          .then(function (d) {
            if (d && Array.isArray(d.hits) && (d.hits.length || game !== "pokemon")) return d.hits;
            if (game !== "pokemon") return (d && d.hits) || [];
            var lang = tcgdexLang();
            var langs = [lang];
            if (lang !== "en") langs.push("en");
            return Promise.all(langs.map(function (lg) { return searchTcgdex(v, lg).then(function (cards) { return { lang: lg, cards: cards }; }); }))
              .then(function (packs) {
                var hits = [], seen = {};
                (packs || []).forEach(function (pack) {
                  (pack.cards || []).forEach(function (c) {
                    if (!c || !c.id || seen[c.id]) return;
                    seen[c.id] = true;
                    var official = c.set && c.set.cardCount && c.set.cardCount.official;
                    var localId = String(c.localId || "");
                    var code = official ? (localId.replace(/^0+/, "") + "/" + official) : localId;
                    hits.push({
                      id: "pokemon:" + c.id,
                      game: "pokemon",
                      name: c.name,
                      set_name: (c.set && c.set.name) || "",
                      code_printed: code || c.id,
                      image: tcgdexImg(c.image, "high"),
                      image_small: tcgdexImg(c.image, "low"),
                      language: TCGDEX_LANG_BACK[pack.lang] || "ITA",
                      variant: "normal",
                      cardmarket_avg_euros: null,
                      _tcgdex: true
                    });
                  });
                });
                return hits;
              });
          });
      } else {
        remoteReq = Promise.resolve([]);
      }
      Promise.all([localReq, remoteReq]).then(function (parts) {
        renderCatalogResults((parts[0] && parts[0].models) || [], parts[1] || []);
      });
    }
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(runCatalogSearch, 220);
    });
    document.getElementById("cat-results").addEventListener("click", function (e) {
      var btn = e.target.closest(".search-item"); if (!btn) return;
      var catalogId = btn.getAttribute("data-catalog-id");
      if (catalogId) {
        var known = lastRemoteHits.filter(function (h) { return h && h.id === catalogId; })[0];
        var catBox = document.getElementById("cat-results");
        if (catBox) catBox.innerHTML = "";
        if (known) applyCatalogHit(known);
        var game = selectedCatalogGame();
        var langVal = (document.getElementById("language") && document.getElementById("language").value) || "ITA";
        api("catalog/lookup?game=" + encodeURIComponent(game) + "&id=" + encodeURIComponent(catalogId) + "&lang=" + encodeURIComponent(langVal))
          .then(function (d) {
            var h = (d.hits || [])[0];
            if (h) applyCatalogHit(h);
          })
          .catch(function () {
            if (game !== "pokemon") return;
            var dexId = catalogId.replace(/^pokemon:/, "");
            var prefer = tcgdexLang();
            fetchJson("https://api.tcgdex.net/v2/" + prefer + "/cards/" + encodeURIComponent(dexId)).then(function (card) {
              if (card) applyTcgdexCard(card, prefer);
            });
          });
        return;
      }
      api("catalog?q=" + encodeURIComponent(q.value.trim()) + "&game=" + encodeURIComponent(selectedCatalogGame())).then(function (d) {
        var m = (d.models || []).find(function (x) { return x.id === btn.getAttribute("data-id"); });
        if (!m) return;
        var catBox2 = document.getElementById("cat-results");
        if (catBox2) catBox2.innerHTML = "";
        document.getElementById("model-id").value = m.id;
        document.getElementById("game").value = m.game;
        if (catGame) catGame.value = m.game;
        document.getElementById("set_name").value = m.set_name;
        document.getElementById("code").value = m.code_printed;
        document.getElementById("name").value = m.name;
        document.getElementById("language").value = m.language;
        document.getElementById("variant").value = m.variant;
        var box = document.getElementById("ref-card");
        if (box) box.hidden = true;
        var hid = document.getElementById("catalog-image");
        if (hid) hid.value = m.catalog_image || "";
        var hidAvg = document.getElementById("cardmarket-avg");
        if (hidAvg) hidAvg.value = "";
        var hidUsd = document.getElementById("market-avg-usd");
        if (hidUsd) hidUsd.value = "";
        var rp = document.getElementById("ref-price");
        if (rp) rp.textContent = "";
      });
    });
    photos = { front: null, back: null, challenge: null, cert: null };
    photoWork = { front: null, back: null, challenge: null, cert: null };
    bindPhotoSlots();
    var submitInFlight = false;
    function setSubmitting(on) {
      submitInFlight = on;
      var b = document.getElementById("submit-card");
      if (!b) return;
      if (on) {
        if (!b.getAttribute("data-label")) b.setAttribute("data-label", b.textContent);
        b.disabled = true;
        b.setAttribute("aria-busy", "true");
        b.textContent = tr("reg.submitting");
      } else {
        b.disabled = false;
        b.removeAttribute("aria-busy");
        if (b.getAttribute("data-label")) b.textContent = b.getAttribute("data-label");
      }
    }
    document.getElementById("submit-card").addEventListener("click", function () {
      if (submitInFlight) return; // v23: no double submit (double click / tap while uploading)
      setSubmitting(true);
      var raw = document.getElementById("kind-fixed").value === "raw";
      var pending = Object.keys(photoWork).filter(function (k) { return photoWork[k]; }).map(exportWork);
      function stop(msg) { setSubmitting(false); showErr(msg); }
      Promise.all(pending).then(function () {
      if (raw && !photos.front && !photos.back) { stop(tr("reg.photosRequiredRaw")); return; }
      if (!photos.front) { stop(tr("photo.needFront")); return; }
      if (raw && !photos.back) { stop(tr("photo.needBack")); return; }
      if (!raw && !challengeVideoOk) { stop(tr("reg.challengeVideoNeed")); return; }
      var warns = Object.keys(photoWork).reduce(function (acc, k) {
        return acc.concat((photoWork[k] && photoWork[k].warnings) || []);
      }, []);
      var btn = document.getElementById("submit-card");
      if (warns.length && btn.getAttribute("data-confirm-warn") !== "1") {
        stop(tr("photo.blurWarn"));
        btn.setAttribute("data-confirm-warn", "1");
        return;
      }
      var body = {
        model_id: document.getElementById("model-id").value || undefined,
        game: document.getElementById("game").value,
        set_name: document.getElementById("set_name").value,
        code: document.getElementById("code").value,
        name: document.getElementById("name").value,
        language: document.getElementById("language").value,
        variant: document.getElementById("variant").value,
        is_ungraded: raw,
        condition: raw ? document.getElementById("condition").value : undefined,
        grader: raw ? "NONE" : document.getElementById("grader").value,
        certificate_no: raw ? "" : document.getElementById("cert").value,
        grade: raw ? "" : document.getElementById("grade").value,
        challenge_code: raw ? undefined : challengeCode, challenge_id: raw ? undefined : challengeId,
        catalog_image: raw ? undefined : ((document.getElementById("catalog-image") || {}).value || undefined),
        price_euros: (document.getElementById("sale-price").value || "").replace(",", ".").trim(),
        cardmarket_avg_euros: (document.getElementById("cardmarket-avg") || {}).value || undefined,
        photos: photos
      };
      if (body.price_euros && !(Number(body.price_euros) > 0)) { stop(tr("err.priceInvalid")); return; }
      if (!body.price_euros) body.price_euros = undefined;
      // The server answers 200 { card, dedup: true } when the same request was already received:
      // same result as 201, the user lands on the one existing request.
      return api("cards", { body: body }).then(function (d) {
        if (d && d.dedup) dmToast(tr("reg.alreadySent"));
        go("#/carta/" + d.card.id);
      }).catch(function (err) { stop(videoErrorMessage(err)); });
      }).catch(function (err) { stop(err.message); });
    });
  }

  function bindGallery() {
    var gal = document.querySelector(".product-gallery");
    if (!gal) return;
    var cardId = gal.getAttribute("data-card");
    var mainBtn = document.getElementById("gal-main");
    var mainImg = gal.querySelector(".gal-main-img");
    function showKind(kind) {
      if (!mainImg || !mainBtn) return;
      mainBtn.setAttribute("data-kind", kind);
      mainImg.removeAttribute("data-orig-fallback");
      mainImg.src = photoSrc(cardId, kind, 672);
      mainImg.setAttribute("srcset", photoSrcset(cardId, kind));
      gal.querySelectorAll(".product-thumb").forEach(function (th) {
        th.classList.toggle("on", th.getAttribute("data-kind") === kind);
      });
    }
    gal.querySelectorAll(".product-thumb").forEach(function (th) {
      th.addEventListener("click", function () { showKind(th.getAttribute("data-kind")); });
    });
    var lb = document.getElementById("lightbox");
    var lbImg = document.getElementById("lb-img");
    function closeLb() {
      if (lb) lb.hidden = true;
      if (lbImg) { lbImg.classList.remove("is-zoom"); lbImg.style.transformOrigin = "center center"; }
    }
    if (mainBtn && lb && lbImg) {
      mainBtn.addEventListener("click", function () {
        var kind = mainBtn.getAttribute("data-kind") || "front";
        lbImg.src = photoSrc(cardId, kind);
        lbImg.classList.remove("is-zoom");
        lb.hidden = false;
      });
      lbImg.addEventListener("click", function (e) {
        lbImg.classList.toggle("is-zoom");
        if (lbImg.classList.contains("is-zoom")) {
          var r = lbImg.getBoundingClientRect();
          lbImg.style.transformOrigin = (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "% " + (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%";
        }
      });
      lb.addEventListener("click", function (e) { if (e.target === lb) closeLb(); });
      var closer = lb.querySelector(".lightbox-close");
      if (closer) closer.addEventListener("click", closeLb);
      document.addEventListener("keydown", function onEsc(e) {
        if (e.key === "Escape" && lb && !lb.hidden) closeLb();
      });
    }
  }

  function showErr(msg) {
    var el = document.getElementById("form-err");
    if (!el) { alert(msg); return; }
    el.hidden = false; el.textContent = msg;
  }

  function bindAuth(mode) {
    document.getElementById("auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var body = { email: fd.get("email"), password: fd.get("password"), display_name: fd.get("display_name"), country: fd.get("country") };
      if (mode === "signup") {
        var typed = String(fd.get("invite_code") || "").trim();
        body.invite_code = typed || getStoredRef() || "";
        body.username = normalizeUsername(fd.get("username"));
        body.album_public = fd.get("album_public") === "1";
        if (!usernameValid(body.username)) { showErr(tr("user.usernameInvalid")); return; }
        body.plan = fd.get("plan") || "";
        if (!body.plan) { showErr(tr("plan.required")); return; }
      }
      api(mode === "signup" ? "auth/signup" : "auth/login", { body: body }).then(function (d) {
        state.user = d.user;
        if (mode === "signup") clearStoredRef();
        go("#/album");
      }).catch(function (err) { showErr(mode === "signup" ? usernameErrorMessage(err) : err.message); });
    });
  }

  async function render() {
    if (state.revealUnmount) { state.revealUnmount(); state.revealUnmount = null; }
    renderChrome();
    var r = route();
    var p = r.parts;
    // v24: accounts without a username must choose one before using the site
    // (login/signup and Assistenza stay reachable; legal pages and /c/ are not SPA routes).
    if (state.user && !state.user.username && ["accedi", "registrati", "assistenza"].indexOf(p[0] || "") === -1) {
      document.title = tr("gate.title") + " — DreaMint";
      $app.innerHTML = pageUsernameGate();
      bindUsernameGate();
      return;
    }
    // v26: then non-admin accounts without a plan must choose one (server decides needs_plan via role).
    if (state.user && state.user.needs_plan && ["accedi", "registrati", "assistenza"].indexOf(p[0] || "") === -1) {
      document.title = tr("plan.title") + " — DreaMint";
      $app.innerHTML = pagePlanGate();
      bindPlanGate();
      return;
    }
    try {
      if (window.DreaMintCert && window.DreaMintCert.handleRoute) {
        var handled = await window.DreaMintCert.handleRoute({
          p: p,
          state: state,
          $app: $app,
          pageAuth: pageAuth,
          bindAuth: bindAuth
        });
        if (handled) return;
      }
      if (!p.length || p[0] === "scala" || p[0] === "mitica") {
        if (p[0] === "mitica") {
          $app.innerHTML = '<div class="page-head"><div><h1>' + tr("mitica.pageTitle") + "</h1><p>" + tr("mitica.pageLede") + "</p></div></div>" +
            '<section class="rare-showcase"><div class="rare-row" style="grid-template-columns:1fr">' +
            '<figure class="rare-feature mitica-closeup" id="mitica-closeup" data-tier="mitica">' +
            charizardFrame("mitica", { sizes: "min(78vw, 340px)", cls: "feature-slab feature-mitica" }) +
            "<figcaption><strong>" + tr("tier.mitica.badge") + "</strong><span>" + tr("tier.mitica.callout") + "</span></figcaption></figure></div></section>";
          return;
        }
        if (p[0] === "scala") {
          $app.innerHTML = rarityLadder() + rareShowcase() +
            '<p class="row-actions"><a class="btn primary" href="#/demo-reveal/mitica" data-link>' + tr("scala.try") + "</a></p>";
          return;
        }
        var recent = { items: [] };
        if (window.DreaMintHome) {
          var homeData = await Promise.all([
            api("recent").catch(function () { return { items: [] }; }),
            api("market").catch(function () { return { listings: [] }; })
          ]);
          document.title = tr("meta.title");
          $app.innerHTML = window.DreaMintHome.homeHtml({ recent: homeData[0].items || [], market: homeData[1].listings || [] });
          window.DreaMintHome.bindHome($app);
          return;
        }
        try { recent = await api("recent"); } catch (e) { recent = { items: [] }; }
        $app.innerHTML = pageHome(recent.items || []);
        return;
      }
      if ((p[0] === "commissioni" || p[0] === "fees") && window.DreaMintHome) {
        document.title = trx("fee.kicker", "Commissioni e abbonamenti") + " — DreaMint";
        var html = window.DreaMintHome.commissioniHtml(state.cfg);
        var shell = document.getElementById("fee-shell");
        if (shell) {
          var tmp = document.createElement("div");
          tmp.innerHTML = html;
          var fresh = tmp.querySelector(".fee-page") || tmp;
          var newHero = fresh.querySelector(".fee-hero");
          if (newHero) newHero.remove();
          Array.prototype.slice.call(fresh.children).forEach(function (el) { shell.appendChild(el); });
        } else {
          $app.innerHTML = html;
        }
        window.DreaMintHome.bindCommissioni($app, state.cfg);
        return;
      }
      if (p[0] === "admin" && p[1] === "lancio" && window.DreaMintHome) {
        if (!state.user || state.user.role !== "admin") { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var lnc = await api("admin/launch");
        $app.innerHTML = window.DreaMintHome.adminLaunchHtml(lnc);
        window.DreaMintHome.bindAdminLaunch($app, function () {
          api("config").then(function (c) { state.cfg = Object.assign(state.cfg, c); render(); }).catch(function () { render(); });
        });
        return;
      }
      if (p[0] === "accedi") { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
      if (p[0] === "registrati") { $app.innerHTML = pageAuth("signup"); bindAuth("signup"); return; }
      if (p[0] === "account") {
        var pendingPaypal = [];
        if (state.user && !state.user.paypal_email) {
          try {
            var mineAcc = await api("cards");
            pendingPaypal = (mineAcc.cards || []).filter(needsPaypalToSell);
          } catch (eAcc) { pendingPaypal = []; }
        }
        $app.innerHTML = pageAccount(pendingPaypal);
        var vq = (location.search.match(/[?&]email=([a-z-]+)/) || [])[1], vmsg = { verificata: "Email confermata. Ora puoi vendere, comprare e riscattare.", "link-scaduto": "Il link è scaduto: chiedine uno nuovo qui sotto.", "link-gia-usato": "Questo link è già stato usato.", "link-non-valido": "Link non valido." }[vq];
        if (vq) history.replaceState(null, "", location.pathname + location.hash);
        if (vmsg || (state.user && state.user.email_verified === false)) $app.insertAdjacentHTML("afterbegin", '<p class="notice" id="verify-box">' + esc(vmsg || "") + (state.user && state.user.email_verified === false ? (vmsg ? " " : "") + 'Conferma la tua email per vendere, comprare o riscattare: ti abbiamo mandato un link. <button type="button" class="btn ghost small" id="verify-resend">Invia di nuovo il link</button> <span id="verify-msg"></span>' : "") + "</p>");
        var vr = document.getElementById("verify-resend");
        if (vr) vr.onclick = function () { vr.disabled = true; api("auth/resend-verification", { method: "POST", body: {} }).then(function () { document.getElementById("verify-msg").textContent = "Email inviata."; }).catch(function (err) { vr.disabled = false; document.getElementById("verify-msg").textContent = err.message; }); };
        var lo = document.getElementById("logout");
        if (lo) lo.onclick = function () { api("auth/logout", { method: "POST", body: {} }).then(function () { state.user = null; go("#/"); }); };
        var pf = document.getElementById("paypal-form");
        if (pf) pf.onsubmit = function (e) {
          e.preventDefault();
          var email = new FormData(pf).get("paypal_email");
          api("me", { method: "PATCH", body: { paypal_email: email } }).then(function (d) {
            state.user = d.user;
            var ok = document.getElementById("paypal-ok");
            ok.hidden = false; ok.textContent = tr("account.paypalSaved");
            document.getElementById("paypal-err").hidden = true;
          }).catch(function (err) {
            var er = document.getElementById("paypal-err");
            er.hidden = false; er.textContent = err.message;
          });
        };
        bindUsernameForm();
        bindPrivacyToggle();
        bindPlanForm();
        if (state.user && state.user.username) {
          var myRvBox = document.createElement("div");
          $app.appendChild(myRvBox);
          loadReviewsInto(state.user.username, myRvBox, true);
        }
        return;
      }
      if (p[0] === "registra") {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var rawReg = p[1] === "non-gradate" || p[1] === "raw";
        if (!p[1]) { $app.innerHTML = '<section class="panel"><h2>' + tr("register.choice") + '</h2><div class="row"><a class="btn primary" href="#/registra/gradate" data-link>' + tr("reg.titleGraded") + '</a><a class="btn" href="#/registra/non-gradate" data-link>' + tr("reg.titleRaw") + "</a></div></section>"; return; }
        $app.innerHTML = pageRegister(rawReg); bindRegister(); return;
      }
      if (p[0] === "gradate" || p[0] === "non-gradate") {
        $app.innerHTML = '<div class="skel" style="min-height:280px"></div>';
        var sec = p[0] === "non-gradate" ? "ungraded" : "graded";
        var tierFilter = (sec === "graded" && tierInfo(p[1])) ? p[1] : "";
        var condIds = { NM:1, EX:1, GD:1, LP:1, PL:1, Poor:1 };
        var condFilter = (sec === "ungraded" && p[1] && condIds[p[1]]) ? p[1] : "";
        var mktSec = await api("market?section=" + sec);
        var mktList = mktSec.listings || [];
        $app.innerHTML = pageMarket(mktList, sec, tierFilter, condFilter);
        if (window.DreaMintHome && window.DreaMintHome.bindMarketBoard) window.DreaMintHome.bindMarketBoard($app);
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
          window.DreaMintTradeV9.bindCertForm($app);
          window.DreaMintTradeV9.decorateTiles($app);
        }
        return;
      }
      if (p[0] === "u" && p[1]) {
        var uname = decodeURIComponent(p[1] || "");
        var pubTab = albumTabFromParts(p, 2);
        $app.innerHTML = '<div class="skel" style="min-height:240px"></div>';
        try {
          var pub = await api("users/" + encodeURIComponent(uname) + "/album");
          $app.innerHTML = pagePublicProfile(pub, null, pubTab);
          bindPublicProfile();
          var rvBox = document.createElement("div");
          $app.appendChild(rvBox);
          loadReviewsInto(uname, rvBox, false);
        } catch (pubErr) {
          $app.innerHTML = pagePublicProfile(null, pubErr, pubTab);
        }
        return;
      }
      if (p[0] === "collezione" || p[0] === "album") {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        $app.innerHTML = '<div class="skel" style="min-height:240px"></div>';
        var mine = await api("cards");
        $app.innerHTML = pageCollection(mine.cards || []);
        // reveal-v2 hook: cornice rarità + retro sigillato nelle tile (logica in /js/reveal-v2.js)
        if (window.DreamintRevealV2) window.DreamintRevealV2.enhanceGrid(mine.cards || [], state.user);
        bindAlbumTabs();
        bindCloseListingButtons($app);
        bindUsernameForm();
        bindPrivacyToggle();
        return;
      }
      if (p[0] === "carta" && p[1]) {
        $app.innerHTML = '<div class="skel" style="min-height:320px"></div>';
        var one = await api("cards/" + p[1]);
        $app.innerHTML = pageCard(one.card);
        bindRawFlip($app);
        // reveal-v2 hook: copia digitale con cornice rarità / apertura premium (logica in /js/reveal-v2.js)
        if (window.DreamintRevealV2) window.DreamintRevealV2.enhanceCard(one.card, state.user);
        bindShareRow(one.card, null);
        bindGallery();
        bindShareRarity(one.card);
        if (window.DreaMintCert) window.DreaMintCert.bindShareButtons(one.card);
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) window.DreaMintTradeV9.enhanceDigitalCopy(one.card);
        if (one.card.can_update_photos) bindPhotoReplace(one.card);
        var lf = document.getElementById("list-form");
        if (lf && lf.getAttribute("data-v9") && window.DreaMintTradeV9) {
          window.DreaMintTradeV9.bindListForm(lf, one.card, { api: api, go: go, tr: tr, paypalNeededHtml: paypalNeededHtml });
        } else if (lf) lf.onsubmit = function (e) {
          e.preventDefault();
          var fd = new FormData(lf);
          api("listings", { body: { slab_id: one.card.id, price_euros: String(fd.get("price") || "").replace(",", ".") } })
            .then(function () { go(one.card.is_ungraded ? "#/non-gradate" : "#/gradate"); })
            .catch(function (err) {
              var msg = String(err && err.message || "");
              if (/paypal/i.test(msg) && !document.querySelector(".paypal-needed")) {
                lf.insertAdjacentHTML("beforebegin", paypalNeededHtml());
              }
              alert(msg);
            });
        };
        bindCloseListingButtons($app);
        var so = document.getElementById("sold-outside");
        if (so) so.onclick = function () {
          var er = document.getElementById("sold-outside-err");
          if (er) er.hidden = true;
          if (!soldOutsideReady()) {
            if (er) { er.hidden = false; er.textContent = tr("card.soldOutsideSoon"); }
            else alert(tr("card.soldOutsideSoon"));
            return;
          }
          if (!confirm(tr("card.soldOutsideConfirm"))) return;
          so.disabled = true;
          api("cards/" + one.card.id + "/archive", { method: "POST", body: { reason: "sold_outside" } })
            .then(function () { dmToast(tr("card.soldOutsideOk")); go("#/album"); })
            .catch(function (err) {
              so.disabled = false;
              var m = String(err && err.message || "");
              if (er) { er.hidden = false; er.textContent = /404|not found|non trovata/i.test(m) ? tr("card.soldOutsideSoon") : m; }
              else alert(m);
            });
        };
        var pf = document.getElementById("price-form");
        if (pf) pf.onsubmit = function (e) {
          e.preventDefault();
          var fd = new FormData(pf);
          var er = document.getElementById("price-err");
          var ok = document.getElementById("price-ok");
          if (er) er.hidden = true;
          if (ok) ok.hidden = true;
          api("cards/" + one.card.id + "/price", { method: "PATCH", body: { price_euros: String(fd.get("price") || "").replace(",", ".") } })
            .then(function () {
              if (ok) { ok.hidden = false; ok.textContent = tr("card.priceUpdated"); }
            })
            .catch(function (err) {
              if (er) { er.hidden = false; er.textContent = err.message; }
              else alert(err.message);
            });
        };
        return;
      }
      if (p[0] === "apri" && p[1]) {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var opened = await api("cards/" + p[1] + "/open", { method: "POST", body: {} });
        var c = opened.card;
        $app.innerHTML = pageRevealShell();
        // reveal-v2 hook: nuova estrazione se caricata, altrimenti la vecchia (reveal.js)
        state.revealUnmount = (window.DreamintRevealV2 || window.GemintReveal).mount(document.getElementById("reveal-root"), {
          tier: c.rarity_tier, serial: c.serial_number, total: c.serial_total || c.serial_number,
          name: c.model.name, code: c.model.code_printed, setName: c.model.set_name,
          grader: c.grader, grade: c.grade, certKey: c.cert_key,
          seed: c.server_seed, commit: c.commit_hash, nonce: c.client_nonce,
          digest: c.digest, roll: c.roll, photoUrl: catalogArt(c) || photoSrc(c.id, "front", 560),
          photoSrcset: catalogArt(c) ? "" : photoSrcset(c.id, "front"),
          fullSet: c.full_set, card: c, viewer: state.user /* reveal-v2: TEST/admin + arte ufficiale */
        });
        return;
      }
      if (p[0] === "demo-reveal") {
        var demoTier = tierInfo(p[1]) ? p[1] : "mitica";
        var auto = p[2] === "auto";
        $app.innerHTML = '<p class="notice demo-reveal-note">' + tr("reveal.demo") + "</p>" + pageRevealShell();
        // reveal-v2 hook: nuova estrazione se caricata, altrimenti la vecchia (reveal.js)
        state.revealUnmount = (window.DreamintRevealV2 || window.GemintReveal).mount(document.getElementById("reveal-root"), {
          tier: demoTier, serial: 1 + Math.floor(Math.random() * 9999), total: 9999,
          name: "Charizard", code: "25/185", setName: "Voltaggio Sfolgorante",
          grader: "PSA", grade: "10", certKey: "PSA-DEMO",
          photoUrl: CHARIZARD_ART, photoSrcset: "", fullSet: false, autoplay: auto, demo: true
        });
        return;
      }
      if (p[0] === "cerca-certificato" || p[0] === "certificato") {
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
          await window.DreaMintTradeV9.renderCertSearch($app);
          return;
        }
      }
      if (p[0] === "messaggi") {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
          await window.DreaMintTradeV9.renderInbox($app);
          return;
        }
      }
      if (p[0] === "chat" && p[1] === "new") {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
          var qn = window.DreaMintTradeV9.hashQuery();
          try {
            await window.DreaMintTradeV9.startChatAndGo(qn.listing || "", qn.slab || "", go);
          } catch (chatErr) {
            $app.innerHTML = '<section class="panel"><p class="error">' + esc(chatErr.message) + "</p></section>";
          }
          return;
        }
      }
      if (p[0] === "chat" && p[1]) {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) {
          await window.DreaMintTradeV9.renderChat($app, p[1], go);
          return;
        }
      }
      if (p[0] === "mercato") { go("#/gradate"); return; }
      if (p[0] === "annuncio" && p[1] && p[2]) {
        var m2 = await api("market");
        var m2list = m2.listings || [];
        var listing = m2list.find(function (x) { return x.id === p[1]; });
        var sl = await api("cards/" + p[2]);
        if (!listing) { $app.innerHTML = '<section class="panel">' + tr("list.unavailable") + "</section>"; return; }
        var mySale = null;
        if (state.user) {
          try {
            var sls = await api("sales");
            mySale = (sls.sales || []).find(function (s) {
              return s.listing_id === listing.id && s.buyer_id === state.user.id && isOpenBuyerSale(s);
            }) || null;
          } catch (e) { mySale = null; }
        }
        $app.innerHTML = pageListing(listing, sl.card, mySale);
        bindShareRow(sl.card, listing);
        bindGallery();
        bindShareRarity(sl.card);
        bindBuyShipping(document.getElementById("buy-form"), listing);
        if (window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) window.DreaMintTradeV9.enhanceDigitalCopy(sl.card);
        return;
      }
      if (p[0] === "vendite") {
        if (!state.user) { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var sls = await api("sales");
        $app.innerHTML = pageSales(sls.sales || []);
        bindReviewForms($app);
        $app.querySelectorAll("[data-act]").forEach(function (btn) {
          btn.onclick = function () {
            api("sales/" + btn.getAttribute("data-id") + "/" + btn.getAttribute("data-act"), { body: {} })
              .then(function () { render(); })
              .catch(function (err) { alert(err.message); });
          };
        });
        $app.querySelectorAll("[data-copy-dest]").forEach(function (btn) {
          btn.onclick = function () {
            var pre = document.getElementById(btn.getAttribute("data-copy-dest"));
            if (!pre) return;
            var text = pre.textContent || "";
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () { btn.textContent = tr("copied"); }).catch(function () {});
            }
          };
        });
        $app.querySelectorAll("form.track-form").forEach(function (tf) {
          tf.onsubmit = function (e) {
            e.preventDefault();
            var fd = new FormData(tf);
            var tracking = String(fd.get("tracking") || "").trim();
            if (tracking.length < 5) { alert(tr("sales.needTracking")); return; }
            api("sales/" + tf.getAttribute("data-sale") + "/ship", { body: { tracking: tracking } })
              .then(function () { render(); })
              .catch(function (err) { alert(err.message); });
          };
        });
        return;
      }
      if (p[0] === "partner" && p[1]) {
        $app.innerHTML = '<div class="skel" style="min-height:200px"></div>';
        try {
          var ps = await api("partner/" + encodeURIComponent(p[1]));
          $app.innerHTML = pagePartnerPublic(ps.partner);
        } catch (e) {
          $app.innerHTML = pagePartnerPublic(null);
        }
        return;
      }
      if (p[0] === "assistenza") {
        document.title = tr("support.title") + " — DreaMint";
        $app.innerHTML = pageSupport();
        bindSupport();
        return;
      }
      if (p[0] === "admin" && p[1] === "assistenza") {
        if (!state.user || state.user.role !== "admin") { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var supSt = ["open", "closed", "all"].indexOf(p[2]) >= 0 ? p[2] : "open";
        var sup = await api("admin/support?status=" + supSt);
        $app.innerHTML = pageAdminSupport(sup);
        $app.querySelectorAll("[data-support-id]").forEach(function (b) {
          b.onclick = function () {
            b.disabled = true;
            api("admin/support/" + encodeURIComponent(b.getAttribute("data-support-id")), { method: "PATCH", body: { status: b.getAttribute("data-support-to") } })
              .then(function () { render(); })
              .catch(function (e) { b.disabled = false; var er = document.getElementById("support-admin-err"); er.hidden = false; er.textContent = e.message; });
          };
        });
        return;
      }
      if (p[0] === "admin" && p[1] === "partner") {
        if (!state.user || state.user.role !== "admin") { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var admP = await api("admin/partners");
        $app.innerHTML = pageAdminPartners(admP.partners || []);
        var pform = document.getElementById("partner-form");
        if (pform) pform.onsubmit = function (e) {
          e.preventDefault();
          var fd = new FormData(pform);
          var er = document.getElementById("partner-err");
          var ok = document.getElementById("partner-ok");
          if (er) er.hidden = true;
          if (ok) ok.hidden = true;
          api("admin/partners", { body: { name: fd.get("name"), code: fd.get("code"), contact_note: fd.get("contact_note") } })
            .then(function () { render(); })
            .catch(function (err) {
              if (er) { er.hidden = false; er.textContent = err.message; }
              else alert(err.message);
            });
        };
        $app.querySelectorAll("[data-copy]").forEach(function (btn) {
          btn.onclick = function () { copyText(btn.getAttribute("data-copy"), btn); };
        });
        return;
      }
      if (p[0] === "admin" && p[1] === "vendite") {
        if (!state.user || state.user.role !== "admin") { $app.innerHTML = pageAuth("login"); bindAuth("login"); return; }
        var admSales = await api("admin/sales");
        $app.innerHTML = pageAdminSales(admSales.sales || []);
        return;
      }
      if (p[0] === "admin" && p[1] === "carta" && p[2]) {
        var ac = await api("admin/cards/" + p[2]);
        $app.innerHTML = pageAdminCard(ac.card);
        document.getElementById("approve").onclick = function () {
          api("admin/cards/" + p[2] + "/approve", { body: {} }).then(function () { go("#/admin"); }).catch(function (err) { showErr(err.message); });
        };
        document.getElementById("reject").onclick = function () {
          api("admin/cards/" + p[2] + "/reject", { body: { reason: document.getElementById("rej-reason").value } })
            .then(function () { go("#/admin"); }).catch(function (err) { showErr(err.message); });
        };
        var arm = document.getElementById("admin-remove-card");
        if (arm) arm.onclick = function () {
          arm.disabled = true;
          adminRemoveCardFlow(p[2], document.getElementById("admin-remove-err"), function () { go("#/admin"); })
            .then(function (okk) { if (!okk) arm.disabled = false; });
        };
        return;
      }
      if (p[0] === "admin") {
        var q = await api("admin/queue");
        if (state.user) state.user.pending_reviews = (q.items || []).length;
        renderChrome();
        $app.innerHTML = pageAdmin(q.items || []);
        var arf = document.getElementById("admin-remove-form");
        if (arf) arf.onsubmit = function (e) {
          e.preventDefault();
          var er = document.getElementById("admin-remove-err"), okEl = document.getElementById("admin-remove-ok");
          var cid = cardIdFromInput(new FormData(arf).get("card"));
          okEl.hidden = true;
          if (!cid) { er.hidden = false; er.textContent = tr("admin.removeAnyBad"); return; }
          adminRemoveCardFlow(cid, er, function () { okEl.hidden = false; okEl.textContent = tr("admin.removedOk"); arf.reset(); });
        };
        var tf = document.getElementById("test-card-form");
        if (tf) tf.onsubmit = function (e) {
          e.preventDefault();
          var email = new FormData(tf).get("email");
          api("admin/test-card", { body: { email: email } }).then(function (d) {
            var ok = document.getElementById("test-ok");
            ok.hidden = false; ok.textContent = "Carta TEST creata e assegnata. L’utente la trova in collezione, pronta da aprire.";
            document.getElementById("test-err").hidden = true;
          }).catch(function (err) {
            var er = document.getElementById("test-err");
            er.hidden = false; er.textContent = err.message;
          });
        };
        return;
      }
      document.title = tr("notfound.title") + " — DreaMint";
      $app.innerHTML = '<section class="panel"><h1>' + tr("notfound.title") + '</h1><p class="muted">' + tr("notfound.p") + '</p><p class="row-actions"><a class="btn primary" href="#/" data-link>' + tr("notfound.home") + '</a></p></section>';
    } catch (err) {
      $app.innerHTML = '<section class="panel"><p class="error">' + esc(err.message) + "</p></section>";
    } finally {
      $app.classList.remove("is-entering");
      void $app.offsetWidth;
      $app.classList.add("is-entering");
      enhanceUI();
      if (window.DreaMintPrices && !(p && !p.length)) { try { window.DreaMintPrices.enhance($app); } catch (e) {} }
    }
  }

  function bindShareRarity(card) {
    var btn = document.getElementById("share-rarity");
    if (!btn || !card) return;
    btn.onclick = function () {
      if (window.DreaMintShare && window.DreaMintCert) {
        window.DreaMintShare.shareCopy(window.DreaMintCert.cardToShareData(card));
        return;
      }
      shareRarityCard({
        tier: card.rarity_tier,
        name: (card.model && card.model.name) || card.card_name || card.name || tr("share.card"),
        serial: card.serial_number,
        total: card.serial_total || card.serial_number,
        grade: card.grade,
        grader: card.grader,
        photoUrl: (digitalArt(card) || {}).img || CHARIZARD_ART
      });
    };
  }
  function shareRarityCard(data) {
    var t = tierInfo(data.tier) || TIER_INFO.comune;
    var colors = { comune: "#8a8680", rara: "#3d7cff", epica: "#b46cff", leggendaria: "#e8c872", mitica: "#ff7a3d" };
    var color = colors[t.id] || "#e8c872";
    var c = document.createElement("canvas");
    c.width = 1080; c.height = 1350;
    var g = c.getContext("2d");
    function finish() {
      c.toBlob(function (blob) {
        if (!blob) return;
        var file = new File([blob], "dreamint-" + t.id + ".png", { type: "image/png" });
        var text = tr("share.text", { name: data.name || tr("share.card"), tier: t.label, callout: t.callout });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "DreaMint", text: text }).catch(function () { dl(blob); });
        } else dl(blob);
      }, "image/png");
    }
    function dl(blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "dreamint-" + t.id + ".png";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }
    function paintBg() {
      var grd = g.createLinearGradient(0, 0, 0, 1350);
      if (t.id === "mitica") { grd.addColorStop(0, "#0a0610"); grd.addColorStop(1, "#140810"); }
      else if (t.id === "leggendaria") { grd.addColorStop(0, "#1a1408"); grd.addColorStop(1, "#0c0a06"); }
      else { grd.addColorStop(0, "#141210"); grd.addColorStop(1, "#0a0908"); }
      g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = color; g.globalAlpha = 0.22;
      g.beginPath(); g.arc(540, 520, 380, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      g.fillStyle = "#f8e7b4"; g.textAlign = "center";
      g.font = "650 32px Fraunces, Georgia, serif";
      g.fillText("DreaMint", 540, 96);
    }
    function paintText() {
      g.fillStyle = color;
      g.font = "650 64px Fraunces, Georgia, serif";
      g.fillText((t.badge || t.label).toUpperCase(), 540, 1040);
      g.fillStyle = "#f8e7b4";
      g.font = "600 28px JetBrains Mono, monospace";
      g.fillText(data.name || tr("share.card"), 540, 1100);
      var serial = data.serial ? ("#" + String(data.serial).padStart(4, "0") + "  /  " + (data.total || "∞")) : "";
      if (serial) g.fillText(serial, 540, 1144);
      g.font = "600 22px Inter Tight, sans-serif";
      g.fillText(t.callout, 540, 1196);
    }
    paintBg();
    if (data.photoUrl) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        var w = 560, h = 780, x = 260, y = 140;
        g.save();
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, w, h, 12); else g.rect(x, y, w, h);
        g.clip();
        g.drawImage(img, x, y, w, h);
        g.restore();
        g.lineWidth = t.id === "mitica" || t.id === "leggendaria" ? 10 : 5;
        g.strokeStyle = color;
        g.strokeRect(x, y, w, h);
        paintText();
        finish();
      };
      img.onerror = function () { paintText(); finish(); };
      img.src = data.photoUrl;
    } else { paintText(); finish(); }
  }
  async function boot() {
    captureRef();
    if (window.DreaMintHome) {
      window.DreaMintHome.init({
        tr: tr, esc: esc, state: state, api: api, euros: euros, cardTitle: cardTitle, catalogArt: catalogArt,
        photoImg: photoImg, heroFlipCard: heroFlipCard, langIsEn: langIsEn
      });
    }
    var boot2 = await Promise.all([
      api("config").catch(function () { return null; }),
      api("me").catch(function () { return null; })
    ]);
    if (boot2[0]) state.cfg = Object.assign(state.cfg, boot2[0]);
    state.user = (boot2[1] && boot2[1].user) || null;
    initTheme();
    if (window.DreamintI18n) {
      window.DreamintI18n.init({
        onChange: function () {
          syncThemeToggle();
          render();
        }
      });
      syncThemeToggle();
    }
    window.addEventListener("hashchange", render);
    // Per-route <title>: "<h1> — DreaMint" (home keeps the default title).
    var baseTitle = document.title;
    if (window.MutationObserver && $app) {
      new MutationObserver(function () {
        var h = location.hash || "";
        var h1 = $app.querySelector("h1");
        var txt = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
        document.title = (!h || h === "#" || h === "#/" || !txt) ? baseTitle : (txt.slice(0, 70) + " — DreaMint");
      }).observe($app, { childList: true });
    }
    render();
  }
  boot();
})();
