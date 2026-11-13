/* DreaMint home v2, "Commissioni e abbonamenti" page, launch banner and admin launch panel.
   Only real data: listings from /api/market, recent cards from /api/recent, prices from /api/prices/trend. */
(function (root) {
  "use strict";
  var H = null; // helpers injected by app.js

  function tr(k, v) { return H.tr(k, v); }
  function esc(s) { return H.esc(s); }
  function reduceMotion() { return root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // Hero art: original DreaMint SVGs (no third-party artwork as system decoration, guida-stile §1).
  // Demo graded cards: how a graded card uploaded to DreaMint looks (official TCGdex art + DreaMint rarity frame).
  // Clearly labelled «Esempio»: not real listings. The front card is self-hosted and preloaded (LCP); the others are lazy.
  // Self-hosted 320w webp copies of the official catalog images (TCGdex, OPTCG API, YGOPRODeck).
  var HERO_CARDS = [
    { name: "Charizard", set: "Base Set 4/102 Holo", img: "/img/demo/charizard-base1-4-320.webp", h: 440, tier: "epica", grader: "PSA", grade: "10", serial: "#1386 / 9999", lazy: true },
    { name: "Monkey.D.Luffy SP Gold", set: "OP05-119", img: "/img/demo/luffy-op05-119-sp-gold-320.webp", h: 447, tier: "leggendaria", grader: "PSA", grade: "10", serial: "#4821 / 9999", lazy: false },
    { name: "Dark Magician, the Pharaoh's Servant", set: "MAMO-EN001", img: "/img/demo/dark-magician-pharaohs-servant-mamo-en001-320.webp", h: 466, tier: "rara", grader: "GRAAD", grade: "10", serial: "#7360 / 9999", lazy: true }
  ];
  function heroCardHtml(c, i) {
    var html = H.heroFlipCard({
      name: c.name + " (" + tr("h2.demo") + ")", img: c.img, grader: c.grader, grade: c.grade, code: c.serial, tier: c.tier,
      tierLabel: tr("tier." + c.tier)
    }, i);
    var attrs = ' width="320" height="' + c.h + '" decoding="async"' +
      (c.lazy ? ' loading="lazy" fetchpriority="low"' : ' fetchpriority="high"') + ' alt="' + esc(c.name + " · " + c.set + " · " + c.grader + " " + c.grade + " · " + tr("h2.demo")) + '"';
    html = html.replace('<img class="slab-photo" src="' + c.img + '"', '<img class="slab-photo" src="' + c.img + '"' + attrs).replace(' alt="" onerror=', ' onerror=');
    // a11y: no aria-label on the button (it mismatched the visible text); the name comes from the image alt.
    html = html.replace(/(<button[^>]*?) aria-label="[^"]*"/, "$1");
    return html.replace('<div class="slab-window">', '<div class="slab-window"><span class="hero-demo-tag" aria-hidden="true">' + esc(tr("h2.demo")) + "</span>");
  }
  // Real Pokémon cards used only as data sources for the price chart (no images shown).
  var CHART_CARDS = [
    { id: "charizard", title: "Charizard · Voltaggio Sfolgorante 25/185", q: { game: "pokemon", name: "Charizard", code: "25/185", set_name: "Voltaggio Sfolgorante", language: "ITA", catalog_image: "https://assets.tcgdex.net/it/swsh/swsh4/25/high.webp" } },
    { id: "pikachu", title: "Pikachu · 151 025/165", q: { game: "pokemon", name: "Pikachu", code: "025/165", set_name: "151", language: "ITA", catalog_image: "https://assets.tcgdex.net/it/sv/sv03.5/025/high.webp" } }
  ];
  var TIERS = [
    { id: "comune", pct: "70%" }, { id: "rara", pct: "20%" }, { id: "epica", pct: "8%" },
    { id: "leggendaria", pct: "1,9%" }, { id: "mitica", pct: "0,1%" }
  ];
  var GAMES = ["pokemon", "one_piece", "lorcana", "magic", "yugioh"];

  function kicker(k) { return '<p class="h2k">' + esc(tr(k)) + "</p>"; }
  function soon() { return '<span class="soon-chip">' + esc(tr("u.soon")) + "</span>"; }

  /* ---------- Hero ---------- */
  function hero() {
    var u = H.state.user;
    var cards = HERO_CARDS.map(heroCardHtml).join("");
    return '<section class="h2-hero" aria-labelledby="h2-title">' +
      '<div class="h2-copy">' +
      '<p class="h2k">' + esc(tr("h2.kicker")) + "</p>" +
      '<h1 id="h2-title" class="h2-title">' + esc(tr("h2.title1")) + " <em>" + esc(tr("h2.title2")) + "</em></h1>" +
      '<p class="h2-lede">' + esc(tr("h2.lede")) + "</p>" +
      '<div class="h2-ctas">' +
      '<a class="btn primary" href="#/gradate" data-link>' + esc(tr("h2.ctaMarket")) + "</a>" +
      '<a class="btn secondary" href="#/registra" data-link>' + esc(tr("h2.ctaSell")) + "</a>" +
      '<a class="btn ghost" href="' + (u ? "#/collezione" : "#/registrati") + '" data-link>' + esc(tr("h2.ctaCollect")) + "</a>" +
      "</div>" +
      "</div>" +
      '<div class="h2-stage" data-h2-stage>' +
      '<div class="h2-grid" aria-hidden="true"></div><div class="h2-light" aria-hidden="true"></div>' +
      '<div class="h2-emblem" aria-hidden="true"><img src="/img/fx/dm-icon-128.webp" alt="" width="128" height="128" decoding="async"></div>' +
      '<div class="h2-pads" aria-hidden="true"><i><b></b></i><i><b></b></i><i><b></b></i></div>' +
      '<div class="slab-stage hero-slab"><div class="hero-fan" data-hero-fan role="group" aria-label="' + esc(tr("home.fanAria")) + '">' + cards + "</div></div>" +
      "</div></section>";
  }

  /* ---------- Status ticker ---------- */
  function ticker(market, recent) {
    var n = (market || []).length;
    var items = [
      '<span class="tk-i"><b>' + esc(tr("st.beta")) + "</b></span>",
      '<span class="tk-i">' + esc(tr("st.zero")) + "</span>",
      '<span class="tk-i">' + esc(tr("st.tcg")) + ": Pokémon · One Piece · Lorcana · Magic · Yu-Gi-Oh!</span>",
      '<span class="tk-i">' + esc(tr("st.paypal")) + "</span>",
      '<span class="tk-i">' + esc(tr("st.listings", { n: n })) + "</span>",
      '<span class="tk-i">PSA · BGS · CGC · GRAAD · Vertex · AiGrading</span>'
    ];
    (recent || []).slice(0, 6).forEach(function (it) {
      items.push('<span class="tk-i tk-pull"><em>' + esc(tr("st.recent")) + "</em> " + esc(it.card_name || "") +
        (it.set_name ? " · " + esc(it.set_name) : "") + (it.is_ungraded ? (it.card_condition ? " · " + esc(it.card_condition) : "") : (it.grader ? " · " + esc(it.grader + " " + (it.grade || "")) : "")) + "</span>");
    });
    var row = items.join('<span class="tk-sep" aria-hidden="true">✦</span>');
    return '<section class="h2-ticker" aria-label="' + esc(tr("st.beta")) + '">' +
      '<span class="live-badge"><i aria-hidden="true"></i>' + esc(tr("st.live")) + "</span>" +
      '<div class="tk-viewport"><div class="tk-track">' + row + '<span class="tk-sep" aria-hidden="true">✦</span><span class="tk-dup" aria-hidden="true">' + row + "</span></div></div></section>";
  }

  /* ---------- Due universi ---------- */
  function universes() {
    function li(k) { return "<li>" + esc(tr(k)) + "</li>"; }
    return '<section class="h2-sec h2-uni" aria-labelledby="uni-t">' + kicker("u.kicker") +
      '<h2 id="uni-t" class="h2-h">' + esc(tr("u.title")) + "</h2>" +
      '<div class="uni-grid">' +
      '<article class="uni uni-phys"><div class="uni-ico" aria-hidden="true">' + icoBox() + "</div>" +
      '<p class="uni-tag">' + esc(tr("u.phys.tag")) + "</p><h3>" + esc(tr("u.phys.h")) + "</h3><p>" + esc(tr("u.phys.p")) + "</p>" +
      "<ul>" + li("u.phys.l1") + li("u.phys.l2") + li("u.phys.l3") +
      '<li class="is-soon">' + esc(tr("u.phys.soon1")) + " " + soon() + '</li><li class="is-soon">' + esc(tr("u.phys.soon2")) + " " + soon() + "</li></ul>" +
      '<a class="btn secondary" href="#/non-gradate" data-link>' + esc(tr("u.phys.go")) + "</a></article>" +
      '<article class="uni uni-dig"><div class="uni-ico" aria-hidden="true">' + icoGem() + "</div>" +
      '<p class="uni-tag">' + esc(tr("u.dig.tag")) + "</p><h3>" + esc(tr("u.dig.h")) + "</h3><p>" + esc(tr("u.dig.p")) + "</p>" +
      "<ul>" + li("u.dig.l1") + li("u.dig.l2") + li("u.dig.l3") + "</ul>" +
      '<a class="btn secondary" href="#/gradate" data-link>' + esc(tr("u.dig.go")) + "</a></article>" +
      "</div></section>";
  }
  function icoBox() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>'; }
  function icoGem() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3.5h12l3 5-9 12-9-12 3-5Z"/><path d="M3 8.5h18M9 3.5l3 17 3-17"/></svg>'; }

  /* ---------- Rarity fan ---------- */
  function rarity() {
    var crown = '<svg class="rf-crown" viewBox="0 0 64 44" aria-hidden="true"><defs><linearGradient id="rfcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset=".5" stop-color="#e8c872"/><stop offset="1" stop-color="#a87a1c"/></linearGradient></defs>' +
      '<path d="M6 36 3 12l15 11L32 4l14 19 15-11-3 24Z" fill="url(#rfcg)" stroke="#fff4c2" stroke-width="1.2" stroke-linejoin="round"/><rect x="6" y="36" width="52" height="6" rx="2" fill="url(#rfcg)"/>' +
      '<circle cx="32" cy="4" r="2.6" fill="#fff"/><circle cx="3" cy="12" r="2.2" fill="#fff4c2"/><circle cx="61" cy="12" r="2.2" fill="#fff4c2"/></svg>';
    // Fan order: commons outside, Mitica in the centre under the crown.
    var order = ["comune", "epica", "mitica", "leggendaria", "rara"];
    var cards = order.map(function (id, i) {
      var label = tr("tier." + id);
      var pct = tr("tier." + id + ".pct") || "";
      return '<li class="rf-card" data-tier="' + id + '" style="--i:' + (i - 2) + '" tabindex="0" aria-label="' + esc(label + " " + pct) + '">' +
        (id === "mitica" ? crown : "") +
        '<div class="rf-face"><img class="rf-tex" src="/img/fx/back-' + id + '.webp" alt="" width="280" height="392" loading="lazy" decoding="async">' +
        '<div class="rf-glare" aria-hidden="true"></div>' +
        '<img class="rf-logo" src="/img/fx/dm-icon-128.webp" alt="" width="64" height="64" loading="lazy" decoding="async"></div>' +
        '</li>';
    }).join("");
    return '<section class="h2-sec h2-rarity" aria-labelledby="rar-t"><div class="rf-sky">' + kicker("r.kicker") +
      '<h2 id="rar-t" class="h2-h">' + esc(tr("r.title")) + "</h2>" +
      '<p class="h2-p">' + esc(tr("r.lede")) + "</p>" +
      '<ol class="rf-fan" data-rf-fan>' + cards + '</ol><div class="rf-floor" aria-hidden="true"></div>' +
      '<ul class="rf-legend">' + TIERS.map(function (t) {
        return '<li><span class="rar-chip rar-' + t.id + '">' + esc(tr("tier." + t.id)) + "</span> <b>" + esc(tr("tier." + t.id + ".pct") || t.pct) + "</b></li>";
      }).join("") + "</ul></div>" +
      '<div class="rf-notes"><p class="rf-note">' + icoLock() + "<span>" + esc(tr("r.serverNote")) + "</span></p>" +
      '<p class="rf-note rf-disc">' + icoInfo() + "<span>" + esc(tr("r.disclaimer")) + "</span></p></div>" +
      '<p class="h2-actions"><a class="btn secondary" href="#/demo-reveal/mitica" data-link>' + esc(tr("r.try")) + '</a><a class="btn ghost" href="#/scala" data-link>' + esc(tr("f.rarity")) + "</a></p>" +
      "</section>";
  }
  function icoLock() { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>'; }
  function icoInfo() { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>'; }

  /* ---------- Scanner ---------- */
  function scanner() {
    var steps = [1, 2, 3, 4].map(function (n) {
      return '<li class="sc-step"><span class="sc-n">0' + n + "</span><h3>" + esc(tr("sc.s" + n + ".h")) + "</h3><p>" + esc(tr("sc.s" + n + ".p")) + "</p></li>";
    }).join("");
    return '<section class="h2-sec h2-scan" aria-labelledby="sc-t"><div class="sc-wrap">' +
      '<div class="sc-copy">' + kicker("sc.kicker") + '<h2 id="sc-t" class="h2-h">' + esc(tr("sc.title")) + "</h2>" +
      '<p class="h2-p">' + esc(tr("sc.lede")) + "</p>" +
      '<p class="sc-soon"><span class="soon-chip">' + esc(tr("sc.soonTitle")) + "</span> " + esc(tr("sc.soon")) + "</p>" +
      '<p class="h2-actions"><a class="btn primary" href="#/registra" data-link>' + esc(tr("sc.cta")) + "</a></p></div>" +
      '<div class="sc-visual" aria-hidden="true"><div class="sc-phone"><div class="sc-frame"><img src="/img/cards/marealba.svg" alt="" width="300" height="420" loading="lazy" decoding="async"><i class="sc-beam"></i><b class="c1"></b><b class="c2"></b><b class="c3"></b><b class="c4"></b></div></div></div>' +
      '<ol class="sc-steps">' + steps + "</ol></div></section>";
  }

  /* ---------- Marketplace preview ---------- */
  function marketCard(l) {
    var art = l.is_ungraded ? "" : H.catalogArt(l);
    var thumb = art
      ? '<img src="' + esc(art) + '" alt="" loading="lazy" decoding="async" width="245" height="342">'
      : H.photoImg(l.slab_id, "front", "(max-width:767px) 46vw, 260px");
    var badge = l.is_ungraded
      ? '<span class="mk-badge">' + esc(l.card_condition || tr("mp.raw")) + "</span>"
      : '<span class="mk-badge">' + esc([l.grader, l.grade].filter(Boolean).join(" ")) + "</span>" + (l.rarity_tier ? '<span class="rar-chip rar-' + esc(l.rarity_tier) + '">' + esc(tr("tier." + l.rarity_tier)) + "</span>" : "");
    var trend = (root.DreaMintPrices && l.price_trend) ? root.DreaMintPrices.placeholder({ trend: l.price_trend }, "mk-trend", true) : "";
    return '<a class="mk-card" href="#/annuncio/' + esc(l.id) + "/" + esc(l.slab_id) + '" data-link data-game="' + esc(l.game || "") + '" data-sec="' + (l.is_ungraded ? "raw" : "graded") + '">' +
      '<div class="mk-thumb">' + thumb + '<div class="mk-badges">' + badge + "</div></div>" +
      '<div class="mk-body"><p class="mk-title">' + esc(H.cardTitle(l)) + "</p>" +
      '<p class="mk-meta">' + esc(tr("mp.seller", { name: l.seller_name || "" })) + "</p>" +
      '<p class="mk-price">' + esc(H.euros(l.price_cents)) + "</p>" + trend + "</div></a>";
  }
  function marketPreview(listings, recent) {
    listings = listings || [];
    var graded = listings.filter(function (l) { return !l.is_ungraded; }).length;
    var raw = listings.length - graded;
    var counts = {};
    listings.forEach(function (l) { counts[l.game] = (counts[l.game] || 0) + 1; });
    var stats = '<div class="mk-stats">' +
      stat(tr("mp.statListings"), listings.length) + stat(tr("mp.statGraded"), graded) + stat(tr("mp.statRaw"), raw) + "</div>";
    var chips = '<div class="mk-chips" role="group" aria-label="' + esc(tr("mp.filterGame")) + '">' +
      chip("all", "", tr("mp.all"), listings.length, true) +
      chip("sec", "graded", tr("mp.graded"), graded) + chip("sec", "raw", tr("mp.raw"), raw) +
      GAMES.map(function (g) { return chip("game", g, tr("game." + g), counts[g] || 0); }).join("") + "</div>";
    var body;
    if (!listings.length) {
      body = emptyState(tr("mp.empty.h"), tr("mp.empty.p"), "#/registra", tr("es.cta"));
    } else {
      body = '<div class="mk-grid" data-mk-grid>' + listings.slice(0, 8).map(marketCard).join("") + "</div>" +
        '<p class="mk-nomatch" hidden>' + esc(tr("mp.noMatch")) + "</p>";
    }
    return '<section class="h2-sec h2-market" aria-labelledby="mk-t">' +
      marketBoard(listings, { home: true, limit: 8, recent: recent || [], certified: null,
        titleHtml: kicker("mp.kicker") + '<h2 id="mk-t" class="h2-h">' + esc(tr("mp.title")) + "</h2>",
        emptyHtml: body }) +
      (listings.length ? '<p class="h2-actions"><a class="btn secondary" href="#/gradate" data-link>' + esc(tr("mp.seeAll")) + "</a></p>" : "") +
      "</section>";
  }
  // Clean empty state (no fake/placeholder cards): message + "Vendi una carta" CTA.
  function emptyState(title, text, href, cta) {
    return '<div class="dm-empty" role="status">' +
      '<span class="dm-empty-icon" aria-hidden="true"><img src="/img/fx/dm-icon-128.webp" alt="" width="40" height="40" loading="lazy" decoding="async"></span>' +
      (title ? "<h3>" + esc(title) + "</h3>" : "") + (text ? "<p>" + esc(text) + "</p>" : "") +
      '<a class="btn primary" href="' + esc(href || "#/registra") + '" data-link>' + esc(cta || tr("es.cta")) + "</a></div>";
  }
  function stat(label, n) { return '<div class="mk-stat"><strong>' + esc(String(n)) + "</strong><span>" + esc(label) + "</span></div>"; }
  function chip(kind, val, label, n, on) {
    return '<button type="button" class="mk-chip' + (on ? " on" : "") + '" aria-pressed="' + (on ? "true" : "false") + '" data-f="' + kind + '" data-v="' + esc(val) + '"' + (n ? "" : " disabled") + ">" +
      esc(label) + ' <span class="mk-n">' + n + "</span></button>";
  }


  /* ---------- Marketplace board (ref3): stats, ticker, chips, sort, slab grid ---------- */
  function boardCard(l) {
    var thumb = H.photoImg(l.slab_id, "front", "(max-width:767px) 46vw, 230px");
    var badge = l.is_ungraded ? (l.card_condition || tr("mp.raw")) : [l.grader, l.grade].filter(Boolean).join(" ");
    var tier = (!l.is_ungraded && l.rarity_tier) ? '<span class="rar-chip rar-' + esc(l.rarity_tier) + ' mb-tier">' + esc(tr("tier." + l.rarity_tier)) + "</span>" : "";
    var ref = l.price_trend && l.price_trend.last_cents;
    var chg = "";
    if (ref && l.price_cents) {
      var pct = (l.price_cents - ref) / ref * 100;
      var sign = pct > 0 ? "+" : "";
      chg = '<span class="mb-chg ' + (pct > 0 ? "is-above" : "is-below") + '">' + esc(sign + pct.toFixed(1).replace(".", H.langIsEn() ? "." : ",") + "% " + tr("mb.vsCm")) + "</span>";
    }
    var meta = [l.set_name, l.code_printed].filter(Boolean).join(" · ");
    var ts = Date.parse(l.created_at || "") || 0;
    var offer = (window.DreaMintTradeV9 && window.DreaMintTradeV9.offerKind) ? window.DreaMintTradeV9.offerKind(l) : "";
    return '<a class="mb-card" href="#/annuncio/' + esc(l.id) + "/" + esc(l.slab_id) + '" data-link data-game="' + esc(l.game || "") + '" data-sec="' + (l.is_ungraded ? "raw" : "graded") +
      '" data-offer="' + esc(offer) + '" data-split="' + (l.digital_owned_by_other ? "1" : "0") +
      '" data-price="' + (Number(l.price_cents) || 0) + '" data-ts="' + ts + '" data-name="' + esc(String(H.cardTitle(l) || "").toLowerCase()) + '">' +
      '<div class="mb-photo">' + thumb + '<span class="mb-grade">' + esc(badge) + "</span>" + tier + "</div>" +
      '<div class="mb-body"><p class="mb-title">' + esc(H.cardTitle(l)) + (l.is_test ? ' <span class="pill pill-test">TEST</span>' : "") +
      ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? " " + window.DreaMintTradeV9.offerBadgeHtml(l) : "") + "</p>" +
      '<p class="mb-meta">' + esc(meta) + "</p>" +
      '<p class="mb-row"><strong class="mb-price">' + esc(H.euros(l.price_cents)) + "</strong>" + chg + "</p>" +
      '<p class="mb-seller">' + esc(tr("mp.seller", { name: l.seller_name || l.seller_username || "" })) + "</p>" +
      ((window.DreaMintTradeV9 && window.DreaMintTradeV9.on()) ? window.DreaMintTradeV9.physicalSplitNoteHtml(l) : "") +
      "</div></a>";
  }
  function boardTicker(listings, recent) {
    var items = [];
    (recent || []).slice(0, 8).forEach(function (r) {
      var g = r.is_ungraded ? (r.card_condition || "") : [r.grader, r.grade].filter(function (x) { return x && x !== "NONE"; }).join(" ");
      items.push('<span class="mb-tk"><em>' + esc(tr(r.is_ungraded ? "mb.newRaw" : "mb.pulled")) + "</em> " + esc(r.card_name || "") + (g ? " · " + esc(g) : "") + "</span>");
    });
    (listings || []).slice(0, 8).forEach(function (l) {
      items.push('<span class="mb-tk"><em class="is-listed">' + esc(tr("mb.listed")) + "</em> " + esc(l.card_name || H.cardTitle(l)) + " · <b>" + esc(H.euros(l.price_cents)) + "</b></span>");
    });
    if (!items.length) items.push('<span class="mb-tk">' + esc(tr("mb.tkEmpty")) + "</span>");
    var run = items.join("");
    return '<div class="mb-ticker" aria-label="' + esc(tr("mb.tkLabel")) + '"><span class="mb-tk-h"><i aria-hidden="true"></i>' + esc(tr("mb.tkLabel")) + "</span>" +
      '<div class="mb-tk-vp"><div class="mb-tk-run' + (items.length > 2 ? " is-moving" : "") + '">' + run + '<span aria-hidden="true" class="mb-tk-dup">' + run + "</span></div></div></div>";
  }
  var lastBoardListings = [];
  function marketBoard(listings, opts) {
    opts = opts || {};
    listings = listings || [];
    lastBoardListings = listings;
    var counts = {};
    listings.forEach(function (l) { counts[l.game] = (counts[l.game] || 0) + 1; });
    var graded = listings.filter(function (l) { return !l.is_ungraded; }).length;
    var floor = listings.reduce(function (m, l) { var p = Number(l.price_cents) || 0; return p && (m === null || p < m) ? p : m; }, null);
    var stats = '<div class="mb-stats">' +
      '<div class="mb-stat"><span>' + esc(tr("mb.certified")) + '</span><strong data-mb-certified>' + (opts.certified != null ? esc(String(opts.certified)) : "—") + "</strong></div>" +
      '<div class="mb-stat"><span>' + esc(tr("mb.listedNow")) + "</span><strong>" + listings.length + "</strong></div>" +
      '<div class="mb-stat"><span>' + esc(tr("mb.floor")) + "</span><strong>" + (floor ? esc(H.euros(floor)) : "—") + "</strong></div></div>";
    var gameChips = '<button type="button" class="mb-chip on" aria-pressed="true" data-f="all" data-v="">' + esc(tr("mp.all")) + ' <span>' + listings.length + "</span></button>" +
      (opts.home ? '<button type="button" class="mb-chip" aria-pressed="false" data-f="sec" data-v="graded"' + (graded ? "" : " disabled") + ">" + esc(tr("mp.graded")) + " <span>" + graded + "</span></button>" +
        '<button type="button" class="mb-chip" aria-pressed="false" data-f="sec" data-v="raw"' + (listings.length - graded ? "" : " disabled") + ">" + esc(tr("mp.raw")) + " <span>" + (listings.length - graded) + "</span></button>" : "") +
      GAMES.map(function (g) {
        var n = counts[g] || 0;
        return '<button type="button" class="mb-chip" aria-pressed="false" data-f="game" data-v="' + g + '"' + (n ? "" : " disabled") + ">" + esc(tr("game." + g)) + " <span>" + n + "</span></button>";
      }).join("");
    var sorts = [["recent", "mb.sortRecent"], ["price-asc", "mb.sortUp"], ["price-desc", "mb.sortDown"], ["name", "mb.sortName"]].map(function (s, i) {
      return '<button type="button" class="mb-sort' + (i ? "" : " on") + '" aria-pressed="' + (i ? "false" : "true") + '" data-sort="' + s[0] + '">' + esc(tr(s[1])) + "</button>";
    }).join("");
    var head = '<div class="mb-head"><div>' + (opts.titleHtml || "") + "</div>" + stats + "</div>" + boardTicker(listings, opts.recent);
    var tools = '<div class="mb-tools"><div class="mb-sorts" role="group" aria-label="' + esc(tr("mb.sortLabel")) + '">' + sorts + "</div>" +
      '<div class="mb-chips" role="group" aria-label="' + esc(tr("mp.filterGame")) + '">' + gameChips + "</div></div>";
    var list = opts.limit ? listings.slice(0, opts.limit) : listings;
    var grid = listings.length
      ? '<div class="mb-grid" data-mb-grid>' + list.map(boardCard).join("") + '</div><p class="mk-nomatch" hidden>' + esc(tr("mp.noMatch")) + "</p>"
      : (opts.emptyHtml || "");
    return '<div class="mb-board" data-mb-board' + (opts.recent ? "" : " data-mb-need-recent") + ">" + head + (listings.length ? tools : "") + grid + "</div>";
  }
  function bindMarketBoard(scope) {
    var board = scope && scope.querySelector("[data-mb-board]");
    if (!board || board._mbBound) return;
    board._mbBound = true;
    var grid = board.querySelector("[data-mb-grid]");
    var state = { f: "all", v: "" };
    function apply() {
      if (!grid) return;
      var shown = 0;
      grid.querySelectorAll(".mb-card").forEach(function (c) {
        var ok = state.f === "all" || (state.f === "sec" && c.getAttribute("data-sec") === state.v) || (state.f === "game" && c.getAttribute("data-game") === state.v);
        c.hidden = !ok; if (ok) shown++;
      });
      var nm = board.querySelector(".mk-nomatch"); if (nm) nm.hidden = shown > 0;
    }
    board.addEventListener("click", function (e) {
      var chip = e.target.closest(".mb-chip");
      if (chip && !chip.disabled) {
        board.querySelectorAll(".mb-chip").forEach(function (x) { x.classList.toggle("on", x === chip); x.setAttribute("aria-pressed", x === chip ? "true" : "false"); });
        state.f = chip.getAttribute("data-f"); state.v = chip.getAttribute("data-v"); apply(); return;
      }
      var srt = e.target.closest(".mb-sort");
      if (srt && grid) {
        board.querySelectorAll(".mb-sort").forEach(function (x) { x.classList.toggle("on", x === srt); x.setAttribute("aria-pressed", x === srt ? "true" : "false"); });
        var k = srt.getAttribute("data-sort");
        var cards = Array.prototype.slice.call(grid.querySelectorAll(".mb-card"));
        cards.sort(function (a, b) {
          if (k === "price-asc") return a.dataset.price - b.dataset.price;
          if (k === "price-desc") return b.dataset.price - a.dataset.price;
          if (k === "name") return a.dataset.name.localeCompare(b.dataset.name);
          return b.dataset.ts - a.dataset.ts;
        });
        cards.forEach(function (c) { grid.appendChild(c); });
      }
    });
    var cert = board.querySelector("[data-mb-certified]");
    if (cert && cert.textContent === "—" && H.api) H.api("stats").then(function (d) { if (d && d.certified != null) cert.textContent = String(d.certified); }).catch(function () {});
    if (board.hasAttribute("data-mb-need-recent") && H.api) {
      H.api("recent").then(function (d) {
        var tk = board.querySelector(".mb-ticker");
        if (!tk || !d || !d.items || !d.items.length) return;
        var tmp = document.createElement("div");
        tmp.innerHTML = boardTicker(lastBoardListings, d.items);
        tk.replaceWith(tmp.firstChild);
      }).catch(function () {});
    }
    if (root.DreaMintPrices) root.DreaMintPrices.enhance(board);
  }

  /* ---------- Price chart ---------- */
  function chartSection(listings) {
    var opts = CHART_CARDS.map(function (c, i) {
      return '<button type="button" class="mk-chip' + (i ? "" : " on") + '" aria-pressed="' + (i ? "false" : "true") + '" data-chart-card="' + c.id + '">' + esc(c.title) + "</button>";
    }).join("");
    var first = CHART_CARDS[0];
    var q = Object.keys(first.q).map(function (k) { return k + "=" + encodeURIComponent(first.q[k]); }).join("&");
    return '<section class="h2-sec h2-chart" aria-labelledby="ch-t"><div class="ch-wrap"><div class="ch-copy">' + kicker("ch.kicker") +
      '<h2 id="ch-t" class="h2-h">' + esc(tr("ch.title")) + "</h2><p class=\"h2-p\">" + esc(tr("ch.lede")) + "</p>" +
      '<p class="ch-note">' + esc(tr("ch.verifiedSoon")) + "</p></div>" +
      '<div class="ch-panel"><div class="mk-chips ch-pick" role="group" aria-label="' + esc(tr("ch.kicker")) + '">' + opts + "</div>" +
      '<div class="price-trend ch-main" data-price-query="' + esc(q) + '" data-title="' + esc(first.title) + '"></div></div></div></section>';
  }

  /* ---------- Collezioni & social ---------- */
  function collections() {
    var items = [
      ["c1", true, "#/collezione"], ["c2", true, ""], ["c3", true, ""], ["c4", true, ""], ["c5", false, ""], ["c6", false, ""]
    ];
    return '<section class="h2-sec h2-coll" aria-labelledby="cs-t">' + kicker("cs.kicker") +
      '<h2 id="cs-t" class="h2-h">' + esc(tr("cs.title")) + "</h2>" +
      '<ul class="cs-grid">' + items.map(function (it) {
        return '<li class="cs-item' + (it[1] ? "" : " is-soon") + '"><span class="' + (it[1] ? "live-chip" : "soon-chip") + '">' + esc(it[1] ? tr("cs.live") : tr("u.soon")) + "</span>" +
          "<h3>" + esc(tr("cs." + it[0] + ".h")) + "</h3><p>" + esc(tr("cs." + it[0] + ".p")) + "</p></li>";
      }).join("") + "</ul>" +
      '<p class="h2-actions"><a class="btn primary" href="' + (H.state.user ? "#/collezione" : "#/registrati") + '" data-link>' + esc(tr("cs.cta")) + "</a></p></section>";
  }

  /* ---------- Plans (visible on home, not buried at the bottom) ---------- */
  function launchStateOf(cfg) {
    var L = (cfg && cfg.launch) || {};
    return L.effective_state || L.state || "BETA";
  }
  function isMonetized(cfg) {
    return launchStateOf(cfg) === "MONETIZATION_ENABLED";
  }
  function planActionHtml(cfg) {
    if (isMonetized(cfg)) {
      return '<button type="button" class="btn primary fp-act" data-plan-activate>' + esc(tr("fee.activate")) + "</button>";
    }
    return '<button type="button" class="btn fp-act" data-plan-locked disabled>' + esc(tr("fee.activateLater")) + "</button>";
  }
  function adminFeesBtn() {
    var u = H.state && H.state.user;
    if (!u || u.role !== "admin") return "";
    return '<p class="fee-admin"><a class="btn ghost fee-admin-btn" href="#/admin/lancio" data-link>' + esc(tr("al.manage")) + "</a></p>";
  }
  function planCardsHtml(cfg) {
    var plans = plansOf(cfg);
    var pdesc = { free: "fee.free.p", pro: "fee.pro.p", business: "fee.biz.p" };
    return '<div class="fp-grid">' + plans.map(function (p) {
      var isPro = p.id === "pro";
      var rec = isPro ? '<p class="fp-rec">' + esc(tr("fee.recommended")) + "</p>" : "";
      return '<article class="fp-card fp-' + esc(p.id) + (isPro ? " is-recommended" : "") + '">' + rec +
        '<p class="fp-name">' + esc(p.label) + "</p>" +
        '<p class="fp-price"><strong>' + esc(money(p.monthly_cents)) + "</strong><span>" + esc(tr("fee.month")) + "</span></p>" +
        '<p class="fp-rate"><strong>' + esc(pctText(p.fee_bps)) + "</strong> " + esc(tr("fee.onSale")) + "</p>" +
        '<p class="fp-desc">' + esc(tr(pdesc[p.id] || "")) + "</p>" +
        (isMonetized(cfg) ? "" : '<span class="soon-chip">' + esc(tr("fee.futureBadge")) + "</span>") +
        planActionHtml(cfg) + "</article>";
    }).join("") + "</div>" +
      '<p class="notice" id="plan-activate-notice" hidden role="status"></p>';
  }
  function bindPlanActions(scope) {
    if (!scope) return;
    var notice = scope.querySelector("#plan-activate-notice");
    scope.querySelectorAll("[data-plan-activate]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!notice) {
          notice = scope.querySelector("#plan-activate-notice");
        }
        if (!notice) {
          notice = document.createElement("p");
          notice.id = "plan-activate-notice";
          notice.className = "notice";
          notice.setAttribute("role", "status");
          var sec = btn.closest("section") || scope;
          sec.appendChild(notice);
        }
        notice.hidden = false;
        notice.textContent = tr("fee.activateNotice");
        try { notice.scrollIntoView({ block: "nearest" }); } catch (e) {}
      });
    });
  }
  function homePlans(cfg) {
    cfg = cfg || (H.state && H.state.cfg) || {};
    return '<section class="h2-sec h2-plans" id="piani" aria-labelledby="hp-t">' +
      kicker("home.plans.kicker") +
      '<h2 id="hp-t" class="h2-h">' + esc(tr("home.plans.title")) + "</h2>" +
      '<p class="h2-p">' + esc(tr("home.plans.p")) + "</p>" +
      '<p class="fee-banner home-plans-badge">' + esc(tr("home.plans.badge")) + "</p>" +
      planCardsHtml(cfg) +
      '<p class="h2-actions"><a class="btn primary" href="#/commissioni" data-link>' + esc(tr("home.plans.cta")) + "</a></p>" +
      "</section>";
  }
  function launchTeaser() {
    return '<section class="h2-sec h2-launch" aria-labelledby="ls-t"><div class="ls-card">' + kicker("ls.kicker") +
      '<h2 id="ls-t" class="h2-h">' + esc(tr("ls.title")) + "</h2><p>" + esc(tr("ls.p")) + "</p>" +
      '<p class="ls-paypal">' + esc(tr("lb.paypal")) + "</p>" +
      '<p class="h2-actions"><a class="btn primary" href="#/commissioni" data-link>' + esc(tr("ls.cta")) + "</a></p></div></section>";
  }

  function homeHtml(data) {
    data = data || {};
    var cfg = (H.state && H.state.cfg) || {};
    return '<div class="home-v2">' + hero() + ticker(data.market, data.recent) + universes() + homePlans(cfg) + rarity() + scanner() +
      marketPreview(data.market, data.recent) + chartSection(data.market) + collections() + "</div>";
  }

  /* ---------- Bindings ---------- */
  function lowPower() {
    var n = navigator, c = n.connection || {};
    return !!(c.saveData || (n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2));
  }
  function bindHome(scope) {
    try { scope.querySelectorAll('.hero-card .slab-label, .hero-card .slab-tier-chip').forEach(function (n) { n.setAttribute('aria-hidden', 'true'); }); } catch (e) {}
    bindPlanActions(scope);
    var rm = reduceMotion();
    if (lowPower()) document.documentElement.classList.add("lowfx");
    var stage = scope.querySelector("[data-h2-stage]");
    if (stage && !rm) {
      var raf = 0, lx = 50, ly = 40;
      stage.addEventListener("pointermove", function (e) {
        var r = stage.getBoundingClientRect();
        lx = ((e.clientX - r.left) / Math.max(1, r.width)) * 100;
        ly = ((e.clientY - r.top) / Math.max(1, r.height)) * 100;
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; stage.style.setProperty("--lx", lx.toFixed(1) + "%"); stage.style.setProperty("--ly", ly.toFixed(1) + "%"); });
      });
      if (root.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== "function") {
        root.addEventListener("deviceorientation", function onO(e) {
          if (!stage.isConnected) { root.removeEventListener("deviceorientation", onO); return; }
          var gx = Math.max(-30, Math.min(30, e.gamma || 0)), gy = Math.max(-30, Math.min(30, (e.beta || 40) - 40));
          stage.style.setProperty("--lx", (50 + gx * 1.4).toFixed(1) + "%");
          stage.style.setProperty("--ly", (40 + gy * 1.2).toFixed(1) + "%");
        }, { passive: true });
      }
    }
    // rarity fan: pointer glare
    scope.querySelectorAll(".rf-card").forEach(function (c) {
      if (rm) return;
      c.addEventListener("pointermove", function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty("--gx", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
        c.style.setProperty("--gy", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
      });
    });
    bindMarketBoard(scope);
    // market chips (legacy preview)
    var grid = scope.querySelector("[data-mk-grid]");
    var chipsWrap = scope.querySelector(".h2-market .mk-chips");
    if (chipsWrap) chipsWrap.addEventListener("click", function (e) {
      var b = e.target.closest(".mk-chip");
      if (!b || b.disabled) return;
      chipsWrap.querySelectorAll(".mk-chip").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      if (!grid) return;
      var f = b.getAttribute("data-f"), v = b.getAttribute("data-v"), shown = 0;
      grid.querySelectorAll(".mk-card").forEach(function (card) {
        var ok = f === "all" || (f === "sec" && card.getAttribute("data-sec") === v) || (f === "game" && card.getAttribute("data-game") === v);
        card.hidden = !ok; if (ok) shown++;
      });
      var nm = scope.querySelector(".mk-nomatch"); if (nm) nm.hidden = shown > 0;
    });
    // chart card picker
    var pick = scope.querySelector(".ch-pick");
    var main = scope.querySelector(".ch-main");
    if (pick && main) pick.addEventListener("click", function (e) {
      var b = e.target.closest("[data-chart-card]");
      if (!b) return;
      var c = CHART_CARDS.filter(function (x) { return x.id === b.getAttribute("data-chart-card"); })[0];
      if (!c) return;
      pick.querySelectorAll("[data-chart-card]").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      var period = main.getAttribute("data-period") || "30";
      main.setAttribute("data-period", period);
      root.DreaMintPrices.mount(main, c.q, { title: c.title });
    });
    // Lazy-mount price widgets when near the viewport
    if (root.DreaMintPrices) {
      var lazy = scope.querySelectorAll(".h2-chart .price-trend");
      if ("IntersectionObserver" in root) {
        var mounted = false;
        var mountAll = function () {
          if (mounted) return; mounted = true;
          if (io) io.disconnect();
          root.DreaMintPrices.enhance(scope.querySelector(".h2-chart") || scope);
        };
        var io = new IntersectionObserver(function (entries) {
          if (entries.some(function (en) { return en.isIntersecting; })) mountAll();
        }, { rootMargin: "400px" });
        lazy.forEach(function (el) { io.observe(el); });
        // Idle fallback: load the chart after first paint even if never scrolled to
        setTimeout(function () { (root.requestIdleCallback || function (f) { f(); })(mountAll); }, 3500);
      } else root.DreaMintPrices.enhance(scope);
      root.DreaMintPrices.enhance(scope.querySelector(".h2-market") || document.createElement("div"));
    }
  }

  /* ---------- Launch banner ---------- */
  function fmtRemaining(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d > 0 ? tr("lb.days", { d: d, h: h }) : tr("lb.hours", { h: h, m: m % 60 });
  }
  function bannerHtml(cfg) {
    var L = (cfg && cfg.launch) || { effective_state: "BETA" };
    var st = L.effective_state || L.state || "BETA";
    var text, note = tr("lb.paypal");
    if (st === "LAUNCH_PROMO" && L.remaining_ms != null) text = tr("lb.promo", { time: fmtRemaining(L.remaining_ms) });
    else if (st === "PROMO_ENDED") { text = tr("lb.promoEnded"); note = tr("lb.promoEndedNote") + " " + tr("lb.paypal"); }
    else if (st === "MONETIZATION_ENABLED") text = tr("lb.monet");
    else text = tr("lb.beta");
    return '<span class="lb-badge">' + esc(st === "BETA" ? "Beta" : (st === "LAUNCH_PROMO" ? "0%" : "DreaMint")) + "</span>" +
      '<span class="lb-text">' + esc(text) + "</span>" +
      '<a class="lb-cta" href="#/commissioni" data-link>' + esc(tr("lb.cta")) + "</a>" +
      '<span class="lb-note">' + esc(note) + "</span>";
  }

  /* ---------- Commissioni page ---------- */
  function money(cents) {
    try { return new Intl.NumberFormat(H.langIsEn() ? "en-IE" : "it-IT", { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100); }
    catch (e) { return H.euros(cents); }
  }
  // Tolerant amount parser: "12,5" → 12.5, "1.234,56" → 1234.56, "1,234.56" → 1234.56, "1.000" → 1000, "€ 50" → 50.
  function parseAmount(raw) {
    var t = String(raw == null ? "" : raw).replace(/[\s\u00a0€]/g, "").replace(/^\+/, "");
    if (!t) return { v: 0, empty: true };
    var neg = /^-/.test(t); t = t.replace(/^-/, "");
    var lastC = t.lastIndexOf(","), lastD = t.lastIndexOf(".");
    if (lastC > -1 && lastD > -1) {
      var dec = lastC > lastD ? "," : ".";
      t = t.split(dec === "," ? "." : ",").join("").replace(dec, ".");
    } else if (lastC > -1) {
      t = /^\d{1,3}(,\d{3}){2,}$/.test(t) ? t.split(",").join("") : t.replace(/,(?=[^,]*$)/, ".").split(",").join("");
    } else if (lastD > -1 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.split(".").join("");
    }
    if (!/^\d*\.?\d*$/.test(t) || t === ".") return { v: 0, invalid: true };
    var n = Number(t);
    if (!Number.isFinite(n)) return { v: 0, invalid: true };
    return { v: n, neg: neg };
  }
  function pctText(bps) { var s = (bps / 100).toFixed(1).replace(/\.0$/, ""); return (H.langIsEn() ? s : s.replace(".", ",")) + "%"; }
  function plansOf(cfg) {
    return (cfg && cfg.plans && cfg.plans.length) ? cfg.plans : [
      { id: "free", label: "FREE", monthly_cents: 0, fee_bps: 250 },
      { id: "pro", label: "PRO", monthly_cents: 990, fee_bps: 200 },
      { id: "business", label: "BUSINESS", monthly_cents: 2990, fee_bps: 150 }
    ];
  }
  function commissioniHtml(cfg) {
    var plans = plansOf(cfg);
    var L = (cfg && cfg.launch) || { effective_state: "BETA" };
    var st = L.effective_state || "BETA";
    var endDate = L.promo_end ? new Date(L.promo_end).toLocaleDateString(H.langIsEn() ? "en-GB" : "it-IT", { day: "numeric", month: "long", year: "numeric" }) : "";
    var cards = planCardsHtml(cfg);
    var rules = [1, 2, 3, 4, 5, 6].map(function (n) { return "<li>" + esc(tr("fee.rule" + n)) + "</li>"; }).join("");
    var cmpRows = [
      [tr("fee.cmp.monthly"), plans.map(function (p) { return money(p.monthly_cents) + tr("fee.month"); })],
      [tr("fee.cmp.rate"), plans.map(function (p) { return pctText(p.fee_bps); })],
      [tr("fee.cmp.fixed"), plans.map(function () { return tr("fee.cmp.none"); })],
      [tr("fee.cmp.shipping"), plans.map(function () { return tr("fee.cmp.none"); })],
      [tr("fee.cmp.paypal"), plans.map(function () { return tr("fee.cmp.separate"); })]
    ];
    var table = '<div class="fp-tablewrap" role="region" tabindex="0" aria-label="' + esc(tr("fee.cmp.h")) + '"><table class="fp-table"><caption class="sr-only">' + esc(tr("fee.cmp.h")) + "</caption><thead><tr><th scope=\"col\"><span class=\"sr-only\">" + esc(tr("fee.calc.plan")) + "</span></th>" +
      plans.map(function (p) { return '<th scope="col">' + esc(p.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      cmpRows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + "</th>" + r[1].map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
    var stateText = tr("fee.state." + st, { date: endDate });
    return '<div class="home-v2 fee-page">' +
      '<section class="h2-sec fee-hero">' + kicker("fee.kicker") + '<h1 class="h2-h fee-h1">' + esc(tr("fee.title")) + "</h1>" +
      '<p class="h2-p">' + esc(tr("fee.lede")) + "</p>" +
      '<p class="fee-state"><span class="live-badge"><i aria-hidden="true"></i>' + esc(tr("fee.state.h")) + "</span> " + esc(stateText) + "</p>" +
      '<p class="fee-banner">' + esc(tr("lb.beta")) + "</p></section>" +
      '<section class="h2-sec">' + adminFeesBtn() + '<p class="fee-future"><span class="soon-chip">' + esc(tr("fee.futureBadge")) + "</span></p>" +
      cards + "</section>" +
      '<section class="h2-sec fee-cols"><div class="fee-rules"><h2 class="h2-h3">' + esc(tr("fee.rules.h")) + "</h2><ul>" + rules + "</ul>" +
      '<p class="fee-example">' + esc(tr("fee.example")) + "</p>" +
      '<p><a href="/legal/regolamento-lancio">' + esc(tr("fee.rules.link")) + "</a> · <a href=\"/legal/termini\">" + esc(tr("footer.terms")) + "</a></p></div>" +
      '<div class="fee-calc"><h2 class="h2-h3">' + esc(tr("fee.calc.h")) + "</h2><p class=\"muted\">" + esc(tr("fee.calc.p")) + "</p>" +
      '<label class="field" for="fee-amount">' + esc(tr("fee.calc.amount")) + '<input id="fee-amount" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" lang="' + (H.langIsEn() ? "en" : "it") + '" value="2500" aria-describedby="fee-amount-hint"></label>' +
      '<p class="muted fee-hint" id="fee-amount-hint">' + esc(tr("fee.calc.hint")) + "</p>" +
      '<input id="fee-range" type="range" min="0" max="5000" step="10" value="2500" aria-label="' + esc(tr("fee.calc.amount")) + '">' +
      '<div class="fee-out" id="fee-out" aria-live="polite" role="region" tabindex="0" aria-label="' + esc(tr("fee.calc.h")) + '"></div>' +
      '<p class="fee-beta-now">' + esc(tr("fee.calc.beta")) + "</p></div></section>" +
      '<section class="h2-sec"><h2 class="h2-h3">' + esc(tr("fee.cmp.h")) + "</h2>" + table + "</section></div>";
  }
  function bindCommissioni(scope, cfg) {
    var plans = plansOf(cfg);
    var amt = scope.querySelector("#fee-amount"), rng = scope.querySelector("#fee-range"), out = scope.querySelector("#fee-out");
    if (!amt || !out) return;
    function breakEven(a, b) {
      var diff = (a.fee_bps - b.fee_bps) / 10000;
      if (diff <= 0) return null;
      return Math.ceil((b.monthly_cents - a.monthly_cents) / diff);
    }
    function calc() {
      var parsed = parseAmount(amt.value);
      var v = parsed.neg ? 0 : Math.max(0, Math.min(1000000, parsed.v));
      amt.setAttribute("aria-invalid", parsed.invalid ? "true" : "false");
      var cents = Math.round(v * 100);
      var rows = plans.map(function (p) {
        var fee = Math.round(cents * p.fee_bps / 10000);
        return { p: p, fee: fee, total: fee + p.monthly_cents, net: cents - fee - p.monthly_cents };
      });
      var minTotal = Math.min.apply(null, rows.map(function (r) { return r.total; }));
      var winners = rows.filter(function (r) { return r.total === minTotal; });
      var best = winners.length === 1 ? winners[0] : null;
      var tie = winners.length > 1 && cents > 0;
      var labFee = esc(tr("fee.calc.fee")), labSub = esc(tr("fee.calc.sub")), labTot = esc(tr("fee.calc.total")), labNet = esc(tr("fee.calc.net"));
      var html = '<table class="fee-res"><thead><tr><th scope="col">' + esc(tr("fee.calc.plan")) + '</th><th scope="col">' + labFee + '</th><th scope="col">' + labSub + '</th><th scope="col">' + labTot + '</th><th scope="col">' + labNet + "</th></tr></thead><tbody>" +
        rows.map(function (r) {
          var isTie = tie && winners.indexOf(r) > -1;
          var chip = r === best ? ' <span class="best-chip">' + esc(tr("fee.calc.best")) + "</span>" : (isTie ? ' <span class="best-chip">' + esc(tr("fee.calc.tie")) + "</span>" : "");
          return "<tr" + (r === best || isTie ? ' class="best"' : "") + '><th scope="row">' + esc(r.p.label) + chip + "</th>" +
            '<td data-label="' + labFee + '">' + esc(money(r.fee)) + "</td>" +
            '<td data-label="' + labSub + '">' + esc(money(r.p.monthly_cents)) + "</td>" +
            '<td data-label="' + labTot + '"><b>' + esc(money(r.total)) + "</b></td>" +
            '<td data-label="' + labNet + '">' + esc(money(r.net)) + "</td></tr>";
        }).join("") + "</tbody></table>";
      var be1 = plans[1] ? breakEven(plans[0], plans[1]) : null;
      var be2 = plans[2] ? breakEven(plans[1], plans[2]) : null;
      if (be1) html += '<p class="muted fee-be">' + esc(tr("fee.calc.breakPro", { amount: money(be1) })) + "</p>";
      if (be2) html += '<p class="muted fee-be">' + esc(tr("fee.calc.breakBiz", { amount: money(be2) })) + "</p>";
      out.innerHTML = html;
    }
    function fmtInput(v) { var s2 = String(Math.round(v * 100) / 100); return H.langIsEn() ? s2 : s2.replace(".", ","); }
    amt.addEventListener("input", function () { var p2 = parseAmount(amt.value); if (rng) rng.value = String(Math.min(5000, p2.neg ? 0 : p2.v)); calc(); });
    amt.addEventListener("change", function () {
      var p3 = parseAmount(amt.value);
      if (p3.empty) return;
      var v3 = p3.invalid || p3.neg ? 0 : Math.min(1000000, p3.v);
      amt.value = fmtInput(v3); calc();
    });
    if (rng) rng.addEventListener("input", function () { amt.value = fmtInput(Number(rng.value)); calc(); });
    calc();
    bindPlanActions(scope);
  }

  /* ---------- Admin: launch state ---------- */
  function fmtDT(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(H.langIsEn() ? "en-GB" : "it-IT", { timeZone: "Europe/Rome", dateStyle: "medium", timeStyle: "short" }) + " (Roma)"; } catch (e) { return iso; }
  }
  function adminLaunchHtml(d) {
    var L = d.launch || {};
    var opts = (d.allowed || []).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("");
    return '<div class="page-head"><div><h1>' + esc(tr("al.title")) + "</h1><p>" + esc(tr("al.lede")) + "</p></div>" +
      '<a class="btn ghost" href="#/admin" data-link>Admin</a></div>' +
      '<section class="panel al-panel"><dl class="al-dl">' +
      "<dt>" + esc(tr("al.current")) + '</dt><dd><b class="al-state">' + esc(L.state || "BETA") + "</b></dd>" +
      "<dt>" + esc(tr("al.effective")) + "</dt><dd>" + esc(L.effective_state || L.state || "BETA") + "</dd>" +
      "<dt>" + esc(tr("al.serverNow")) + "</dt><dd>" + esc(fmtDT(L.server_now)) + "</dd>" +
      (L.promo_start ? "<dt>Promo</dt><dd>" + esc(tr("al.promo", { start: fmtDT(L.promo_start), end: fmtDT(L.promo_end) })) + "</dd>" : "") +
      "</dl>" +
      (opts ? '<form id="al-form" class="al-form"><label class="field">' + esc(tr("al.to")) + '<select name="to" required>' + opts + "</select></label>" +
        '<label class="field">' + esc(tr("al.confirm", { phrase: d.confirm_phrase || "CONFERMO" })) + '<input name="confirm" required autocomplete="off" spellcheck="false"></label>' +
        '<label class="field">' + esc(tr("al.note")) + '<input name="note" maxlength="300"></label>' +
        '<button class="btn primary" type="submit">' + esc(tr("al.submit")) + "</button></form>" : "<p class=\"muted\">" + esc(tr("al.none")) + "</p>") +
      '<p class="error" id="al-err" hidden></p><p class="ok" id="al-ok" hidden></p></section>' +
      '<section class="panel"><h2>' + esc(tr("al.log")) + "</h2>" +
      ((d.log || []).length ? '<ul class="al-log">' + d.log.map(function (r) {
        return "<li><b>" + esc(r.from_state) + " → " + esc(r.to_state) + "</b> · " + esc(fmtDT(r.created_at)) + " · " + esc(r.actor_email || "") + (r.note ? " · " + esc(r.note) : "") + "</li>";
      }).join("") + "</ul>" : '<p class="muted">' + esc(tr("al.logEmpty")) + "</p>") + "</section>";
  }
  function bindAdminLaunch(scope, rerender) {
    var f = scope.querySelector("#al-form");
    if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      var to = String(fd.get("to") || "");
      if (!root.confirm(tr("al.ask", { state: to }))) return;
      H.api("admin/launch", { body: { to: to, confirm: fd.get("confirm"), note: fd.get("note") } })
        .then(function () { rerender(); })
        .catch(function (err) { var er = scope.querySelector("#al-err"); er.hidden = false; er.textContent = err.message; });
    };
  }

  root.DreaMintHome = {
    init: function (helpers) { H = helpers; },
    marketBoard: marketBoard,
    emptyState: emptyState,
    bindMarketBoard: bindMarketBoard,
    homeHtml: homeHtml,
    bindHome: bindHome,
    bannerHtml: bannerHtml,
    commissioniHtml: commissioniHtml,
    bindCommissioni: bindCommissioni,
    adminLaunchHtml: adminLaunchHtml,
    bindAdminLaunch: bindAdminLaunch
  };
})(window);
