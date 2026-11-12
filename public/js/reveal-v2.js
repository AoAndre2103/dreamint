/* DreaMint — reveal v2: retri delle 5 rarità (solo logo DM), estrazione premium, copia digitale con cornice rarità.
   - Il livello arriva SEMPRE dal server (commit-reveal già esistente): qui non si decide nulla, si mostra e si verifica.
   - Animazioni solo transform/opacity; particelle su canvas con tetto; prefers-reduced-motion rispettato.
   - Texture dei retri generate a runtime su canvas (procedurali, nessuna immagine esterna).
   API: window.DreamintRevealV2 = { mount, enhanceCard, enhanceGrid, backHtml, copyHtml, crownSvg, setPalette } */
(function (global) {
  "use strict";
  var doc = document;
  var TIERS = ["comune", "rara", "epica", "leggendaria", "mitica"];
  // Logo ufficiale DreaMint (pittogramma carte + monogramma DM + squadrette), lo stesso file usato dal sito.
  var LOGO = "/img/dreamint-icon.webp?v=20261110d";
  var BUCKETS = [["mitica", 10], ["leggendaria", 200], ["epica", 1000], ["rara", 3000], ["comune", 10000]];
  // Colori canvas (texture e particelle): [scuro, medio, chiaro]. "tokens" = colori dei livelli già in uso nel sito.
  var PAL = {
    tokens: {
      sealed: ["#050D18", "#17404F", "#8EFCE5"],
      comune: ["#2E363E", "#9AA3AD", "#E4E9EE"],
      rara: ["#132E6E", "#6BA3FF", "#CFE0FF"],
      epica: ["#3E1272", "#C084FC", "#F5DEFF"],
      leggendaria: ["#8A6418", "#F0CF6E", "#FFF7D6"],
      mitica: ["#5A2A1A", "#FF8A3D", "#FFE2B0"]
    },
    ref2: {
      sealed: ["#050D18", "#17404F", "#8EFCE5"],
      comune: ["#044A40", "#2EE6B8", "#C4FFF0"],
      rara: ["#2C1170", "#A66BFF", "#E6D6FF"],
      epica: ["#6E0F4C", "#FF5FC8", "#FFD6F3"],
      leggendaria: ["#8A6418", "#F0CF6E", "#FFF7D6"],
      mitica: ["#4C5C88", "#CFE0FF", "#FFFFFF"]
    }
  };
  var MITICA_RAINBOW = { tokens: ["#FF8A3D", "#FFD166", "#02AC79", "#6BA3FF", "#C084FC", "#FF4D8D"], ref2: ["#F3D98A", "#DDE8FF", "#FFC6F0", "#BFFFF0", "#C9D6FF", "#FFFFFF"] };
  var STR = {
    it: {
      kicker: "Copia digitale · estrazione", sound: "Suono", on: "on", off: "off", close: "Chiudi",
      holdB: "Tocca o tieni premuto", holdRest: "per aprire la tua copia digitale",
      charging: "Il destino si sta decidendo…", waiting: "Il server sta rivelando il seed…",
      share: "Condividi", replay: "Rivedi l’animazione", toCard: "Vai alla carta",
      sealed: "Da aprire", sealedHint: "La rarità si scopre all’apertura",
      sealedOther: "Copia digitale ancora sigillata: la rarità si scopre quando il proprietario la apre.",
      openAria: "Apri la copia digitale", testName: "Carta di prova", testFoot: "Copia digitale di prova, senza valore",
      verifyTitle: "Estrazione verificabile", verifyLead: "Il commit è pubblico prima dell’apertura. Dopo puoi controllare che il seed non sia cambiato e che il livello venga dal digest.",
      seedHidden: "Nascosto fino all’apertura", certKey: "Chiave certificato",
      okCommit: "sha256(seed) coincide con il commit", okDigest: "sha256(seed:nonce:chiave) coincide con il digest",
      okTier: "roll {roll} → {bucket}/10000 → {tier}", bad: "Verifica non riuscita: i dati non coincidono.",
      pending: "Commit pubblicato: il seed si vede dopo l’apertura.", demo: "Anteprima: non è un’estrazione reale.",
      error: "Non è stato possibile aprire la carta. Riprova.",
      pct: { comune: "Il 70% delle carte", rara: "Il 20% delle carte", epica: "L’8% delle carte", leggendaria: "Solo l’1,9% delle carte", mitica: "Solo lo 0,1% delle carte · 1 su 1000" },
      tier: { comune: "Comune", rara: "Rara", epica: "Epica", leggendaria: "Leggendaria", mitica: "Mitica" },
      shareText: "Ho aperto una {tier} su DreaMint: {name} #{serial}"
    },
    en: {
      kicker: "Digital copy · reveal", sound: "Sound", on: "on", off: "off", close: "Close",
      holdB: "Tap or hold", holdRest: "to open your digital copy",
      charging: "Fate is being decided…", waiting: "The server is revealing the seed…",
      share: "Share", replay: "Replay the animation", toCard: "Go to the card",
      sealed: "To open", sealedHint: "The rarity is revealed when opened",
      sealedOther: "Digital copy still sealed: the rarity is revealed when the owner opens it.",
      openAria: "Open the digital copy", testName: "Test card", testFoot: "Test digital copy, no value",
      verifyTitle: "Verifiable reveal", verifyLead: "The commit is public before opening. Afterwards you can check the seed did not change and the tier comes from the digest.",
      seedHidden: "Hidden until opened", certKey: "Certificate key",
      okCommit: "sha256(seed) matches the commit", okDigest: "sha256(seed:nonce:key) matches the digest",
      okTier: "roll {roll} → {bucket}/10000 → {tier}", bad: "Verification failed: the data does not match.",
      pending: "Commit published: the seed is shown after opening.", demo: "Preview: this is not a real draw.",
      error: "The card could not be opened. Please try again.",
      pct: { comune: "70% of cards", rara: "20% of cards", epica: "8% of cards", leggendaria: "Only 1.9% of cards", mitica: "Only 0.1% of cards · 1 in 1,000" },
      tier: { comune: "Common", rara: "Rare", epica: "Epic", leggendaria: "Legendary", mitica: "Mythic" },
      shareText: "I opened a {tier} on DreaMint: {name} #{serial}"
    }
  };
  var PCT_SHORT = { comune: "70%", rara: "20%", epica: "8%", leggendaria: "1,9%", mitica: "0,1%" };

  function isEn() { return !!(global.DreamintI18n && global.DreamintI18n.getLang && global.DreamintI18n.getLang() === "en"); }
  function S(k, vars) {
    var pack = isEn() ? STR.en : STR.it;
    var v = pack[k] != null ? pack[k] : STR.it[k];
    if (typeof v === "string" && vars) v = v.replace(/\{(\w+)\}/g, function (_, n) { return vars[n] == null ? "" : String(vars[n]); });
    return v;
  }
  function tierLabel(t) { return (S("tier")[t]) || t; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function validTier(t) { return TIERS.indexOf(t) >= 0 ? t : null; }
  function reduced() { return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function mobile() { return !!(global.matchMedia && global.matchMedia("(max-width: 600px), (pointer: coarse)").matches); }
  function palName() { return doc.documentElement.getAttribute("data-rv2-pal") === "ref2" ? "ref2" : "tokens"; }
  function pal() { return PAL[palName()]; }
  function pad4(n) { return String(n == null ? "" : n).padStart(4, "0"); }
  function serialText(n, total) { if (n == null || n === "") return ""; return "#" + pad4(n) + " / " + (total ? pad4(total) : "∞"); }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* non supportato */ } }

  /* ---------------- texture procedurali dei retri (canvas) ---------------- */
  function hexRgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    function f(n) { var k = (n + h * 12) % 12; var a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genTex(tier, W, H, sliced) {
    var c = doc.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d"); var img = g.createImageData(W, H); var d = img.data;
    var p = pal()[tier], A = hexRgb(p[0]), B = hexRgb(p[1]), C = hexRgb(p[2]);
    var ti = TIERS.indexOf(tier), seed = (ti + 2) * 1.37, irid = tier === "mitica", soft = palName() === "ref2";
    // tinta di base del livello (per i riflessi iridescenti attorno al colore del livello)
    var mx = Math.max(B[0], B[1], B[2]), mn = Math.min(B[0], B[1], B[2]), hue = 0;
    if (mx !== mn) { var dd = mx - mn; hue = mx === B[0] ? ((B[1] - B[2]) / dd) % 6 : mx === B[1] ? (B[2] - B[0]) / dd + 2 : (B[0] - B[1]) / dd + 4; hue *= 60; }
    var sat = tier === "comune" && !soft ? 0.18 : 0.75;
    var i = 0, y = 0;
    function rows(maxRows) {
    for (var stop = Math.min(H, y + maxRows); y < stop; y++) {
      for (var x = 0; x < W; x++) {
        var nx = x / W * 2 - 1, ny = (y / H * 2 - 1) * 1.4;
        var wx = nx + 0.30 * Math.sin(ny * 2.7 + seed) + 0.14 * Math.sin(ny * 6.3 + nx * 2.1 + seed * 2);
        var wy = ny + 0.30 * Math.sin(nx * 2.3 - seed) + 0.14 * Math.sin(nx * 5.7 - ny * 1.7 + seed * 3);
        wx += 0.07 * Math.sin(wy * 11 + seed * 5); wy += 0.07 * Math.sin(wx * 12 - seed * 4);
        var rr = Math.sqrt(wx * wx + wy * wy);
        var a = Math.atan2(wy, wx) + 2.8 * Math.exp(-rr * 1.1);
        var v = 0.5 + 0.5 * Math.sin(a * 2 + rr * 5 + 1.8 * Math.sin(wx * 2.2 + wy * 1.7 + seed));
        var phase = a * 6 + rr * 34 + v * 5;
        var f1 = Math.pow(Math.abs(Math.sin(phase)), 16);
        var f2 = Math.pow(Math.abs(Math.sin(a * 11 + rr * 61 - v * 3)), 22);
        var r, gg, b, t;
        if (v < 0.5) { t = v / 0.5; r = A[0] + (B[0] - A[0]) * t; gg = A[1] + (B[1] - A[1]) * t; b = A[2] + (B[2] - A[2]) * t; }
        else { t = (v - 0.5) / 0.5; r = B[0] + (C[0] - B[0]) * t * 0.7; gg = B[1] + (C[1] - B[1]) * t * 0.7; b = B[2] + (C[2] - B[2]) * t * 0.7; }
        var sh = irid ? hsl(a * 57.2958 + rr * 160 + v * 120 + seed * 40, soft ? 0.72 : 0.9, soft ? 0.78 : 0.66)
                      : hsl(hue + 55 * Math.sin(phase * 0.21 + rr * 3), sat, 0.72);
        if (irid) { var m = soft ? 0.55 : 0.7; r = r * (1 - m) + sh[0] * m; gg = gg * (1 - m) + sh[1] * m; b = b * (1 - m) + sh[2] * m; }
        var w1 = f1 * 0.75, w2 = f2 * 0.55;
        r += (sh[0] - r) * w1; gg += (sh[1] - gg) * w1; b += (sh[2] - b) * w1;
        r += (255 - r) * w2; gg += (255 - gg) * w2; b += (255 - b) * w2;
        var k = (0.78 + 0.22 * v) * (1 - 0.25 * Math.max(0, rr - 0.95));
        d[i++] = r * k; d[i++] = gg * k; d[i++] = b * k; d[i++] = 255;
      }
    }
    }
    function finish() {

    g.putImageData(img, 0, 0);
    var R = rng(ti * 991 + 17);
    g.globalCompositeOperation = "lighter";
    for (var s = 0; s < 34; s++) {
      var sx = R() * W, sy = R() * H, sr = 0.5 + R() * 1.1, big = R() < 0.15;
      var gr = g.createRadialGradient(sx, sy, 0, sx, sy, sr * (big ? 4 : 2.2));
      gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, sr * (big ? 4 : 2.2), 0, Math.PI * 2); g.fill();
      if (big) { g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(sx - 6, sy - 0.4, 12, 0.8); g.fillRect(sx - 0.4, sy - 6, 0.8, 12); }
    }
    return c;
    }
    if (!sliced) { rows(H); return finish(); }
    var idle = global.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 16); };
    (function slice() { rows(24); if (y < H) idle(slice); else sliced(finish()); })(); // ~2 ms per fetta su iPhone
  }
  var texDone = {};
  function ensureTextures() {
    var key = palName();
    if (texDone[key]) return; texDone[key] = true;
    var list = ["sealed"].concat(TIERS), W = mobile() ? 200 : 260, H = Math.round(W * 1.4);
    function use(t, url) { if (palName() !== key) return; doc.documentElement.style.setProperty("--rv2-tex-" + t, 'url("' + url + '")'); doc.documentElement.classList.add("rv2-tex-ready"); }
    function next() {
      var t = list.shift(); if (!t) return;
      var ck = "rv2tex:v1:" + key + ":" + t + ":" + W, cached = null;
      try { cached = localStorage.getItem(ck); } catch (e) { cached = null; }
      if (cached) { use(t, cached); return next(); }
      try {
        genTex(t, W, H, function (c) {
          var url = c.toDataURL("image/webp", 0.82);
          if (url.indexOf("data:image/webp") !== 0) url = c.toDataURL("image/jpeg", 0.85);
          try { localStorage.setItem(ck, url); } catch (e) { /* quota: resta in memoria */ }
          use(t, url); next();
        });
      } catch (e) { next(); }
    }
    next();
  }
  function setPalette(name) {
    if (name === "ref2") doc.documentElement.setAttribute("data-rv2-pal", "ref2");
    else doc.documentElement.removeAttribute("data-rv2-pal");
    ensureTextures();
  }

  /* ---------------- markup ---------------- */
  function crownSvg() {
    var id = "rv2cg" + Math.floor(Math.random() * 1e6);
    return '<svg class="rv2-crown" viewBox="0 0 120 84" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#FFF6CF"/><stop offset=".45" stop-color="#F0C95A"/><stop offset="1" stop-color="#9A6A12"/></linearGradient></defs>' +
      '<path d="M14 66 L8 24 L23 46 L34 14 L47 40 L60 4 L73 40 L86 14 L97 46 L112 24 L106 66 Z" fill="url(#' + id + ')" stroke="#FFF1B8" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<rect x="10" y="62" width="100" height="15" rx="4" fill="url(#' + id + ')" stroke="#FFF1B8" stroke-width="1.5"/>' +
      '<circle cx="8" cy="22" r="4.5" fill="#FFF6CF"/><circle cx="34" cy="12" r="4.5" fill="#FFF6CF"/><circle cx="60" cy="3" r="5" fill="#FFFFFF"/><circle cx="86" cy="12" r="4.5" fill="#FFF6CF"/><circle cx="112" cy="22" r="4.5" fill="#FFF6CF"/>' +
      '<ellipse cx="35" cy="69.5" rx="5" ry="4" fill="#8EFCE5"/><ellipse cx="60" cy="69.5" rx="6.5" ry="4.6" fill="#FF6FC8"/><ellipse cx="85" cy="69.5" rx="5" ry="4" fill="#9FC2FF"/>' +
      '<path d="M60 22 C 62 30, 66 34, 72 36 C 66 38, 62 42, 60 50 C 58 42, 54 38, 48 36 C 54 34, 58 30, 60 22 Z" fill="#FFFFFF" opacity=".9"/></svg>';
  }
  function backHtml(tier, cls) {
    tier = tier === "sealed" ? "sealed" : (validTier(tier) || "sealed");
    return '<div class="rv2-back' + (cls ? " " + cls : "") + '" data-rv2-tier="' + tier + '" aria-hidden="true"><div class="rv2-tex"></div><div class="rv2-sheen"></div><div class="rv2-bframe"></div>' +
      '<div class="rv2-logo-wrap"><span class="rv2-logo-halo"></span>' + (tier === "mitica" ? '<span class="rv2-back-crown">' + crownSvg() + "</span>" : "") + '<img class="rv2-logo" src="' + LOGO + '" alt="DreaMint" width="512" height="512" draggable="false" decoding="async"></div></div>';
  }
  function testArtHtml() {
    var R = rng(7), stars = "";
    for (var i = 0; i < 26; i++) stars += '<circle cx="' + (R() * 100).toFixed(1) + '" cy="' + (R() * 100).toFixed(1) + '" r="' + (0.3 + R() * 0.9).toFixed(2) + '" fill="#fff" opacity="' + (0.4 + R() * 0.6).toFixed(2) + '"/>';
    return '<div class="rv2-testart"><div class="rv2-testart-name">' + esc(S("testName")) + '</div><div class="rv2-testart-ill">' +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + stars +
      '<polyline points="14,70 30,52 46,58 58,36 76,30 88,44" fill="none" stroke="#E8C872" stroke-width=".7" opacity=".8"/>' +
      '<g fill="#FFE7A3"><circle cx="14" cy="70" r="1.6"/><circle cx="30" cy="52" r="1.4"/><circle cx="46" cy="58" r="1.6"/><circle cx="58" cy="36" r="2"/><circle cx="76" cy="30" r="1.5"/><circle cx="88" cy="44" r="1.4"/></g>' +
      '<image href="' + LOGO + '" x="38" y="64" width="24" height="24" opacity=".95"/></svg></div>' +
      '<div class="rv2-testart-foot">' + esc(S("testFoot")) + "</div></div>";
  }
  function plateHtml(o) {
    var chip = o.sealed ? esc(S("sealed")) : esc(tierLabel(o.tier) + " · " + PCT_SHORT[o.tier]);
    var sub = [o.grader, o.grade ? o.grade : "", o.cert || ""].filter(Boolean).join(" · ");
    return '<div class="rv2-plate"><span class="rv2-chip">' + chip + '</span><span class="rv2-serial">' + esc(o.sealed ? "#???? / " + (o.total ? pad4(o.total) : "9999") : serialText(o.serial, o.total)) + "</span>" +
      '<div class="rv2-sub"><span>' + esc(sub) + "</span>" + (o.admin && o.isTest ? '<span class="rv2-test" title="Solo admin">TEST</span>' : "") + "</div></div>";
  }
  // o: { tier, art, srcset, isTest, grader, grade, serial, total, cert, admin, idle, noPlate, sealSoon, sealed }
  function copyHtml(o) {
    var tier = o.sealed ? "sealed" : (validTier(o.tier) || "comune");
    var inner;
    if (o.sealed) inner = backHtml("sealed");
    else {
      var art = (o.art && !o.isTestArt)
        ? '<img class="rv2-art" src="' + esc(o.art) + '"' + (o.srcset ? ' srcset="' + esc(o.srcset) + '" sizes="(max-width:600px) 70vw, 320px"' : "") + ' alt="" draggable="false" decoding="async" onerror="this.style.opacity=0">'
        : testArtHtml();
      inner = '<div class="rv2-frame"><div class="rv2-frame-spin"></div><div class="rv2-window">' + art + '<div class="rv2-holo"></div><div class="rv2-glare"></div></div></div>';
    }
    var seal = (!o.sealed && o.grade) ? '<div class="rv2-seal"' + (o.sealSoon ? ' style="opacity:0"' : "") + "><span><b>" + esc(o.grade) + "</b><small>" + esc(o.grader || "") + "</small></span></div>" : "";
    return '<div class="rv2-copy' + (o.idle && !reduced() ? " rv2-idle" : "") + '" data-rv2-tier="' + tier + '">' +
      (tier === "mitica" ? '<div class="rv2-copy-crown">' + crownSvg() + "</div>" : "") +
      '<div class="rv2-tilt">' + inner + seal + "</div>" + (o.noPlate ? "" : plateHtml(o)) + "</div>";
  }
  function cosmosHtml(nDust) {
    var dust = "", R = rng(42);
    for (var i = 0; i < nDust; i++) dust += '<i style="left:' + (R() * 100).toFixed(1) + "%;top:" + (40 + R() * 60).toFixed(1) + "%;--dx:" + Math.round(R() * 60 - 30) + "px;animation-delay:-" + (R() * 9).toFixed(2) + 's"></i>';
    return '<div class="rv2-cosmos"><canvas class="rv2-stars"></canvas><div class="rv2-neb"></div><div class="rv2-floor"></div><div class="rv2-dust">' + dust + "</div></div>";
  }
  function drawStars(cv) {
    var host = cv.parentNode; if (!host) return;
    var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var g = cv.getContext("2d"); g.scale(dpr, dpr);
    var R = rng(1234), n = Math.min(220, Math.round(w * h / 2600));
    for (var i = 0; i < n; i++) {
      var x = R() * w, y = R() * h, r = 0.3 + R() * 1.1;
      g.fillStyle = R() < 0.2 ? "rgba(255,231,163," + (0.5 + R() * 0.5) + ")" : "rgba(255,255,255," + (0.3 + R() * 0.6) + ")";
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (var k = 0; k < 4; k++) {
      var cx = (0.12 + R() * 0.76) * w, cy = (0.06 + R() * 0.4) * h, pts = [];
      for (var j = 0; j < 5; j++) pts.push([cx + (R() - 0.5) * 140, cy + (R() - 0.5) * 90]);
      g.strokeStyle = "rgba(232,200,114,0.32)"; g.lineWidth = 0.8; g.beginPath();
      pts.forEach(function (p, idx) { if (idx) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
      pts.forEach(function (p) {
        var gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 5);
        gr.addColorStop(0, "rgba(255,236,170,1)"); gr.addColorStop(1, "rgba(255,236,170,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(p[0], p[1], 5, 0, Math.PI * 2); g.fill();
      });
    }
  }

  /* ---------------- particelle (canvas, tetto) ---------------- */
  function FX(cv) {
    // Particelle su canvas: sprite pre-renderizzati + composito "lighter"; tetto per livello (mobile più basso).
    var g = cv.getContext("2d"), parts = [], raf = 0, sprites = {}, alive = true, MOB = mobile();
    var CAPS = MOB ? { base: 90, comune: 90, rara: 110, epica: 150, leggendaria: 200, mitica: 260 } : { base: 170, comune: 170, rara: 200, epica: 260, leggendaria: 340, mitica: 440 };
    var MAX = CAPS.base, dpr = Math.min(global.devicePixelRatio || 1, MOB ? 1.5 : 2), W = 0, H = 0;
    function size() { var r = cv.getBoundingClientRect(); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function sprite(col) {
      if (sprites[col]) return sprites[col];
      var s = doc.createElement("canvas"); s.width = s.height = 32; var x = s.getContext("2d");
      var gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, col); gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 32, 32); sprites[col] = s; return s;
    }
    function add(p) { if (parts.length >= MAX) parts.shift(); parts.push(p); if (!raf) raf = requestAnimationFrame(tick); }
    var last = 0;
    function tick(now) {
      raf = 0; if (!alive) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016, k = dt * 60; last = now;
      g.clearRect(0, 0, W, H);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life -= p.decay * k;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (p.to) { p.x += (p.tx - p.x) * 0.09 * k; p.y += (p.ty - p.y) * 0.09 * k; }
        else if (p.orbit) { p.a += p.va * k; p.r += p.vr * k; p.x = p.cx + Math.cos(p.a) * p.r; p.y = p.cy + Math.sin(p.a) * p.r * 0.72; }
        else { p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * k; p.x += p.vx * k; p.y += p.vy * k; if (p.wob) p.x += Math.sin(now / 260 + p.ph) * p.wob * k; }
        var al = Math.min(1, p.life * 1.4);
        if (p.flick) al *= 0.55 + 0.45 * Math.sin(now / 90 + p.ph);
        if (p.rect) { // coriandolo: rettangolo che ruota (finta rotazione 3D con scala)
          p.rot += p.vrot * k;
          g.globalCompositeOperation = "source-over"; g.globalAlpha = al; g.fillStyle = p.col;
          var cs = Math.cos(p.rot), sn = Math.sin(p.rot), sx = Math.abs(Math.cos(p.rot * 1.7)) + 0.15;
          g.setTransform(dpr * cs * sx, dpr * sn * sx, -dpr * sn, dpr * cs, p.x * dpr, p.y * dpr);
          g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          g.globalCompositeOperation = "lighter"; g.globalAlpha = al;
          var s = p.size * (0.6 + p.life * 0.6);
          g.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
        }
      }
      g.globalAlpha = 1;
      if (parts.length) raf = requestAnimationFrame(tick); else { last = 0; g.clearRect(0, 0, W, H); }
    }
    size();
    return {
      resize: size,
      cap: function (tier) { MAX = CAPS[tier] || CAPS.base; },
      burst: function (n, cols, speed, opt) {
        opt = opt || {}; var cx = W / 2, cy = opt.cy != null ? opt.cy : H * 0.42;
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.9);
          add({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opt.up || 0), g: opt.g || 0, drag: opt.drag || 0.955,
            life: 1, decay: (opt.decay || 0.012) + Math.random() * 0.014, size: (opt.size || 7) * (0.5 + Math.random()), col: cols[i % cols.length] });
        }
      },
      // braci/scintille che restano: salgono piano, tremolano, durano 2–4 s
      embers: function (n, cols, opt) {
        opt = opt || {}; var cy = opt.cy != null ? opt.cy : H * 0.42, spread = opt.spread || 0.8;
        for (var i = 0; i < n; i++) {
          add({ x: W / 2 + (Math.random() - 0.5) * W * spread, y: cy + (Math.random() - 0.3) * H * 0.45, vx: (Math.random() - 0.5) * 0.6, vy: -(0.3 + Math.random() * 0.9),
            g: opt.g || 0, drag: 0.995, wob: 0.25, ph: Math.random() * 6, flick: true, life: 1, decay: 0.004 + Math.random() * 0.004,
            size: (opt.size || 3.5) * (0.6 + Math.random()), col: cols[i % cols.length] });
        }
      },
      confetti: function (n, cols, opt) {
        opt = opt || {}; var cy = opt.cy != null ? opt.cy : H * 0.42;
        for (var i = 0; i < n; i++) {
          var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = 6 + Math.random() * 7;
          add({ x: W / 2, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.16, drag: 0.965, wob: 0.6, ph: Math.random() * 6, rect: true,
            rot: Math.random() * 6, vrot: 0.08 + Math.random() * 0.2, life: 1, decay: 0.005 + Math.random() * 0.004, size: 7 + Math.random() * 6, col: cols[i % cols.length] });
        }
      },
      // polvere di stelle che gira attorno alla carta allargandosi
      swirl: function (n, cols, opt) {
        opt = opt || {}; var cy = opt.cy != null ? opt.cy : H * 0.42;
        for (var i = 0; i < n; i++) {
          add({ orbit: true, cx: W / 2, cy: cy, a: (i / n) * Math.PI * 2, va: 0.045 + Math.random() * 0.03, r: 30 + Math.random() * 40, vr: 1.1 + Math.random() * 1.3,
            x: W / 2, y: cy, life: 1, decay: 0.007 + Math.random() * 0.005, size: 3 + Math.random() * 4, col: cols[i % cols.length] });
        }
      },
      converge: function (n, col, cy) {
        var cx = W / 2; cy = cy != null ? cy : H * 0.42;
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2, d = 120 + Math.random() * Math.max(W, H) * 0.35;
          add({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, tx: cx, ty: cy, to: true, life: 1, decay: 0.03 + Math.random() * 0.02, size: 3 + Math.random() * 4, col: col });
        }
      },
      count: function () { return parts.length; },
      clear: function () { parts.length = 0; },
      destroy: function () { alive = false; cancelAnimationFrame(raf); parts.length = 0; }
    };
  }

  /* ---------------- suono opzionale (off di default, WebAudio sintetico) ---------------- */
  function Sound() {
    var ac = null, on = false;
    function ctx() { if (!ac) { var A = global.AudioContext || global.webkitAudioContext; if (A) ac = new A(); } return ac; }
    function tone(f, dur, type, vol, at) {
      var c = ctx(); if (!c || !on) return; var t = c.currentTime + (at || 0);
      var o = c.createOscillator(), gn = c.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f, t);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      toggle: function () { on = !on; if (on && ctx() && ac.state === "suspended") ac.resume(); return on; },
      tick: function (k) { tone(420 + k * 38, 0.06, "triangle", 0.05); },
      boom: function () { tone(90, 0.5, "sine", 0.18); tone(180, 0.3, "triangle", 0.06); },
      chime: function (tier) {
        var notes = { comune: [523], rara: [523, 659], epica: [523, 659, 784], leggendaria: [523, 659, 784, 1047], mitica: [523, 659, 784, 1047, 1319] }[tier] || [523];
        notes.forEach(function (f, i) { tone(f, 0.9, "sine", 0.07, i * 0.09); });
      },
      stamp: function () { tone(140, 0.18, "square", 0.05); }
    };
  }

  /* ---------------- tilt olografico ---------------- */
  function bindTilt(el, opts) {
    if (!el || el._rv2Tilt || reduced()) return;
    el._rv2Tilt = true; opts = opts || {};
    var tgt = null, raf = 0, fine = global.matchMedia && global.matchMedia("(hover: hover) and (pointer: fine)").matches;
    function apply() {
      raf = 0; if (!tgt) return;
      var px = tgt[0], py = tgt[1];
      el.style.setProperty("--ry", ((px - 0.5) * 24).toFixed(2) + "deg");
      el.style.setProperty("--rx", ((0.5 - py) * 18).toFixed(2) + "deg");
      el.style.setProperty("--rv2-hx", ((px - 0.5) * 30).toFixed(1) + "%");
      el.style.setProperty("--rv2-hy", ((py - 0.5) * 30).toFixed(1) + "%");
      el.style.setProperty("--rv2-gx", (px * 100 - 50).toFixed(1) + "%");
      el.style.setProperty("--rv2-gy", (py * 100 - 50).toFixed(1) + "%");
    }
    function set(px, py) { tgt = [Math.max(0, Math.min(1, px)), Math.max(0, Math.min(1, py))]; if (!raf) raf = requestAnimationFrame(apply); }
    function reset() { el.classList.remove("is-live"); ["--rx", "--ry", "--rv2-hx", "--rv2-hy", "--rv2-gx", "--rv2-gy"].forEach(function (k) { el.style.removeProperty(k); }); if (opts.idle) el.classList.add("rv2-idle"); }
    if (fine) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect(); el.classList.add("is-live"); el.classList.remove("rv2-idle");
        set((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
      });
      el.addEventListener("pointerleave", reset);
    } else if (opts.gyro && global.DeviceOrientationEvent) {
      var onOri = function (e) {
        if (!el.isConnected) { global.removeEventListener("deviceorientation", onOri); return; }
        if (e.gamma == null) return;
        el.classList.add("is-live"); el.classList.remove("rv2-idle");
        set(0.5 + Math.max(-30, Math.min(30, e.gamma)) / 60, 0.5 + Math.max(-30, Math.min(30, (e.beta || 45) - 45)) / 60);
      };
      global.addEventListener("deviceorientation", onOri, { passive: true });
    }
  }
  function askGyro() {
    try { if (global.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") DeviceOrientationEvent.requestPermission().catch(function () {}); } catch (e) { /* ignora */ }
  }

  /* ---------------- dati carta ---------------- */
  function catalogOf(c) { return c && !c.is_ungraded ? (c.catalog_image || (c.model && c.model.catalog_image) || "") : ""; }
  function artOf(c) {
    var cat = catalogOf(c); if (cat) return { art: cat, srcset: "" };
    if (c && c.is_test) return { art: "", srcset: "", testArt: true }; // la foto TEST del server è il vecchio segnaposto col diamante
    var P = global.GemintPhotos; if (!c || !c.id || !P) return { art: "", srcset: "" };
    return { art: P.url(c.id, "front", 560), srcset: P.srcset ? P.srcset(c.id, "front") : "" };
  }
  function copyOpts(c, viewer, extra) {
    var a = artOf(c), o = {
      tier: c.rarity_tier, art: a.art, srcset: a.srcset, isTestArt: !!a.testArt, isTest: !!c.is_test,
      grader: c.grader || "", grade: c.grade || "", serial: c.serial_number, total: c.serial_total || 9999,
      cert: c.certificate_no || "", admin: !!(viewer && viewer.role === "admin")
    };
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }
  function hideTestPills(root, admin) {
    if (admin) return;
    (root || doc).querySelectorAll(".pill-test").forEach(function (p) { p.remove(); });
  }

  /* ---------------- estrazione ---------------- */
  function sha256Hex(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) { return Array.from(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join(""); });
  }
  function tierFromRoll(roll) {
    var n = Math.min(9999, Math.max(0, Math.floor(Number(roll) * 10000)));
    for (var i = 0; i < BUCKETS.length; i++) if (n < BUCKETS[i][1]) return [BUCKETS[i][0], n];
    return ["comune", n];
  }
  function normData(d) {
    d = d || {};
    var c = d.card || null, o = {};
    o.tier = validTier(d.tier || (c && c.rarity_tier));
    o.serial = d.serial != null ? d.serial : c && c.serial_number;
    o.total = d.total || (c && c.serial_total) || 9999;
    o.name = d.name || (c && c.model && c.model.name) || "";
    o.code = d.code || (c && c.model && c.model.code_printed) || "";
    o.setName = d.setName || (c && c.model && c.model.set_name) || "";
    o.grader = d.grader || (c && c.grader) || "";
    o.grade = d.grade || (c && c.grade) || "";
    o.cert = (c && c.certificate_no) || "";
    o.certKey = d.certKey || (c && c.cert_key) || "";
    o.seed = d.seed || (c && c.server_seed) || "";
    o.commit = d.commit || (c && c.commit_hash) || "";
    o.nonce = d.nonce || (c && c.client_nonce) || "";
    o.digest = d.digest || (c && c.digest) || "";
    o.roll = d.roll != null ? d.roll : c && c.roll;
    o.isTest = !!(c && c.is_test);
    o.id = (c && c.id) || d.id || "";
    var a = c ? artOf(c) : { art: d.photoUrl || "", srcset: d.photoSrcset || "" };
    if (c && !a.testArt && d.photoUrl && !catalogOf(c)) a = { art: d.photoUrl, srcset: d.photoSrcset || "" };
    o.art = a.art; o.srcset = a.srcset; o.testArt = !!a.testArt;
    o.demo = !!d.demo; o.autoplay = !!d.autoplay; o.fetchOpen = d.fetchOpen || null;
    o.admin = !!(d.viewer && d.viewer.role === "admin");
    return o;
  }

  function mount(container, raw, opts) {
    opts = opts || {};
    ensureTextures();
    var D = normData(raw), RM = reduced(), snd = Sound(), alive = true, timers = [];
    var phase = "idle";
    function later(fn, ms) { var t = setTimeout(function () { if (alive) fn(); }, ms); timers.push(t); return t; }
    var stack = backHtml("sealed", "on") + TIERS.map(function (t) { return backHtml(t); }).join("");
    var glows = '<i data-rv2-tier="sealed" class="on"></i>' + TIERS.map(function (t) { return '<i data-rv2-tier="' + t + '"></i>'; }).join("");
    container.innerHTML =
      '<div class="rv2-stage' + (RM ? "" : " rv2-anim") + '" data-rv2-tier="sealed">' + cosmosHtml(mobile() ? 10 : 16) +
      '<div class="rv2-top"><span class="rv2-kicker">' + esc(S("kicker")) + "</span><span>" +
      '<button type="button" class="rv2-btn-mini" data-rv2="sound" aria-pressed="false">' + esc(S("sound")) + ": " + S("off") + "</button>" +
      (opts.overlay ? ' <button type="button" class="rv2-btn-mini" data-rv2="close">' + esc(S("close")) + "</button>" : "") + "</span></div>" +
      '<div class="rv2-center">' +
      '<div class="rv2-float bob"><div class="rv2-cardbox"><div class="rv2-glows">' + glows + '</div><div class="rv2-rays"></div><div class="rv2-shock"></div><div class="rv2-crownbox">' + crownSvg() + "</div>" +
      '<button type="button" class="rv2-card3d" aria-label="' + esc(S("openAria")) + '"><div class="rv2-flipper">' +
      '<div class="rv2-face rv2-face-back"><div class="rv2-stack">' + stack + "</div></div>" +
      '<div class="rv2-face rv2-face-front"></div></div></button>' +
      '<svg class="rv2-ring" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="1" width="98" height="138" rx="8" pathLength="1000" vector-effect="non-scaling-stroke"/></svg></div>' +
      '<div class="rv2-plate-wrap"></div></div>' +
      '<div class="rv2-hint"><b>' + esc(S("holdB")) + "</b>" + esc(S("holdRest")) + "</div></div>" +
      '<div class="rv2-result"><p class="rv2-tiername"></p><p class="rv2-pct"></p><p class="rv2-title"></p>' +
      '<div class="rv2-actions"><button type="button" class="btn primary" data-rv2="share">' + esc(S("share")) + "</button>" +
      '<button type="button" class="btn ghost" data-rv2="replay">' + esc(S("replay")) + "</button>" +
      (opts.overlay ? '<button type="button" class="btn ghost" data-rv2="tocard">' + esc(S("toCard")) + "</button>" : "") + "</div></div>" +
      '<canvas class="rv2-fx"></canvas><div class="rv2-flash"></div><div class="rv2-sr" aria-live="polite"></div></div>' +
      '<div class="rv2-after"><details class="rv2-fair"' + (opts.openFair ? " open" : "") + "><summary>" + esc(S("verifyTitle")) + "</summary>" +
      '<p class="muted" style="margin:8px 0">' + esc(D.demo ? S("demo") : S("verifyLead")) + '</p><div class="rv2-kv"></div><div class="rv2-verify"></div></details></div>';

    var q = function (s) { return container.querySelector(s); };
    var stage = q(".rv2-stage"), card = q(".rv2-card3d"), flipper = q(".rv2-flipper"), front = q(".rv2-face-front");
    var floatEl = q(".rv2-float"), hint = q(".rv2-hint"), ring = q(".rv2-ring rect"), plateWrap = q(".rv2-plate-wrap");
    var backs = container.querySelectorAll(".rv2-stack .rv2-back"), glowEls = container.querySelectorAll(".rv2-glows i");
    var fx = FX(q(".rv2-fx"));
    function cyCard() { var r = card.getBoundingClientRect(), s0 = stage.getBoundingClientRect(); return r.top - s0.top + r.height / 2; }
    drawStars(q(".rv2-stars"));
    function onResize() { fx.resize(); drawStars(q(".rv2-stars")); }
    global.addEventListener("resize", onResize);

    function renderFront() {
      var o = { tier: D.tier, art: D.art, srcset: D.srcset, isTestArt: D.testArt, isTest: D.isTest, grader: D.grader, grade: D.grade,
        serial: D.serial, total: D.total, cert: D.cert, admin: D.admin, noPlate: true, sealSoon: true };
      front.innerHTML = copyHtml(o);
      var cr = front.querySelector(".rv2-copy-crown"); if (cr) cr.remove(); // nel palco la corona è quella sopra la carta
      o.noPlate = false; o.serial = 0;
      var tmp = doc.createElement("div"); tmp.innerHTML = copyHtml(o);
      var plate = tmp.querySelector(".rv2-plate"); plateWrap.innerHTML = ""; if (plate) { plate.setAttribute("data-rv2-tier", D.tier); plateWrap.appendChild(plate); }
      plateWrap.setAttribute("data-rv2-tier", D.tier);
    }
    function show(idx) { // idx: -1 = sigillata
      backs.forEach(function (b, i) { b.classList.toggle("on", i === idx + 1); });
      glowEls.forEach(function (g, i) { g.classList.toggle("on", i === idx + 1); g.classList.remove("max"); });
    }
    function setStageTier(t) { stage.setAttribute("data-rv2-tier", t); }
    function anim(el, frames, o) { if (!el || !el.animate || RM) return null; try { return el.animate(frames, o); } catch (e) { return null; } }

    // --- tieni premuto / tocca ---
    var holdT0 = 0, holdRaf = 0, holding = false, HOLD = 600;
    function ringSet(p) { ring.style.strokeDasharray = Math.round(p * 1000) + " 1000"; }
    function holdLoop() {
      holdRaf = 0; if (!holding) return;
      var p = Math.min(1, (performance.now() - holdT0) / HOLD); ringSet(p);
      if (p >= 1) { holding = false; start(); return; }
      holdRaf = requestAnimationFrame(holdLoop);
    }
    card.addEventListener("pointerdown", function (e) {
      if (phase !== "idle" || (e.button != null && e.button !== 0)) return;
      holding = true; holdT0 = performance.now(); askGyro(); buzz(8);
      if (!holdRaf) holdRaf = requestAnimationFrame(holdLoop);
    });
    card.addEventListener("pointerup", function () { if (holding && phase === "idle") { holding = false; start(); } });
    ["pointercancel", "pointerleave"].forEach(function (ev) { card.addEventListener(ev, function () { if (holding) { holding = false; ringSet(0); } }); });
    card.addEventListener("click", function (e) { if (e.detail === 0 && phase === "idle") start(); }); // tastiera
    card.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // --- sequenza ---
    var cur = -1;
    function start() {
      if (phase !== "idle") return;
      phase = "suspense"; ringSet(0); floatEl.classList.remove("bob");
      hint.innerHTML = "<b>" + esc(S("charging")) + "</b>&nbsp;";
      if (D.tier) return runSuspense();
      if (!D.fetchOpen) { phase = "idle"; return; }
      hint.innerHTML = "<b>" + esc(S("charging")) + "</b>" + esc(S("waiting"));
      var spinning = true, k = 0;
      (function spin() { if (!spinning || !alive) return; cur = (cur + 1) % 5; show(cur); if (!RM) fx.converge(2, pal()[TIERS[cur]][1], cyCard()); snd.tick(k++ % 6); later(spin, 70); })();
      D.fetchOpen().then(function (c) {
        spinning = false;
        var nd = normData({ card: c, viewer: raw && raw.viewer }); nd.fetchOpen = null;
        for (var key in nd) D[key] = nd[key];
        if (!D.tier) throw new Error("no tier");
        hint.innerHTML = "<b>" + esc(S("charging")) + "</b>&nbsp;";
        runSuspense();
      }).catch(function (err) {
        spinning = false; phase = "idle"; show(-1); floatEl.classList.add("bob");
        hint.innerHTML = "<b>" + esc(S("error")) + "</b>" + esc(err && err.message ? err.message : "");
      });
    }
    function runSuspense() {
      renderFront(); fillFair(false);
      var target = TIERS.indexOf(D.tier);
      if (RM) { show(target); return later(burst, 250); }
      var dur = { comune: 1700, rara: 2100, epica: 2600, leggendaria: 3200, mitica: 4000 }[D.tier];
      var iv = [], sum = 0, base = 55;
      while (sum < dur) { var x = base * Math.pow(1.17, iv.length); iv.push(x); sum += x; }
      // l'ultimo passo deve cadere esattamente sul livello del server
      while ((((cur + iv.length) % 5) + 5) % 5 !== target) { iv.push(base * Math.pow(1.17, iv.length)); }
      // quasi-colpo: l'ultimo retro prima di Leggendaria/Mitica resta più a lungo
      if (D.tier === "mitica") iv[iv.length - 1] = Math.max(iv[iv.length - 1], 760);
      if (D.tier === "leggendaria") iv[iv.length - 1] = Math.max(iv[iv.length - 1], 520);
      var n = iv.length, j = 0;
      anim(floatEl, [{ transform: "scale(1)" }, { transform: "scale(1.06)" }], { duration: sum, easing: "ease-in", fill: "forwards" });
      (function step() {
        if (!alive) return;
        cur = (cur + 1) % 5; show(cur);
        var t = TIERS[cur], col = pal()[t][1], last = j === n - 1;
        anim(card, [{ transform: "scale(1)" }, { transform: "scale(1.035)" }, { transform: "scale(1)" }], { duration: Math.min(220, iv[j]), easing: "ease-out" });
        if (!RM) fx.converge(last ? 14 : 3 + Math.round(6 * j / n), col, cyCard());
        snd.tick(j); if (iv[j] > 150) buzz(6);
        if (last) {
          anim(card, [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(-3px,1px,0)" }, { transform: "translate3d(3px,-1px,0)" }, { transform: "translate3d(0,0,0)" }], { duration: 90, iterations: 4 });
          return later(burst, 380);
        }
        later(step, iv[j++]);
      })();
    }
    function burst() {
      phase = "burst";
      var t = D.tier, P = pal()[t], cols = t === "mitica" ? MITICA_RAINBOW[palName()] : [P[1], P[2], "#FFFFFF"];
      setStageTier(t); show(TIERS.indexOf(t));
      glowEls[TIERS.indexOf(t) + 1].classList.add("max");
      anim(q(".rv2-flash"), [{ opacity: 0 }, { opacity: t === "comune" ? 0.55 : 0.95, offset: 0.18 }, { opacity: 0 }], { duration: t === "comune" ? 420 : 640, easing: "ease-out" });
      snd.boom(); snd.chime(t);
      buzz({ comune: 20, rara: 30, epica: [40, 30, 40], leggendaria: [60, 40, 60], mitica: [80, 50, 80, 50, 160] }[t]);
      if (!RM) {
        // intensità crescente: Comune < Rara < Epica < Leggendaria < Mitica
        var cy = cyCard(), GOLD = ["#FFE7A3", "#F0CF6E", "#FFF7D6", "#FFFFFF"];
        fx.cap(t);
        var big = { comune: 26, rara: 48, epica: 80, leggendaria: 110, mitica: 130 }[t];
        fx.burst(big, cols, { comune: 6, rara: 8, epica: 10, leggendaria: 12, mitica: 13 }[t], { size: 9, cy: cy });
        if (t === "rara") fx.embers(14, [P[1], P[2]], { cy: cy });
        if (t === "epica") { fx.burst(26, ["#FFFFFF", P[2]], 6, { size: 4, cy: cy, decay: 0.02 }); fx.embers(24, [P[1], P[2], "#FFFFFF"], { cy: cy }); }
        if (t === "leggendaria") {
          fx.burst(60, GOLD, 8, { g: 0.1, drag: 0.97, size: 5, up: 2, cy: cy });         // polvere d'oro che ricade
          fx.embers(40, GOLD, { cy: cy, spread: 0.95 });                                // braci dorate che restano
        }
        if (t === "mitica") {
          fx.confetti(mobile() ? 50 : 80, cols, { cy: cy });                                 // coriandoli arcobaleno
          fx.swirl(mobile() ? 40 : 64, cols.concat(GOLD), { cy: cy });                         // vortice di polvere di stelle
          fx.embers(30, cols.concat(GOLD), { cy: cy, spread: 1 });
          later(function () {                                                           // seconda esplosione
            anim(q(".rv2-flash"), [{ opacity: 0 }, { opacity: 0.6, offset: 0.2 }, { opacity: 0 }], { duration: 420 });
            fx.burst(mobile() ? 70 : 100, cols.concat(["#FFFFFF"]), 11, { size: 8, cy: cyCard() }); buzz([40, 30, 90]); snd.boom();
          }, 460);
        }
        if (t !== "comune") q(".rv2-rays").classList.add("on");
        anim(q(".rv2-shock"), [{ transform: "scale(.2)", opacity: 1 }, { transform: "scale(" + (t === "comune" ? 1.6 : 3) + ")", opacity: 0 }], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" });
        if (t === "leggendaria" || t === "mitica") anim(stage, [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(-5px,3px,0)" }, { transform: "translate3d(5px,-3px,0)" }, { transform: "translate3d(0,0,0)" }], { duration: 80, iterations: t === "mitica" ? 6 : 4 });
      }
      if (t === "mitica") q(".rv2-crownbox").classList.add("on");
      later(flip, RM ? 150 : (t === "comune" ? 420 : 760));
    }
    function flip() {
      phase = "flip"; hint.classList.add("hide");
      var a = anim(flipper, [{ transform: "rotateY(0deg) scale(1)" }, { transform: "rotateY(95deg) scale(1.08)", offset: 0.5 }, { transform: "rotateY(180deg) scale(1)" }], { duration: 900, easing: "cubic-bezier(.3,.7,.2,1)" });
      flipper.style.transform = "rotateY(180deg)";
      if (a && !RM && D.tier !== "comune") later(function () { fx.burst(20, [pal()[D.tier][2], "#FFFFFF"], 4, { size: 5, cy: cyCard() }); }, 450);
      later(afterFlip, RM ? 50 : 820);
    }
    function afterFlip() {
      phase = "count"; plateWrap.classList.add("on"); floatEl.classList.add("bob"); hint.classList.add("gone");
      var el = plateWrap.querySelector(".rv2-serial"), target = Number(D.serial) || 0, tot = D.total, dur = RM ? 0 : Math.min(1400, 500 + target / 8), t0 = performance.now();
      (function tick() {
        if (!alive) return;
        var p = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 3);
        if (el) el.textContent = serialText(Math.max(1, Math.round(target * e)), tot);
        if (p < 1) requestAnimationFrame(tick); else stampGrade();
      })();
    }
    function stampGrade() {
      var seal = front.querySelector(".rv2-seal");
      if (seal) {
        seal.style.opacity = "1";
        anim(seal, [{ transform: "translateZ(30px) scale(2.6) rotate(-14deg)", opacity: 0 }, { transform: "translateZ(30px) scale(.9) rotate(0deg)", opacity: 1, offset: 0.72 }, { transform: "translateZ(30px) scale(1)", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.3,.1,.3,1)" });
        later(function () { buzz(30); snd.stamp(); anim(floatEl, [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(0,4px,0)" }, { transform: "translate3d(0,0,0)" }], { duration: 160 }); }, RM ? 0 : 300);
      }
      later(done, RM ? 0 : 380);
    }
    function done() {
      phase = "done";
      var tn = q(".rv2-tiername"); tn.textContent = tierLabel(D.tier); tn.classList.add("on");
      var pc = q(".rv2-pct"); pc.textContent = S("pct")[D.tier]; pc.classList.add("on");
      var ti = q(".rv2-title"); ti.textContent = [D.name, D.setName, D.code].filter(Boolean).join(" · "); ti.classList.add("on");
      q(".rv2-actions").classList.add("on");
      q(".rv2-sr").textContent = tierLabel(D.tier) + ". " + S("pct")[D.tier] + ". " + serialText(D.serial, D.total);
      bindTilt(front.querySelector(".rv2-copy"), { gyro: true });
      if (!RM && (D.tier === "leggendaria" || D.tier === "mitica")) { // scintille che restano dopo il risultato (per ~5 s)
        var nE = 0, cl = D.tier === "mitica" ? MITICA_RAINBOW[palName()].concat(["#FFE7A3"]) : ["#FFE7A3", "#F0CF6E", "#FFFFFF"];
        (function drip() { if (!alive || phase !== "done" || nE++ > 12) return; fx.embers(D.tier === "mitica" ? 6 : 4, cl, { cy: cyCard(), spread: 0.9 }); later(drip, 420); })();
      }
      fillFair(true);
      if (opts.onDone) opts.onDone(D);
    }
    function reset() {
      timers.forEach(clearTimeout); timers = []; fx.clear();
      phase = "idle"; cur = -1; show(-1); setStageTier("sealed");
      if (flipper.getAnimations) flipper.getAnimations().forEach(function (a) { a.cancel(); });
      if (floatEl.getAnimations) floatEl.getAnimations().forEach(function (a) { a.cancel(); });
      flipper.style.transform = ""; floatEl.classList.add("bob");
      ["rv2-rays", "rv2-crownbox"].forEach(function (c) { q("." + c).classList.remove("on"); });
      plateWrap.classList.remove("on"); hint.classList.remove("hide", "gone");
      hint.innerHTML = "<b>" + esc(S("holdB")) + "</b>" + esc(S("holdRest"));
      ["rv2-tiername", "rv2-pct", "rv2-title", "rv2-actions"].forEach(function (c) { q("." + c).classList.remove("on"); });
      var seal = front.querySelector(".rv2-seal"); if (seal) seal.style.opacity = "0";
    }

    // --- verifica provably-fair (solo controllo, il livello resta quello del server) ---
    function fillFair(revealed) {
      var kv = q(".rv2-kv"), vr = q(".rv2-verify");
      var rows = [["Commit", D.commit || "—"], ["Seed", revealed && D.seed ? D.seed : S("seedHidden")], ["Nonce", D.nonce || "—"], [S("certKey"), D.certKey || "—"],
        ["Digest", revealed && D.digest ? D.digest + (D.roll != null ? "  →  roll " + Number(D.roll).toFixed(6) : "") : S("seedHidden")]];
      kv.innerHTML = rows.map(function (r) { return '<div class="kv"><dt>' + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
      if (D.demo) { vr.className = "rv2-verify"; vr.textContent = S("demo"); return; }
      if (!revealed || !D.seed || !D.commit) { vr.className = "rv2-verify"; vr.textContent = S("pending"); return; }
      Promise.all([sha256Hex(D.seed), D.nonce && D.certKey ? sha256Hex(D.seed + ":" + D.nonce + ":" + D.certKey) : Promise.resolve("")]).then(function (h) {
        var lines = [], ok = true;
        if (h[0] === D.commit) lines.push("✓ " + S("okCommit")); else ok = false;
        if (h[1] && D.digest) { if (h[1] === D.digest) lines.push("✓ " + S("okDigest")); else ok = false; }
        if (D.digest) {
          var roll = parseInt(D.digest.slice(0, 13), 16) / Math.pow(2, 52), tb = tierFromRoll(roll);
          if (tb[0] === D.tier) lines.push("✓ " + S("okTier", { roll: roll.toFixed(6), bucket: tb[1], tier: tierLabel(tb[0]) })); else ok = false;
        }
        vr.className = "rv2-verify " + (ok ? "ok" : "bad");
        vr.innerHTML = ok ? lines.map(esc).join("<br>") : esc(S("bad"));
      }).catch(function () { vr.className = "rv2-verify"; vr.textContent = ""; });
    }
    fillFair(false);

    // --- condividi (immagine generata) ---
    function share() {
      var c = doc.createElement("canvas"); c.width = 1080; c.height = 1350; var g = c.getContext("2d"), P = pal()[D.tier];
      var bg = g.createRadialGradient(540, 560, 60, 540, 560, 900); bg.addColorStop(0, "#1A0F3D"); bg.addColorStop(1, "#05040F");
      g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
      var gl = g.createRadialGradient(540, 560, 0, 540, 560, 520); gl.addColorStop(0, P[1]); gl.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.45; g.fillStyle = gl; g.fillRect(0, 0, 1080, 1350); g.globalAlpha = 1;
      g.textAlign = "center"; g.fillStyle = "#F4EFE4"; g.font = "650 40px Fraunces, Georgia, serif"; g.fillText("DreaMint", 540, 92);
      function text() {
        g.lineWidth = 10; g.strokeStyle = P[1]; g.strokeRect(290, 150, 500, 700);
        g.fillStyle = P[1]; g.font = "700 76px Fraunces, Georgia, serif"; g.fillText(tierLabel(D.tier).toUpperCase(), 540, 990);
        g.fillStyle = "#F4EFE4"; g.font = "600 34px JetBrains Mono, monospace"; g.fillText(serialText(D.serial, D.total), 540, 1050);
        g.font = "600 30px Inter Tight, sans-serif"; g.fillText(D.name || "", 540, 1104); g.fillText(S("pct")[D.tier], 540, 1150);
        g.fillStyle = "#8EFCE5"; g.font = "600 28px Inter Tight, sans-serif"; g.fillText("dreamint.it", 540, 1290);
        c.toBlob(function (blob) {
          if (!blob) return;
          var file = new File([blob], "dreamint.png", { type: "image/png" });
          var msg = S("shareText", { tier: tierLabel(D.tier), name: D.name, serial: pad4(D.serial) });
          if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: "DreaMint", text: msg }).catch(function () {});
          else { var a = doc.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "dreamint.png"; doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
        }, "image/png");
      }
      var src = D.art || LOGO, im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () { try { g.drawImage(im, 290, 150, 500, 700); g.getImageData(0, 0, 1, 1); } catch (e) { g.fillStyle = "#0A0820"; g.fillRect(290, 150, 500, 700); } text(); };
      im.onerror = text; im.src = src;
    }

    container.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rv2]"); if (!b) return;
      var k = b.getAttribute("data-rv2");
      if (k === "sound") { var on = snd.toggle(); b.textContent = S("sound") + ": " + (on ? S("on") : S("off")); b.setAttribute("aria-pressed", on ? "true" : "false"); }
      else if (k === "close" || k === "tocard") { if (opts.onClose) opts.onClose(phase === "done"); }
      else if (k === "share") share();
      else if (k === "replay") { reset(); later(start, 250); }
    });
    if (opts.autostart) later(start, RM ? 50 : 450);
    else if (D.autoplay) later(start, RM ? 200 : 900);
    return function unmount() {
      alive = false; timers.forEach(clearTimeout); fx.destroy(); global.removeEventListener("resize", onResize);
    };
  }

  /* ---------------- overlay di apertura dalla pagina carta ---------------- */
  function openOverlay(c, viewer) {
    var ov = doc.createElement("div"); ov.className = "rv2-overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    doc.body.appendChild(ov); doc.documentElement.classList.add("rv2-lock");
    var opened = false, un = null;
    function close() {
      if (un) un(); ov.remove(); doc.documentElement.classList.remove("rv2-lock"); doc.removeEventListener("keydown", onKey);
      if (opened) global.dispatchEvent(new HashChangeEvent("hashchange")); // ridisegna la pagina carta già aperta
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    doc.addEventListener("keydown", onKey);
    un = mount(ov, {
      card: Object.assign({}, c, { rarity_tier: null, serial_number: null }), viewer: viewer,
      fetchOpen: function () {
        return fetch("/api/cards/" + encodeURIComponent(c.id) + "/open", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.card) throw new Error(d.error || ("HTTP " + r.status)); opened = true; return d.card; }); });
      }
    }, { overlay: true, autostart: true, openFair: false, onClose: close });
  }

  /* ---------------- hook pagina carta e griglia Collezione ---------------- */
  function enhanceCard(c, viewer) {
    if (!c || c.is_ungraded) return;
    ensureTextures();
    var admin = !!(viewer && viewer.role === "admin");
    var root = doc.getElementById("app") || doc;
    hideTestPills(root, admin);
    var host = root.querySelector(".card-hero .slab-stage"); if (!host) return;
    if (!c.opened_at) {
      host.innerHTML = '<div class="rv2-hero-sealed rv2-anim" role="' + (c.can_open ? "button" : "img") + '" tabindex="' + (c.can_open ? "0" : "-1") + '" aria-label="' + esc(c.can_open ? S("openAria") : S("sealedOther")) + '">' +
        cosmosHtml(8) + '<div class="rv2-float bob">' + backHtml("sealed") + "</div>" +
        '<p class="rv2-hero-cta">' + (c.can_open ? "<b>" + esc(S("holdB")) + "</b> " + esc(S("holdRest")) : esc(S("sealedOther"))) + "</p></div>";
      var box = host.querySelector(".rv2-hero-sealed");
      drawStars(box.querySelector(".rv2-stars"));
      if (c.can_open) {
        var go = function () { askGyro(); buzz(10); openOverlay(c, viewer); };
        box.addEventListener("click", go);
        box.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      }
      return;
    }
    host.innerHTML = '<div class="rv2-hero" data-rv2-tier="' + esc(validTier(c.rarity_tier) || "comune") + '">' + copyHtml(copyOpts(c, viewer, { idle: true })) + "</div>";
    bindTilt(host.querySelector(".rv2-copy"), { gyro: true, idle: true });
  }
  function enhanceGrid(cards, viewer) {
    var admin = !!(viewer && viewer.role === "admin"), map = {};
    (cards || []).forEach(function (c) { if (c && c.id) map[c.id] = c; });
    var root = doc.getElementById("app") || doc;
    root.querySelectorAll('a.slab-tile[href^="#/carta/"]').forEach(function (a) {
      var id = decodeURIComponent(a.getAttribute("href").slice(8)), c = map[id];
      if (!c || c.is_ungraded) return;
      var slab = a.querySelector(".slab-3d"); if (!slab) return;
      var w = doc.createElement("div"); w.className = "rv2-tile";
      w.innerHTML = copyHtml(copyOpts(c, viewer, { sealed: !c.opened_at }));
      slab.replaceWith(w); a.classList.add("rv2-has");
      bindTilt(w.querySelector(".rv2-copy"), {});
    });
    hideTestPills(root, admin);
    ensureTextures();
  }

  // Anteprima palette del ventaglio: ?rvpal=ref2 (solo locale/preview, default = token esistenti)
  // Default unico: colori dei livelli già in uso nel sito. La palette ref2 resta solo come anteprima con ?rvpal=ref2 (non salvata).
  try { localStorage.removeItem("rv2-pal"); if (/[?&]rvpal=ref2\b/.test(location.search)) doc.documentElement.setAttribute("data-rv2-pal", "ref2"); } catch (e) { /* storage bloccato */ }

  global.DreamintRevealV2 = { mount: mount, enhanceCard: enhanceCard, enhanceGrid: enhanceGrid, backHtml: backHtml, copyHtml: copyHtml, crownSvg: crownSvg, setPalette: setPalette, ensureTextures: ensureTextures, _genTex: genTex };
})(window);
