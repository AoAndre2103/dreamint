(function (global) {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var slabs = [];
  var running = false;
  var gyroGranted = false;
  var gyroAsked = false;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function ensureLoop() {
    if (running || reduce) return;
    running = true;
    function tick() {
      var live = 0;
      var now = performance.now() / 1000;
      for (var i = 0; i < slabs.length; i++) {
        var s = slabs[i];
        if (!s.el.isConnected) continue;
        live++;
        if (!s.hover) {
          var tier = s.el.getAttribute("data-tier") || "";
          if (tier === "epica" || tier === "leggendaria" || tier === "mitica") {
            var drift = tier === "mitica" ? 22 : tier === "leggendaria" ? 16 : 12;
            s.thx = 50 + Math.sin(now * 0.65 + i) * drift;
            s.thy = 38 + Math.cos(now * 0.48 + i * 0.7) * 14;
            s.trx = s.restX + Math.sin(now * 0.38 + i) * 2.6;
            s.tryv = s.restY + Math.cos(now * 0.33 + i) * 3.4;
            s.el.classList.add("is-live");
          }
        }
        s.rx = lerp(s.rx, s.trx, 0.13);
        s.ry = lerp(s.ry, s.tryv, 0.13);
        s.hx = lerp(s.hx, s.thx, 0.16);
        s.hy = lerp(s.hy, s.thy, 0.16);
        s.el.style.setProperty("--rx", s.rx.toFixed(3) + "deg");
        s.el.style.setProperty("--ry", s.ry.toFixed(3) + "deg");
        s.el.style.setProperty("--rxn", s.rx.toFixed(3));
        s.el.style.setProperty("--ryn", s.ry.toFixed(3));
        s.el.style.setProperty("--hx", s.hx.toFixed(2) + "%");
        s.el.style.setProperty("--hy", s.hy.toFixed(2) + "%");
      }
      if (!live) slabs = slabs.filter(function (x) { return x.el.isConnected; });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function bindSlab(el) {
    if (el._foilBound || reduce) return;
    el._foilBound = true;
    var restX = parseFloat(getComputedStyle(el).getPropertyValue("--rx")) || 8;
    var restY = parseFloat(getComputedStyle(el).getPropertyValue("--ry")) || -12;
    var s = { el: el, rx: restX, ry: restY, hx: 50, hy: 36, trx: restX, tryv: restY, thx: 50, thy: 36, restX: restX, restY: restY, hover: false };
    slabs.push(s);
    var tier = el.getAttribute("data-tier") || "";
    var amp = { comune: 8, rara: 14, epica: 18, leggendaria: 22, mitica: 26 }[tier] || 16;
    el.addEventListener("pointerenter", function () { s.hover = true; askGyro(); });
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / Math.max(1, r.width);
      var py = (e.clientY - r.top) / Math.max(1, r.height);
      s.tryv = (px - 0.5) * amp;
      s.trx = (0.5 - py) * (amp * 0.72);
      s.thx = px * 100;
      s.thy = py * 100;
      el.classList.add("is-live");
    });
    el.addEventListener("pointerleave", function () {
      s.hover = false;
      s.trx = s.restX; s.tryv = s.restY; s.thx = 50; s.thy = 36;
      el.classList.remove("is-live");
    });
    ensureLoop();
  }

  function onOrient(e) {
    if (reduce) return;
    var gy = Math.max(-28, Math.min(28, e.gamma || 0));
    var gx = Math.max(-28, Math.min(28, e.beta || 0));
    for (var i = 0; i < slabs.length; i++) {
      var s = slabs[i];
      if (s.hover || !s.el.isConnected) continue;
      s.tryv = gy * 0.42;
      s.trx = (gx - 36) * 0.16;
      s.thx = 50 + gy * 1.1;
      s.thy = 40 + gx * 0.35;
    }
  }

  function askGyro() {
    if (gyroAsked || reduce) return;
    gyroAsked = true;
    function listen() {
      if (gyroGranted) return;
      gyroGranted = true;
      window.addEventListener("deviceorientation", onOrient, { passive: true });
    }
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then(function (st) { if (st === "granted") listen(); }).catch(function () {});
      } else if (window.DeviceOrientationEvent) listen();
    } catch (err) {}
  }

  function magnetic() {
    if (reduce) return;
    document.querySelectorAll(".btn").forEach(function (el) {
      if (el._magV6) return;
      el._magV6 = true;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var x = e.clientX - r.left;
        var y = e.clientY - r.top;
        el.style.setProperty("--mx", x + "px");
        el.style.setProperty("--my", y + "px");
        var dx = (x / r.width - 0.5) * 10;
        var dy = (y / r.height - 0.5) * 7;
        el.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
      });
      el.addEventListener("pointerleave", function () { el.style.transform = ""; });
    });
  }

  function pageMotions() {
    if (reduce || !global.gsap) return;
    var gsap = global.gsap;
    if (global.ScrollTrigger) {
      gsap.registerPlugin(global.ScrollTrigger);
      global.ScrollTrigger.getAll().forEach(function (t) { t.kill(); });
    }
    var title = document.querySelector(".hero-title");
    if (title) {
      gsap.from(title.querySelectorAll(".hero-line > span"), {
        yPercent: 120, duration: 1.05, stagger: 0.11, ease: "power4.out"
      });
      gsap.from(".hero .kicker, .hero .lede, .hero-actions, .games-line", {
        opacity: 0, y: 18, duration: 0.75, stagger: 0.07, delay: 0.18, ease: "power3.out"
      });
      gsap.from(".hero-card", {
        opacity: 0, y: 28, duration: 0.9, stagger: 0.1, delay: 0.28, ease: "power3.out"
      });
    }
    var items = document.querySelectorAll(".ladder-item");
    if (items.length) {
      gsap.from(items, {
        opacity: 0, y: 22, duration: 0.7, stagger: 0.09, ease: "power3.out", delay: 0.08
      });
    }
    gsap.utils.toArray(".rare-showcase, .split, .just-in, .panel, .owned-rare-banner").forEach(function (el) {
      gsap.from(el, {
        opacity: 0, y: 20, duration: 0.7, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 92%", once: true }
      });
    });
    if (global.ScrollTrigger) {
      requestAnimationFrame(function () { global.ScrollTrigger.refresh(); });
    }
  }

  function heroFan() {
    var root = document.querySelector("[data-hero-fan]");
    if (!root || root._hfBound) return;
    root._hfBound = true;
    var cards = [].slice.call(root.querySelectorAll("[data-hero-card]"));
    if (!cards.length) return;
    var order = cards.map(function (_, i) { return i; });
    var spins = cards.map(function () { return { y: 0, v: 0, dragging: false, target: null }; });

    function layout() {
      cards.forEach(function (el, i) {
        var pos = order.indexOf(i);
        el.dataset.pos = String(pos - 1);
        el.classList.toggle("is-front", pos === 1);
      });
    }
    function bringToFront(i) {
      var guard = 0;
      while (order[1] !== i && guard++ < cards.length) order.push(order.shift());
      layout();
    }
    cards.forEach(function (el, i) {
      var spinEl = el.querySelector("[data-spin]");
      var st = spins[i];
      var startX = 0, startY = 0, lastX = 0, lastT = 0, moved = false;
      el.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        st.dragging = true;
        st.target = null;
        moved = false;
        startX = lastX = e.clientX;
        startY = e.clientY;
        lastT = performance.now();
        st.v = 0;
        el.classList.add("is-grabbing");
      });
      el.addEventListener("pointermove", function (e) {
        if (!st.dragging) return;
        var dx = e.clientX - lastX;
        if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 8) moved = true;
        var now = performance.now();
        var dt = Math.max(8, now - lastT);
        st.y += dx * 0.6;
        st.v = (dx * 0.6) / dt * 16;
        lastX = e.clientX;
        lastT = now;
        spinEl.style.setProperty("--spin", st.y.toFixed(2) + "deg");
      });
      function endDrag() {
        if (!st.dragging) return;
        st.dragging = false;
        el.classList.remove("is-grabbing");
        if (!moved) {
          if (el.classList.contains("is-front")) st.target = Math.round(st.y / 180) * 180 + 180;
          else bringToFront(i);
        }
      }
      el.addEventListener("pointerup", endDrag);
      el.addEventListener("pointercancel", endDrag);
      el.addEventListener("click", function (e) { if (moved) e.preventDefault(); });
    });
    function tick() {
      if (!root.isConnected) { root._hfBound = false; return; }
      cards.forEach(function (el, i) {
        var st = spins[i];
        var spinEl = el.querySelector("[data-spin]");
        if (!spinEl) return;
        if (!st.dragging) {
          if (st.target != null) {
            var diff = st.target - st.y;
            st.y += diff * 0.14;
            st.v = 0;
            if (Math.abs(diff) < 0.4) { st.y = st.target; st.target = null; }
          } else if (Math.abs(st.v) > 0.08) {
            st.y += st.v;
            st.v *= 0.935;
          } else {
            st.v = 0;
            if (!reduce && !document.documentElement.classList.contains("lowfx")) st.y += el.classList.contains("is-front") ? 0.22 : 0.09;
          }
        }
        spinEl.style.setProperty("--spin", st.y.toFixed(2) + "deg");
        var slab = el.querySelector(".slab-3d");
        if (slab) {
          var rad = (st.y * Math.PI) / 180;
          slab.style.setProperty("--hx", (50 + Math.sin(rad) * 42).toFixed(1) + "%");
          slab.style.setProperty("--hy", (38 + Math.cos(rad) * 16).toFixed(1) + "%");
          if (!st.dragging) slab.classList.add("is-live");
        }
      });
      requestAnimationFrame(tick);
    }
    layout();
    requestAnimationFrame(tick);
  }

  function enhance() {
    document.querySelectorAll("[data-tilt]").forEach(function (el) {
      if (el.closest("[data-hero-card]")) return;
      bindSlab(el);
    });
    magnetic();
    pageMotions();
    heroFan();
  }

  global.GemintMotion = { enhance: enhance, askGyro: askGyro, heroFan: heroFan };
})(window);
