(function (root) {
  "use strict";

  var TIER_COLORS = {
    comune: "#8a8680",
    rara: "#3d7cff",
    epica: "#b46cff",
    leggendaria: "#e8c872",
    mitica: "#ff7a3d"
  };
  var TIER_LABELS = {
    comune: "Comune",
    rara: "Rara",
    epica: "Epica",
    leggendaria: "Leggendaria",
    mitica: "Mitica"
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (!src) return reject(new Error("no src"));
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("img")); };
      img.src = src;
    });
  }

  function serialLabel(data) {
    if (data.serial_label) return data.serial_label;
    if (data.serial == null && data.serial_number == null) return "";
    var n = data.serial_number != null ? data.serial_number : data.serial;
    var left = "#" + String(n).padStart(4, "0");
    var total = data.serial_total || data.total;
    if (total == null || total === "") return left + " / ∞";
    var t = String(total);
    if (/^\d+$/.test(t)) t = t.padStart(4, "0");
    return left + " / " + t;
  }

  function drawRounded(g, x, y, w, h, r) {
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.rect(x, y, w, h);
  }

  function paintCard(g, img, x, y, w, h, color, thick) {
    g.save();
    g.beginPath();
    drawRounded(g, x, y, w, h, 16);
    g.clip();
    if (img) {
      var ir = img.width / img.height;
      var cr = w / h;
      var dw, dh, dx, dy;
      if (ir > cr) { dh = h; dw = h * ir; dx = x - (dw - w) / 2; dy = y; }
      else { dw = w; dh = w / ir; dx = x; dy = y - (dh - h) / 2; }
      g.drawImage(img, dx, dy, dw, dh);
    } else {
      g.fillStyle = "#1a1408";
      g.fillRect(x, y, w, h);
    }
    g.restore();
    g.lineWidth = thick;
    g.strokeStyle = color;
    g.beginPath();
    drawRounded(g, x, y, w, h, 16);
    g.stroke();
  }

  function paintLogo(g, logo, x, y, w) {
    if (!logo) return;
    var h = w * (logo.height / logo.width);
    g.drawImage(logo, x - w / 2, y, w, h);
  }

  async function renderSocialCanvas(data, size) {
    var w = size === "og" ? 1200 : 1080;
    var h = size === "og" ? 630 : 1350;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    var tier = data.rarity_tier || data.tier || "comune";
    var color = TIER_COLORS[tier] || "#e8c872";
    var label = data.rarity_label || TIER_LABELS[tier] || "Copia digitale";
    var name = data.name || data.card_name || "Carta";
    var serial = serialLabel(data);
    var url = (data.share_url || (location.origin + "/c/" + (data.id || ""))).replace(/^https?:\/\//, "");

    var grd = g.createLinearGradient(0, 0, 0, h);
    if (tier === "mitica") { grd.addColorStop(0, "#0a0610"); grd.addColorStop(1, "#140810"); }
    else if (tier === "leggendaria") { grd.addColorStop(0, "#1a1408"); grd.addColorStop(1, "#0c0a06"); }
    else { grd.addColorStop(0, "#141210"); grd.addColorStop(1, "#0a0908"); }
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.globalAlpha = 0.2;
    g.beginPath();
    g.arc(w / 2, size === "og" ? 280 : 520, size === "og" ? 260 : 380, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    var artSrc = data.art_url || data.photoUrl || data.img || "";
    var logoSrc = "/img/dreamint-logo-full-dark.webp?v=20261110e";
    var art = null;
    var logo = null;
    try { art = await loadImage(artSrc); } catch (e) { art = null; }
    try { logo = await loadImage(logoSrc); } catch (e2) { logo = null; }

    if (size === "og") {
      paintLogo(g, logo, 200, 36, 220);
      paintCard(g, art, 80, 120, 280, 392, color, (tier === "mitica" || tier === "leggendaria") ? 10 : 6);
      g.fillStyle = color;
      g.font = "650 42px Fraunces, Georgia, serif";
      g.textAlign = "left";
      g.fillText(label.toUpperCase(), 420, 220);
      g.fillStyle = "#f8e7b4";
      g.font = "600 36px Fraunces, Georgia, serif";
      wrapText(g, name, 420, 280, 720, 42);
      g.font = "600 24px JetBrains Mono, ui-monospace, monospace";
      if (serial) g.fillText(serial, 420, 400);
      var grade = [data.grader, data.grade].filter(Boolean).join(" ");
      if (grade) g.fillText(grade, 420, 440);
      g.font = "600 20px Inter Tight, sans-serif";
      g.fillText(url, 420, 560);
    } else {
      paintLogo(g, logo, w / 2, 48, 280);
      var cw = 560, ch = 784, cx = (w - cw) / 2, cy = 160;
      paintCard(g, art, cx, cy, cw, ch, color, (tier === "mitica" || tier === "leggendaria") ? 12 : 6);
      g.textAlign = "center";
      g.fillStyle = color;
      g.font = "650 64px Fraunces, Georgia, serif";
      g.fillText(label.toUpperCase(), w / 2, 1020);
      g.fillStyle = "#f8e7b4";
      g.font = "600 30px Fraunces, Georgia, serif";
      g.fillText(name, w / 2, 1078);
      g.font = "600 26px JetBrains Mono, ui-monospace, monospace";
      if (serial) g.fillText(serial, w / 2, 1124);
      g.font = "600 22px Inter Tight, sans-serif";
      g.fillText(url, w / 2, 1240);
    }
    return c;
  }

  function wrapText(g, text, x, y, max, lh) {
    var words = String(text || "").split(" ");
    var line = "";
    var yy = y;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (g.measureText(test).width > max && line) {
        g.fillText(line, x, yy);
        line = words[i];
        yy += lh;
      } else line = test;
    }
    if (line) g.fillText(line, x, yy);
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  async function canvasToFile(canvas, filename) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        if (!blob) return resolve(null);
        resolve(new File([blob], filename, { type: "image/png" }));
      }, "image/png");
    });
  }

  async function shareCopy(data) {
    var story = await renderSocialCanvas(data, "story");
    var og = await renderSocialCanvas(data, "og");
    var tier = data.rarity_tier || data.tier || "copia";
    var storyFile = await canvasToFile(story, "dreamint-" + tier + "-1080x1350.png");
    var ogFile = await canvasToFile(og, "dreamint-" + tier + "-1200x630.png");
    var text = (data.name || "Carta") + " è " + (data.rarity_label || TIER_LABELS[tier] || "") +
      " su DreaMint" + (data.serial_label || serialLabel(data) ? " · " + (data.serial_label || serialLabel(data)) : "") +
      ". " + (data.share_url || "");
    if (storyFile && navigator.canShare && navigator.canShare({ files: [storyFile] })) {
      try {
        await navigator.share({ files: [storyFile], title: "DreaMint", text: text, url: data.share_url });
        return { shared: true, story: story, og: og };
      } catch (e) {
        if (e && e.name === "AbortError") return { aborted: true, story: story, og: og };
      }
    }
    if (storyFile) downloadBlob(storyFile, storyFile.name);
    if (ogFile) downloadBlob(ogFile, ogFile.name);
    return { downloaded: true, story: story, og: og, files: { story: storyFile, og: ogFile } };
  }


  // ---- Listing / card social image (graded + ungraded) -------------------
  // data: { name, meta, badge, price, url, art, tier, tierLabel, ungraded, serial }
  var MINT = "#02AC79";
  async function renderListingCanvas(data, size) {
    var story = size === "story";
    var w = 1080, h = story ? 1920 : 1350;
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var tier = data.ungraded ? "" : (data.tier || "");
    var color = tier ? (TIER_COLORS[tier] || MINT) : MINT;
    var bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0B1C26"); bg.addColorStop(1, "#05101A");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    var glow = g.createRadialGradient(w / 2, story ? 760 : 560, 40, w / 2, story ? 760 : 560, 560);
    glow.addColorStop(0, hexA(color, 0.32)); glow.addColorStop(1, hexA(color, 0));
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    var art = null, logo = null;
    try { art = await loadImage(data.art); } catch (e) { art = null; }
    try { logo = await loadImage("/img/dreamint-logo-full-dark.webp?v=20261110d"); } catch (e2) { logo = null; }
    var top = story ? 120 : 56;
    paintLogo(g, logo, w / 2, top, 300);
    var cw = story ? 700 : 520, chh = Math.round(cw * 1.4), cx = (w - cw) / 2, cy = top + (story ? 170 : 110);
    g.save(); g.shadowColor = hexA(color, 0.55); g.shadowBlur = 60;
    g.fillStyle = "#0B1C26"; g.beginPath(); drawRounded(g, cx, cy, cw, chh, 16); g.fill(); g.restore();
    paintCard(g, art, cx, cy, cw, chh, color, tier === "mitica" || tier === "leggendaria" ? 12 : 8);
    if (data.refLabel) {
      g.font = "600 24px 'Inter Tight', Inter, sans-serif";
      var rw = g.measureText(data.refLabel).width + 32;
      g.fillStyle = "rgba(7,19,28,.85)"; g.beginPath(); drawRounded(g, cx + 16, cy + chh - 56, rw, 40, 20); g.fill();
      g.fillStyle = "#F4EFE4"; g.textAlign = "left"; g.fillText(data.refLabel, cx + 32, cy + chh - 28); g.textAlign = "center";
    }
    var y = cy + chh + (story ? 96 : 70);
    g.textAlign = "center";
    if (data.badge) {
      g.font = "700 30px 'JetBrains Mono', ui-monospace, monospace";
      var bw = g.measureText(data.badge).width + 48;
      g.fillStyle = hexA(color, 0.18); g.strokeStyle = color; g.lineWidth = 3;
      g.beginPath(); drawRounded(g, (w - bw) / 2, y - 40, bw, 56, 28); g.fill(); g.stroke();
      g.fillStyle = "#F4EFE4"; g.fillText(data.badge, w / 2, y - 2);
      y += 72;
    }
    g.fillStyle = "#F4EFE4";
    g.font = "600 54px Fraunces, Georgia, serif";
    y = wrapCenter(g, data.name || "Carta", w / 2, y, 940, 62, 2) + 8;
    if (data.meta) {
      g.fillStyle = "#9BB0B8"; g.font = "500 30px 'Inter Tight', Inter, sans-serif";
      y = wrapCenter(g, data.meta, w / 2, y + 40, 940, 38, 2);
    }
    if (data.price) {
      g.fillStyle = color === MINT ? "#8EFCE5" : color;
      g.font = "700 72px Fraunces, Georgia, serif";
      g.fillText(data.price, w / 2, y + (story ? 120 : 92));
    }
    var urlY = h - (story ? 110 : 56);
    if (data.watermark) {
      g.fillStyle = "rgba(244,239,228,.72)";
      g.font = "500 22px 'JetBrains Mono', ui-monospace, monospace";
      g.fillText(String(data.watermark), w / 2, urlY - 36);
    }
    g.fillStyle = "#F4EFE4"; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(String(data.url || "dreamint.it").replace(/^https?:\/\//, ""), w / 2, urlY);
    return c;
  }
  function hexA(hex, a) {
    var n = parseInt(String(hex).replace("#", ""), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function wrapCenter(g, text, x, y, max, lh, maxLines) {
    var words = String(text || "").split(/\s+/), line = "", lines = [];
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + " " + words[i] : words[i];
      if (g.measureText(t).width > max && line) { lines.push(line); line = words[i]; } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
    lines.forEach(function (l, k) { g.fillText(l, x, y + k * lh); });
    return y + (lines.length - 1) * lh;
  }
  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  async function shareListingImage(data, size) {
    var canvas = await renderListingCanvas(data, size);
    var name = "dreamint-" + String(data.slug || "carta").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() + (size === "story" ? "-1080x1920" : "-1080x1350") + ".png";
    var file = await canvasToFile(canvas, name);
    if (!file) throw new Error("canvas");
    var mobile = isIOS() || /Android/i.test(navigator.userAgent);
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "DreaMint", text: (data.name || "") + " · " + (data.url || "") });
        return { shared: true, canvas: canvas };
      } catch (e) {
        if (e && e.name === "AbortError") return { aborted: true, canvas: canvas };
      }
    }
    downloadBlob(file, name);
    return { downloaded: true, canvas: canvas, file: file };
  }

  function bindTilt(root) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (root || document).querySelectorAll("[data-tilt]").forEach(function (el) {
      if (el._shareTilt) return;
      el._shareTilt = true;
      el.addEventListener("pointermove", function (e) {
        if (reduce) return;
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / Math.max(1, r.width);
        var py = (e.clientY - r.top) / Math.max(1, r.height);
        el.style.setProperty("--ry", ((px - 0.5) * 22).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - py) * 16).toFixed(2) + "deg");
        el.style.setProperty("--hx", (px * 100).toFixed(1) + "%");
        el.style.setProperty("--hy", (py * 100).toFixed(1) + "%");
      });
      el.addEventListener("pointerleave", function () {
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--rx", "0deg");
      });
    });
  }

  function bindFlip(root) {
    var card = (root || document).querySelector("[data-hero-card]");
    if (!card || card._shareFlip) return;
    card._shareFlip = true;
    var spin = card.querySelector("[data-spin]");
    var dragging = false;
    var startX = 0;
    var angle = 0;
    function setAngle(a) {
      angle = a;
      if (spin) spin.style.transform = "rotateY(" + a + "deg)";
    }
    card.addEventListener("pointerdown", function (e) {
      dragging = true;
      startX = e.clientX;
      card.setPointerCapture(e.pointerId);
      card.classList.add("is-grabbing");
    });
    card.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      setAngle(angle + dx * 0.6);
      startX = e.clientX;
    });
    card.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("is-grabbing");
      var snapped = Math.round(angle / 180) * 180;
      setAngle(snapped);
    });
    card.addEventListener("click", function (e) {
      if (Math.abs(angle % 360) < 2 || Math.abs(angle % 360) > 358) {
        /* click-to-flip when almost flat */
      }
    });
  }

  function bootSharePage() {
    bindTilt(document);
    bindFlip(document);
    var btn = document.getElementById("share-copy-btn");
    var data = root.__DREAMINT_SHARE__;
    if (btn && data) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        shareCopy(data).catch(function () {}).then(function () { btn.disabled = false; });
      });
    }
  }

  root.DreaMintShare = {
    renderSocialCanvas: renderSocialCanvas,
    renderListingCanvas: renderListingCanvas,
    shareListingImage: shareListingImage,
    shareCopy: shareCopy,
    bindTilt: bindTilt,
    bindFlip: bindFlip,
    bootSharePage: bootSharePage
  };
})(window);
