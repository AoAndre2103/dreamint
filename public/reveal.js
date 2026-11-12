
(function (global) {
  "use strict";
  var TIER_COLORS = { comune: "#c5c9d1", rara: "#5aa8ff", epica: "#c084fc", leggendaria: "#ffc14a", mitica: "#ff7a3d" };
  var TIER_DURS = { comune: 900, rara: 1800, epica: 2800, leggendaria: 4400, mitica: 5800 };
  var SUSPENSE_COLORS = ["#9aa3ad", "#3d7cff", "#b46cff", "#e8c872", "#ff7a3d"];
  var HOLD_MS = 850;
  var RV = {
    it: {
      holdAria: "Tieni premuto per rivelare la rarità",
      holdHintB: "Tieni premuto",
      holdHintRest: "per rivelare la rarità",
      soundOn: "Suono: on",
      soundOff: "Suono: off",
      extractTitle: "Estrazione verificabile",
      extractLead: "Prima dell’apertura è stato pubblicato il commit. Dopo la rivelazione puoi verificare che il seed non è stato cambiato. Estrazione gratuita, una sola volta, senza riprove a pagamento.",
      seedHidden: "Nascosto fino alla rivelazione",
      commitPending: "Commit pubblicato. Il seed verrà svelato all’apertura.",
      verifyOk: "Verifica ok: sha256(seed) coincide con il commit. Livello derivato dal digest.",
      verifyFail: "Verifica non riuscita: il commit non corrisponde.",
      shareText: "Ho rivelato un {tier} su DreaMint: {name} #{serial} — {pct}",
      certKey: "Chiave certificato"
    },
    en: {
      holdAria: "Hold to reveal the rarity",
      holdHintB: "Hold",
      holdHintRest: "to reveal the rarity",
      soundOn: "Sound: on",
      soundOff: "Sound: off",
      extractTitle: "Verifiable reveal",
      extractLead: "The commit was published before the reveal. Afterward you can check that the seed was not changed. The draw is free, only once, with no paid rerolls.",
      seedHidden: "Hidden until the reveal",
      commitPending: "Commit published. The seed will be shown when it is opened.",
      verifyOk: "Verified: sha256(seed) matches the commit. The tier is derived from the digest.",
      verifyFail: "Verification failed: the commit does not match.",
      shareText: "I revealed a {tier} on DreaMint: {name} #{serial} — {pct}",
      certKey: "Certificate key"
    }
  };
  function langIsEn() {
    return global.DreamintI18n && global.DreamintI18n.getLang && global.DreamintI18n.getLang() === "en";
  }
  function tr(key, vars) {
    if (global.DreamintI18n && global.DreamintI18n.t) {
      var v = global.DreamintI18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return key;
  }
  function rv(key, vars) {
    var pack = langIsEn() ? RV.en : RV.it;
    var str = pack[key] || RV.it[key] || key;
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? "" : String(vars[k]); });
  }
  function tierInfo(id) {
    id = TIER_COLORS[id] ? id : "comune";
    var fallback = { comune: "Comune", rara: "Rara", epica: "Epica", leggendaria: "Leggendaria", mitica: "Mitica" };
    var pctFallback = {
      comune: "Il 70% delle carte", rara: "Il 20% delle carte", epica: "L’8% delle carte",
      leggendaria: "Solo l’1,9% delle carte", mitica: "Solo lo 0,1% delle carte · 1 su 1000"
    };
    var label = tr("tier." + id);
    if (label === "tier." + id) label = fallback[id];
    var pct = tr("tier." + id + ".callout");
    if (pct === "tier." + id + ".callout") pct = pctFallback[id];
    else if (id === "mitica") pct = pct + (langIsEn() ? " · 1 in 1,000" : " · 1 su 1000");
    var badge = id === "mitica" ? tr("tier.mitica.badge") : label;
    if (badge === "tier.mitica.badge") badge = "Mitica · 1 su 1000";
    return { id: id, label: label, color: TIER_COLORS[id], dur: TIER_DURS[id], pct: pct, badge: badge };
  }
  function italianInt(n) {
    var sep = langIsEn() ? "," : ".";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function lerpColor(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return "rgb(" + Math.round(A[0] + (B[0] - A[0]) * t) + "," + Math.round(A[1] + (B[1] - A[1]) * t) + "," + Math.round(A[2] + (B[2] - A[2]) * t) + ")";
  }
  function colorAlong(progress, steps) {
    var max = Math.max(1, steps - 1);
    var x = progress * max;
    var i = Math.min(Math.floor(x), max - 1);
    return lerpColor(SUSPENSE_COLORS[i], SUSPENSE_COLORS[i + 1], x - i);
  }

  function mount(container, data) {
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var tier = tierInfo(data.tier);
    var photo = data.photoUrl || "";
    container.innerHTML =
      '<div class="stage-wrap"><div class="stage" id="rv-stage">' +
      '<div class="rv-vignette" id="rv-vignette"></div><div class="rv-rays" id="rv-rays"></div>' +
      '<div class="glow"></div><div class="flash" id="rv-flash"></div><div class="rv-shock" id="rv-shock"></div><canvas id="rv-fx"></canvas>' +
      '<svg class="hold-ring" viewBox="0 0 200 280" aria-hidden="true"><circle id="rv-ring" cx="100" cy="140" r="98" pathLength="100" stroke-dasharray="0 100" opacity="0.9"/></svg>' +
      '<button class="scene" id="rv-card" type="button" aria-label="' + rv("holdAria") + '" data-tier="">' +
      '<div class="face back"><div class="back-art">' +
      '<div class="dreamint-card-back">' +
      '<img src="/img/dreamint-icon.webp?v=20261110d" width="512" height="512" alt="">' +
      '</div></div><div class="slab-glass"></div></div>' +
      '<div class="face front"><div class="front-art' + (photo ? ' has-photo' : '') + '" id="rv-front">' +
      (photo
        ? '<img class="digital-photo" id="rv-photo" src="' + photo + '"' + (data.photoSrcset ? ' srcset="' + data.photoSrcset + '" sizes="210px"' : '') + ' alt="">'
        : '<div class="digital-ph">' + tr("ph.sellerPhoto") + "</div>") +
      '<div class="slab-holo"></div><div class="slab-shine"></div><div class="slab-foil"></div><div class="slab-glare"></div><div class="slab-noise"></div>' +
      '<div class="digital-overlay"><div class="digital-overlay-top"><span class="df-tier" id="rv-df-tier"></span></div>' +
      '<div class="digital-overlay-bot"><div><span class="df-grader" id="rv-df-grader"></span><span class="df-cert" id="rv-df-cert"></span><span class="df-serial" id="rv-df-serial"></span></div>' +
      '<span class="df-grade" id="rv-df-grade"></span></div></div>' +
      '<div class="front-labels"><b></b><span></span></div></div><div class="foil"></div><div class="slab-glass"></div>' +
      (tier.id === "leggendaria" || tier.id === "mitica" ? '<div class="slab-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i>' + (tier.id === "mitica" ? "<i></i><i></i><i></i>" : "") + "</div>" : "") +
      "</div>" +
      '</button><div class="hint" id="rv-hint"><b>' + rv("holdHintB") + "</b>" + rv("holdHintRest") + "</div></div></div>" +
      '<p class="row" style="justify-content:center"><button type="button" class="btn ghost sound-toggle" id="rv-sound" aria-pressed="false">' + rv("soundOff") + "</button></p>" +
      '<section class="result" aria-live="polite"><div class="tier-name" id="rv-tier"></div><div class="rarity-pct" id="rv-pct"></div><div class="serial" id="rv-serial"></div><div class="meta-line" id="rv-meta"></div>' +
      '<div class="fullset" id="rv-fullset">Full Set</div></section>' +
      '<div class="actions row" style="justify-content:center"><button class="btn primary" id="rv-share" type="button" disabled>' + (tr("card.share") !== "card.share" ? tr("card.share") : "Condividi") + "</button></div>" +
      '<section class="panel"><h2>' + (tr("card.extract") !== "card.extract" ? tr("card.extract") : rv("extractTitle")) + "</h2>" +
      '<p class="muted" style="margin-bottom:10px">' + rv("extractLead") + "</p>" +
      '<div class="kv"><dt>Commit</dt><dd id="rv-commit"></dd></div>' +
      '<div class="kv"><dt>Seed</dt><dd id="rv-seed">' + rv("seedHidden") + "</dd></div>" +
      '<div class="kv"><dt>Nonce</dt><dd id="rv-nonce"></dd></div>' +
      '<div class="kv"><dt>' + rv("certKey") + '</dt><dd id="rv-cert"></dd></div>' +
      '<div class="kv"><dt>Digest</dt><dd id="rv-digest">' + rv("seedHidden") + "</dd></div>" +
      '<div class="verify" id="rv-verify">' + rv("commitPending") + "</div></section>";

    var $ = function (id) { return document.getElementById(id); };
    var card = $("rv-card");
    var hint = $("rv-hint");
    var ring = $("rv-ring");
    var stage = $("rv-stage");
    var flash = $("rv-flash");
    var canvas = $("rv-fx");
    var ctx = canvas.getContext("2d");
    var labels = container.querySelector(".front-labels");
    labels.querySelector("b").textContent = data.name || tr("share.card");
    labels.querySelector("span").textContent = (data.code || "") + (data.grader ? "  ·  " + (data.grader === "NONE" ? tr("grader.NONE") : data.grader + (data.grade ? " " + data.grade : "")) : "");
    var dfGrader = $("rv-df-grader");
    if (dfGrader) {
      dfGrader.textContent = data.grader && data.grader !== "NONE" ? data.grader : "DreaMint";
      $("rv-df-cert").textContent = data.certKey || "";
      $("rv-df-grade").textContent = data.grade || "";
    }

    $("rv-commit").textContent = data.commit || "—";
    $("rv-nonce").textContent = data.nonce || "—";
    $("rv-cert").textContent = data.certKey || "—";

    var state = { phase: "idle", holding: false, particles: [], lastTs: 0, holdTimer: 0, alive: true };
    function setTierColor(color, id) {
      document.documentElement.style.setProperty("--tier", color);
      if (id) card.setAttribute("data-tier", id);
    }
    var audioCtx = null;
    state.soundOn = false;
    var soundBtn = $("rv-sound");
    if (soundBtn) {
      soundBtn.addEventListener("click", function () {
        state.soundOn = !state.soundOn;
        soundBtn.textContent = state.soundOn ? rv("soundOn") : rv("soundOff");
        soundBtn.setAttribute("aria-pressed", state.soundOn ? "true" : "false");
        if (state.soundOn) audio();
      });
    }
    function audio() {
      if (!state.soundOn) return null;
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    }
    function envGain(ctx, t, dur, peak) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.03, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      return g;
    }
    function tone(ctx, type, freq, t, dur, peak) {
      var o = ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      var g = envGain(ctx, t, dur, peak);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function playSuspense() {
      var ctx = audio(); if (!ctx) return;
      var t = ctx.currentTime, dur = (reduceMotion ? 400 : tier.dur) / 1000;
      var o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(tier.id === "mitica" ? 520 : 330, t + dur);
      var g = envGain(ctx, t, dur, 0.035);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function playReveal() {
      var ctx = audio(); if (!ctx) return;
      var t = ctx.currentTime;
      tone(ctx, "sine", 523.25, t, 0.5, 0.07);
      tone(ctx, "triangle", 784, t + 0.06, 0.35, 0.03);
      if (tier.id === "leggendaria" || tier.id === "mitica") {
        tone(ctx, "sine", 659.25, t + 0.04, 0.7, 0.05);
        tone(ctx, "sine", 1046.5, t + 0.12, 0.5, 0.04);
      }
    }
    function vibrate() {
      if (!navigator.vibrate) return;
      var patterns = { comune: [40], rara: [40, 40, 80], epica: [30, 40, 30, 40, 120], leggendaria: [20, 30, 20, 30, 20, 30, 200], mitica: [40, 50, 40, 50, 80, 80, 420] };
      try { navigator.vibrate(patterns[tier.id] || [40]); } catch (e) {}
    }
    function resizeCanvas() {
      var r = stage.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function burst(x, y, color, n, speed, opts) {
      opts = opts || {};
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, s = (Math.random() * 0.7 + 0.3) * speed;
        state.particles.push({
          x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1,
          decay: 0.008 + Math.random() * 0.012, size: 1.4 + Math.random() * 2.8,
          color: color, g: opts.g === undefined ? 28 : opts.g, spark: !!opts.spark,
          rect: !!opts.confetti, rot: Math.random() * 360, rv: (Math.random() - 0.5) * 12,
          w: 3 + Math.random() * 5, h: 7 + Math.random() * 8
        });
      }
    }
    function pump(fn) {
      var ran = false;
      function run(t) { if (!state.alive || ran) return; ran = true; fn(t || performance.now()); }
      requestAnimationFrame(run);
      setTimeout(run, 16);
    }
    function tickFx(ts) {
      state.raf = 1;
      pump(tickFx);
      var dt = Math.min(0.033, (ts - (state.lastTs || ts)) / 1000);
      state.lastTs = ts;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (var i = state.particles.length - 1; i >= 0; i--) {
        var p = state.particles[i];
        p.vy += p.g * dt; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.life -= p.decay * (dt * 60);
        if (p.life <= 0) { state.particles.splice(i, 1); continue; }
        var rgb = hexToRgb(p.color);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        if (p.rect) {
          p.rot += p.rv;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot * Math.PI / 180);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function startHold(e) {
      if (state.phase !== "idle") return;
      if (e && e.preventDefault) e.preventDefault();
      audio();
      state.holding = true;
      var start = performance.now();
      function tick() {
        if (!state.holding) return;
        var p = Math.min(1, (performance.now() - start) / HOLD_MS);
        ring.style.strokeDasharray = (p * 100).toFixed(2) + " 100";
        if (p >= 1) { state.holding = false; beginReveal(); return; }
        state.holdTimer = setTimeout(tick, 16);
      }
      state.holdTimer = setTimeout(tick, 16);
    }
    function cancelHold() {
      if (!state.holding) return;
      state.holding = false;
      clearTimeout(state.holdTimer);
      ring.style.strokeDasharray = "0 100";
    }
    function spawnConverge(n, color) {
      var r = stage.getBoundingClientRect();
      var cx = r.width / 2, cy = r.height / 2;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var dist = 90 + Math.random() * 160;
        var x = cx + Math.cos(a) * dist;
        var y = cy + Math.sin(a) * dist;
        state.particles.push({
          x: x, y: y, vx: (cx - x) * 0.022, vy: (cy - y) * 0.022,
          life: 1, decay: 0.014 + Math.random() * 0.012,
          size: 1.05 + Math.random() * 1.9, color: color, g: 0, spark: true, rect: false
        });
      }
    }
    function beginReveal() {
      state.phase = "running";
      card.classList.add("busy");
      stage.classList.add("is-charging");
      hint.innerHTML = "<b>La gemma si accende</b>resta a guardare";
      ring.style.strokeDasharray = "0 100";
      var steps = TIERS.findIndex(function (t) { return t.id === tier.id; }) + 1;
      var dur = reduceMotion ? 280 : tier.dur;
      playSuspense();
      var t0 = performance.now();
      var lastSpawn = 0;
      function sus() {
        var now = performance.now();
        var p = Math.min(1, (now - t0) / dur);
        var col = colorAlong(p, steps);
        setTierColor(col, "");
        if (!reduceMotion && now - lastSpawn > (tier.id === "mitica" ? 70 : 110)) {
          spawnConverge(tier.id === "mitica" ? 10 : tier.id === "leggendaria" ? 7 : 4, col);
          lastSpawn = now;
        }
        var shake = p * (tier.id === "mitica" ? 7 : tier.id === "leggendaria" ? 5 : 3);
        var ox = Math.sin(now / 40) * shake;
        card.style.transform = "translate3d(" + ox + "px,0,0)";
        if (p < 1) pump(sus);
        else { card.style.transform = ""; flipReveal(); }
      }
      pump(sus);
    }
    function flipReveal() {
      setTierColor(tier.color, tier.id);
      stage.classList.remove("is-charging");
      hint.classList.add("hidden");
      flash.className = "flash bang bang-" + tier.id;
      void flash.offsetWidth;
      playReveal(); vibrate();
      var r = stage.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
      var shock = $("rv-shock");
      if (shock && !reduceMotion && (tier.id === "leggendaria" || tier.id === "mitica" || tier.id === "epica")) {
        shock.classList.remove("boom"); void shock.offsetWidth; shock.classList.add("boom");
      }
      if (!reduceMotion) {
        card.classList.add("flip-blur");
        setTimeout(function () { card.classList.remove("flip-blur"); }, 780);
        if (tier.id === "comune") { /* matte: solo il flip */ }
        else if (tier.id === "rara") burst(cx, cy, tier.color, 22, 3.2);
        else if (tier.id === "epica") { burst(cx, cy, tier.color, 46, 4.2); burst(cx, cy, "#f6f0e6", 16, 2.8, { spark: true }); }
        else if (tier.id === "leggendaria") {
          burst(cx, cy, "#ffc14a", 90, 6.2);
          burst(cx, cy, "#fff1b0", 70, 5.4, { confetti: true, g: 38 });
          stage.classList.add("shake", "shake-lg");
          setTimeout(function () { stage.classList.remove("shake", "shake-lg"); }, 800);
        } else {
          ["#ff8ad4", "#5aa8ff", "#ffc14a", "#6ef3c0", "#c084fc"].forEach(function (c) {
            burst(cx, cy, c, 36, 6.6, { spark: true });
            burst(cx, cy, c, 22, 5.8, { confetti: true, g: 36 });
          });
          stage.classList.add("shake", "shake-myth");
          setTimeout(function () { stage.classList.remove("shake", "shake-myth"); }, 1100);
        }
      }
      card.classList.add("flipping", "is-front", "done");
      card.setAttribute("data-tilt", "");
      if (window.GemintMotion) window.GemintMotion.enhance();
      setTimeout(showResult, reduceMotion ? 80 : 820);
    }
    function sha256Hex(str) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
        return Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    }
    function showResult() {
      $("rv-tier").textContent = (tier.badge || tier.label).toUpperCase();
      $("rv-tier").className = "tier-name tier-" + tier.id + " show";
      var pct = $("rv-pct");
      if (pct) { pct.textContent = tier.pct || ""; pct.classList.add("show"); }
      var dfTier = $("rv-df-tier");
      if (dfTier) dfTier.textContent = tier.badge || tier.label;
      var dfSerial = $("rv-df-serial");
      if (dfSerial) dfSerial.textContent = "#" + String(data.serial || 1).padStart(4, "0") + " / " + (data.total ? String(data.total) : "∞");
      $("rv-meta").textContent = (data.name || "") + "  ·  " + (data.setName || "") + (data.code ? "  ·  " + data.code : "");
      $("rv-meta").classList.add("show");
      if (data.fullSet === "yes" || data.fullSet === true) $("rv-fullset").classList.add("show");
      $("rv-seed").textContent = data.seed || "—";
      $("rv-digest").textContent = (data.digest || "—") + (data.roll != null ? "  →  roll " + Number(data.roll).toFixed(6) : "");
      if (data.seed && data.commit) {
        sha256Hex(data.seed).then(function (check) {
          var el = $("rv-verify");
          if (check === data.commit) { el.className = "verify ok"; el.textContent = rv("verifyOk"); }
          else { el.className = "verify"; el.style.color = "#ffd166"; el.textContent = rv("verifyFail"); }
        });
      }
      animateSerial();
      $("rv-share").disabled = false;
      state.phase = "done";
    }
    function animateSerial() {
      var el = $("rv-serial"); el.classList.add("show");
      var target = data.serial || 1, total = data.total || target;
      var startVal = Math.max(target + 80, 220);
      var dur = reduceMotion ? 200 : 1800, t0 = performance.now();
      function tick() {
        var now = performance.now();
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 4);
        var n = Math.round(startVal + (target - startVal) * eased);
        el.innerHTML = (data.name || tr("share.card")) + ' <span class="hash">#' + String(n).padStart(4, "0") + " / " + (total ? String(total) : "∞") + "</span>";
        if (p < 1) pump(tick);
        else el.innerHTML = (data.name || tr("share.card")) + ' <span class="hash">#' + String(target).padStart(4, "0") + " / " + (total ? String(total) : "∞") + "</span>";
      }
      pump(tick);
    }
    function shareResult() {
      var c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
      var g = c.getContext("2d");
      function paintChrome() {
        var grd = g.createLinearGradient(0, 0, 0, 1350);
        grd.addColorStop(0, tier.id === "mitica" ? "#0a0610" : "#140814");
        grd.addColorStop(1, "#0a0810");
        g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
        g.fillStyle = tier.color; g.globalAlpha = 0.22;
        g.beginPath(); g.arc(540, 520, 380, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.fillStyle = "#f8e7b4"; g.textAlign = "center";
        g.font = "650 32px Fraunces, Georgia, serif";
        g.fillText("DreaMint", 540, 96);
      }
      function paintText() {
        g.fillStyle = tier.color; g.font = "650 60px Fraunces, Georgia, serif";
        g.fillText((tier.badge || tier.label).toUpperCase(), 540, 1048);
        g.fillStyle = "#f8e7b4"; g.font = "600 28px JetBrains Mono, monospace";
        g.fillText((data.name || tr("share.card")), 540, 1100);
        g.fillText("#" + String(data.serial || 1).padStart(4, "0") + "  /  " + (data.total ? String(data.total) : "∞"), 540, 1144);
        g.font = "600 22px Inter Tight, sans-serif";
        g.fillText(tier.pct || "", 540, 1192);
        if (data.fullSet === "yes" || data.fullSet === true) {
          g.strokeStyle = "rgba(232,200,114,0.9)"; g.strokeRect(390, 1220, 300, 54);
          g.fillText("FULL SET", 540, 1256);
        }
      }
      function exportPng() {
        c.toBlob(function (blob) {
          if (!blob) return;
          var file = new File([blob], "dreamint.png", { type: "image/png" });
          var text = rv("shareText", { tier: tier.label, name: data.name || "", serial: String(data.serial || 1).padStart(4, "0"), pct: tier.pct || "" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: "DreaMint", text: text }).catch(function () { download(blob); });
          } else download(blob);
        }, "image/png");
      }
      paintChrome();
      function afterImg() { paintText(); exportPng(); }
      if (data.photoUrl) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
          g.save();
          g.beginPath();
          if (g.roundRect) g.roundRect(260, 140, 560, 780, 12); else g.rect(260, 140, 560, 780);
          g.clip();
          g.drawImage(img, 260, 140, 560, 780);
          g.restore();
          g.lineWidth = 8; g.strokeStyle = tier.color; g.strokeRect(260, 140, 560, 780);
          afterImg();
        };
        img.onerror = afterImg;
        img.src = data.photoUrl;
      } else afterImg();
    }
    function download(blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "dreamint.png";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }

    card.addEventListener("pointerdown", function (e) { if (e.button != null && e.button !== 0) return; startHold(e); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { card.addEventListener(ev, cancelHold); });
    card.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    $("rv-share").addEventListener("click", shareResult);
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    requestAnimationFrame(tickFx);
    if (data.autoplay) {
      setTimeout(function () { if (state.phase === "idle") beginReveal(); }, reduceMotion ? 200 : 700);
    }
    return function unmount() {
      state.alive = false;
      cancelAnimationFrame(state.raf);
      window.removeEventListener("resize", resizeCanvas);
    };
  }

  global.GemintReveal = { mount: mount };
})(window);
