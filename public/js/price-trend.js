(function (root) {
  "use strict";

  function tr(key, fallback, vars) {
    var i18n = root.DreamintI18n;
    if (i18n && i18n.t) {
      var v = i18n.t(key, vars);
      if (v && v !== key) return v;
    }
    if (!vars) return fallback || key;
    return String(fallback || key).replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] == null ? "" : String(vars[k]);
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function langIsEn() {
    return root.DreamintI18n && root.DreamintI18n.getLang && root.DreamintI18n.getLang() === "en";
  }
  function formatMoney(cents, currency) {
    var n = Number(cents) / 100;
    if (!Number.isFinite(n)) return "";
    if (String(currency).toUpperCase() === "USD") return "$" + n.toFixed(2);
    var core = langIsEn() ? n.toFixed(2) : n.toFixed(2).replace(".", ",");
    return core + " €";
  }
  function formatPct(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return "";
    var n = Number(pct);
    var abs = Math.abs(n).toFixed(1);
    if (!langIsEn()) abs = abs.replace(".", ",");
    return (n > 0 ? "+" : n < 0 ? "−" : "") + abs + "%";
  }
  function dirClass(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return "is-flat";
    if (Number(pct) > 0) return "is-up";
    if (Number(pct) < 0) return "is-down";
    return "is-flat";
  }

  function chartPoints(trend, period) {
    var daily = (trend && trend.points) || [];
    if (period === "7" || period === "30") {
      var days = period === "7" ? 7 : 30;
      var cutoff = new Date();
      cutoff.setTime(cutoff.getTime() - (days - 1) * 86400 * 1000);
      var min = cutoff.toISOString().slice(0, 10);
      var filtered = daily.filter(function (p) { return p.day && p.day >= min; });
      if (filtered.length >= 3) return filtered;
    }
    if (period === "all" && daily.length >= 3) return daily;
    if (daily.length >= 3 && period !== "7" && period !== "30") return daily;
    var official = (trend && trend.official_points) || [];
    if (official.length >= 3) return official;
    return daily.length ? daily : official;
  }

  function sparkSvg(points, opts) {
    opts = opts || {};
    var w = opts.width || (opts.compact ? 140 : 280);
    var h = opts.height || (opts.compact ? 36 : 88);
    var padX = opts.compact ? 2 : 6;
    var padY = opts.compact ? 3 : 8;
    var vals = points.map(function (p) { return Number(p.price_cents); }).filter(function (n) { return n > 0; });
    if (vals.length < 3) return "";
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var coords = vals.map(function (v, i) {
      var x = padX + (vals.length === 1 ? (w - padX * 2) / 2 : i * (w - padX * 2) / (vals.length - 1));
      var y = padY + (1 - (v - min) / span) * (h - padY * 2);
      return [x, y];
    });
    var d = coords.map(function (c, i) { return (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1); }).join(" ");
    var area = d + " L" + coords[coords.length - 1][0].toFixed(1) + " " + (h - 1) +
      " L" + coords[0][0].toFixed(1) + " " + (h - 1) + " Z";
    var last = vals[vals.length - 1];
    var first = vals[0];
    var cls = last > first ? "is-up" : last < first ? "is-down" : "is-flat";
    var lastPt = coords[coords.length - 1];
    return '<svg class="pt-spark ' + cls + '" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" role="img" aria-hidden="true">' +
      '<path class="pt-area" d="' + area + '"></path>' +
      '<path class="pt-line" d="' + d + '" fill="none"></path>' +
      '<circle class="pt-dot" cx="' + lastPt[0].toFixed(1) + '" cy="' + lastPt[1].toFixed(1) + '" r="' + (opts.compact ? 2.2 : 3) + '"></circle>' +
      "</svg>";
  }

  function figureLabel(fig) {
    if (fig === "trend") return tr("price.trend.fig.trend", "Trend Cardmarket");
    if (fig === "avg1") return tr("price.trend.fig.avg1", "Media 1g Cardmarket");
    if (fig === "avg") return tr("price.trend.fig.avg", "Media Cardmarket");
    if (fig === "history") return tr("price.trend.fig.hist", "Ultimo rilevamento");
    return "";
  }

  function sourceText(trend) {
    if (!trend) return "";
    if (trend.currency === "USD") {
      if (trend.source_label) return tr("price.trend.sourceUsdNamed", "Indicativo, {source} (USD)", { source: trend.source_label });
      return tr("price.trend.sourceUsd", "Prezzo indicativo (USD)");
    }
    if (trend.official_points && trend.official_points.length && trend.source_label === "Cardmarket") {
      return tr("price.trend.sourceCardmarket", "Cardmarket (indicativo)");
    }
    return trend.source_label || "";
  }

  function render(el, trend, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    if (!compact) { renderChart(el, trend, opts); return; }
    var period = el.getAttribute("data-period") || opts.period || (trend && trend.windows ? "30" : "all");
    var pts = chartPoints(trend, period);
    var hasLine = pts.length >= 3;
    var change = period === "7" ? (trend && trend.change_7d) : (period === "30" ? (trend && trend.change_30d) : null);
    if (change == null && pts.length >= 2) {
      var a = pts[0].price_cents;
      var b = pts[pts.length - 1].price_cents;
      if (a > 0) change = Math.round(((b - a) / a) * 1000) / 10;
    }
    var last = trend && trend.last_cents;
    var cls = dirClass(change);
    var html = '<div class="pt-widget ' + (compact ? "is-compact " : "") + cls + '">';
    if (!compact) {
      html += '<div class="pt-head"><div class="pt-last">' +
        (last ? '<strong>' + esc(formatMoney(last, trend.currency)) + "</strong>" : "") +
        (change != null ? '<span class="pt-chg">' + esc(formatPct(change)) + "</span>" : "") +
        "</div>";
      var fig = figureLabel(trend && trend.last_figure);
      var src = sourceText(trend);
      if (fig || src) html += '<p class="pt-src">' + esc([fig, src].filter(Boolean).join(" · ")) + "</p>";
      html += "</div>";
      if (trend && (trend.windows || (trend.points && trend.points.length >= 3) || (trend.official_points && trend.official_points.length >= 3))) {
        html += '<div class="pt-tabs" role="tablist">' +
          tabBtn("7", period, tr("price.trend.7d", "7g")) +
          tabBtn("30", period, tr("price.trend.30d", "30g")) +
          tabBtn("all", period, tr("price.trend.all", "Tutto")) +
          "</div>";
      }
    } else {
      html += '<div class="pt-compact-row">';
      if (last) html += '<span class="pt-last-sm">' + esc(formatMoney(last, trend.currency)) + "</span>";
      if (change != null) html += '<span class="pt-chg">' + esc(formatPct(change)) + "</span>";
      html += "</div>";
    }
    if (hasLine) html += sparkSvg(pts, { compact: compact });
    else {
      html += '<p class="pt-collecting">' + tr("price.trend.collecting", "Storico in raccolta") + "</p>";
    }
    html += "</div>";
    el.innerHTML = html;
    el._trend = trend;
    if (!compact) {
      el.querySelectorAll("[data-pt-period]").forEach(function (btn) {
        btn.onclick = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          el.setAttribute("data-period", btn.getAttribute("data-pt-period"));
          render(el, trend, opts);
        };
      });
    }
  }


  /* ---------- Full "Andamento prezzi" chart (v2) ---------- */
  var PERIODS = [
    { id: "1", key: "ch.24h", fb: "24H", days: 2, min: 2 },
    { id: "7", key: "ch.7d", fb: "7G", days: 7, min: 3 },
    { id: "30", key: "ch.30d", fb: "30G", days: 30, min: 3 },
    { id: "365", key: "ch.1y", fb: "1A", days: 365, min: 3 }
  ];
  var uid = 0;
  function isoDaysAgo(days) {
    var d = new Date(Date.now() - (days - 1) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function windowPoints(trend, period) {
    // Real Cardmarket averages delivered by the catalog (never invented). Only meaningful for 7G / 30G.
    var w = trend && trend.windows;
    if (!w || trend.currency !== "EUR") return [];
    var cur = w.trend != null ? ["trend", w.trend] : (w.avg1 != null ? ["avg1", w.avg1] : (w.avg != null ? ["avg", w.avg] : null));
    var pts = [];
    if (period === "30" && w.avg30 != null) pts.push({ label: tr("ch.pt.avg30", "Media 30 giorni"), price_cents: Math.round(w.avg30 * 100) });
    if ((period === "30" || period === "7") && w.avg7 != null) pts.push({ label: tr("ch.pt.avg7", "Media 7 giorni"), price_cents: Math.round(w.avg7 * 100) });
    if (w.avg1 != null && cur && cur[0] !== "avg1") pts.push({ label: tr("ch.pt.avg1", "Media 1 giorno"), price_cents: Math.round(w.avg1 * 100) });
    if (cur) pts.push({ label: tr("ch.pt." + cur[0], cur[0]), price_cents: Math.round(cur[1] * 100) });
    return pts.filter(function (p) { return p.price_cents > 0; });
  }
  function seriesFor(trend, periodId) {
    var per = PERIODS.filter(function (p) { return p.id === periodId; })[0] || PERIODS[2];
    var daily = ((trend && trend.points) || []).filter(function (p) { return p.day && /^\d{4}-/.test(p.day) && p.price_cents > 0; });
    var min = isoDaysAgo(per.days);
    var inWin = daily.filter(function (p) { return p.day >= min; });
    if (inWin.length >= per.min) {
      return { kind: "daily", pts: inWin.map(function (p) { return { label: fmtDay(p.day), price_cents: p.price_cents }; }) };
    }
    if (per.id === "7" || per.id === "30") {
      var wp = windowPoints(trend, per.id);
      if (wp.length >= 3) return { kind: "windows", pts: wp };
    }
    return { kind: "none", pts: [] };
  }
  function fmtDay(day) {
    var parts = String(day).split("-");
    if (parts.length !== 3) return day;
    return langIsEn() ? (parts[1] + "/" + parts[2]) : (parts[2] + "/" + parts[1]);
  }
  function chartSvg(pts, id) {
    var W = 640, H = 220, L = 8, R = 8, T = 18, B = 26;
    var vals = pts.map(function (p) { return p.price_cents; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var pad = (max - min) * 0.18 || max * 0.05 || 1;
    var lo = min - pad, hi = max + pad, span = hi - lo;
    var coords = vals.map(function (v, i) {
      return [L + (vals.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (vals.length - 1)), T + (1 - (v - lo) / span) * (H - T - B)];
    });
    var d = "";
    coords.forEach(function (c, i) {
      if (!i) { d += "M" + c[0].toFixed(1) + " " + c[1].toFixed(1); return; }
      var p = coords[i - 1], mx = (p[0] + c[0]) / 2;
      d += " C" + mx.toFixed(1) + " " + p[1].toFixed(1) + " " + mx.toFixed(1) + " " + c[1].toFixed(1) + " " + c[0].toFixed(1) + " " + c[1].toFixed(1);
    });
    var area = d + " L" + coords[coords.length - 1][0].toFixed(1) + " " + (H - B) + " L" + coords[0][0].toFixed(1) + " " + (H - B) + " Z";
    var grid = "";
    for (var g = 0; g < 4; g++) {
      var gy = T + g * (H - T - B) / 3;
      grid += '<line class="pc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '"></line>';
    }
    var dots = coords.map(function (c, i) {
      return '<circle class="pc-dot" data-i="' + i + '" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="4"></circle>';
    }).join("");
    return {
      coords: coords, W: W, H: H,
      svg: '<svg class="pc-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<defs><linearGradient id="pcg' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="pc-stop-a"></stop><stop offset="1" class="pc-stop-b"></stop></linearGradient>' +
        '<filter id="pcf' + id + '" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="4" result="b"></feGaussianBlur><feMerge><feMergeNode in="b"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs>' +
        grid +
        '<path class="pc-area" d="' + area + '" fill="url(#pcg' + id + ')"></path>' +
        '<path class="pc-line" d="' + d + '" pathLength="1" filter="url(#pcf' + id + ')"></path>' +
        '<line class="pc-cursor" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '"></line>' +
        dots + "</svg>"
    };
  }
  function renderChart(el, trend, opts) {
    opts = opts || {};
    var id = ++uid;
    var period = el.getAttribute("data-period") || opts.period || "30";
    var series = seriesFor(trend, period);
    var pts = series.pts;
    var currency = (trend && trend.currency) || "EUR";
    var change = null;
    if (pts.length >= 2 && pts[0].price_cents > 0) change = Math.round(((pts[pts.length - 1].price_cents - pts[0].price_cents) / pts[0].price_cents) * 1000) / 10;
    var last = pts.length ? pts[pts.length - 1].price_cents : (trend && trend.last_cents);
    var html = '<div class="pc ' + dirClass(change) + '">' +
      '<div class="pc-head"><div class="pc-now">' +
      (opts.title ? '<span class="pc-name">' + esc(opts.title) + "</span>" : "") +
      (last ? '<strong class="pc-price">' + esc(formatMoney(last, currency)) + "</strong>" : "") +
      (change != null ? '<span class="pc-chg">' + esc(formatPct(change)) + "</span>" : "") +
      "</div>" +
      '<div class="pc-tabs" role="group" aria-label="' + esc(tr("ch.kicker", "Andamento prezzi")) + '">' +
      PERIODS.map(function (p) {
        return '<button type="button" class="pc-tab' + (p.id === period ? " on" : "") + '" aria-pressed="' + (p.id === period) + '" data-pt-period="' + p.id + '">' + esc(tr(p.key, p.fb)) + "</button>";
      }).join("") + "</div></div>";
    if (pts.length >= 2) {
      var c = chartSvg(pts, id);
      html += '<div class="pc-plot" tabindex="0" role="img" aria-label="' + esc(tr("ch.aria", "Grafico") + ": " + pts.map(function (p) { return p.label + " " + formatMoney(p.price_cents, currency); }).join(", ")) + '">' +
        c.svg + '<div class="pc-tip" hidden><span class="pc-tip-l"></span><strong class="pc-tip-v"></strong></div></div>' +
        '<div class="pc-axis"><span>' + esc(pts[0].label) + "</span><span>" + esc(pts[pts.length - 1].label) + "</span></div>";
    } else {
      html += '<div class="pc-empty"><strong>' + esc(tr("ch.collecting", "Storico in raccolta")) + "</strong><p>" + esc(tr("ch.collectingP", "")) + "</p></div>";
    }
    var src = series.kind === "daily" ? tr("ch.src.daily", "Storico DreaMint") : (series.kind === "windows" ? tr("ch.src.windows", "Medie Cardmarket") : "");
    if (currency === "USD") src = [src, trend && trend.source_label ? tr("price.trend.sourceUsdNamed", "Indicativo, {source} (USD)", { source: trend.source_label }) : tr("ch.src.usd", "USD")].filter(Boolean).join(" · ");
    if (src) html += '<p class="pc-src">' + esc(src) + "</p>";
    html += "</div>";
    el.innerHTML = html;
    el._trend = trend;
    el.querySelectorAll("[data-pt-period]").forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        el.setAttribute("data-period", btn.getAttribute("data-pt-period"));
        renderChart(el, trend, opts);
      };
    });
    bindTip(el, pts, currency);
  }
  function bindTip(el, pts, currency) {
    var plot = el.querySelector(".pc-plot");
    if (!plot) return;
    var svg = plot.querySelector("svg"), tip = plot.querySelector(".pc-tip"), cursor = plot.querySelector(".pc-cursor");
    var dots = plot.querySelectorAll(".pc-dot");
    var active = -1;
    function show(i) {
      if (i < 0 || i >= pts.length) return;
      active = i;
      var dot = dots[i];
      var cx = Number(dot.getAttribute("cx")), cy = Number(dot.getAttribute("cy"));
      var vb = svg.viewBox.baseVal, r = plot.getBoundingClientRect();
      var x = cx / vb.width * r.width, y = cy / vb.height * r.height;
      cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx);
      plot.classList.add("is-hover");
      dots.forEach(function (d, k) { d.classList.toggle("on", k === i); });
      tip.hidden = false;
      tip.querySelector(".pc-tip-l").textContent = pts[i].label;
      tip.querySelector(".pc-tip-v").textContent = formatMoney(pts[i].price_cents, currency);
      var tw = tip.offsetWidth || 110;
      tip.style.left = Math.max(0, Math.min(r.width - tw, x - tw / 2)) + "px";
      tip.style.top = Math.max(0, y - 58) + "px";
    }
    function hide() { plot.classList.remove("is-hover"); tip.hidden = true; active = -1; dots.forEach(function (d) { d.classList.remove("on"); }); }
    plot.addEventListener("pointermove", function (e) {
      var r = plot.getBoundingClientRect();
      var px = (e.clientX - r.left) / Math.max(1, r.width);
      show(Math.round(px * (pts.length - 1)));
    });
    plot.addEventListener("pointerleave", hide);
    plot.addEventListener("blur", hide);
    plot.addEventListener("focus", function () { show(pts.length - 1); });
    plot.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(Math.max(0, (active < 0 ? pts.length : active) - 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); show(Math.min(pts.length - 1, active + 1)); }
      if (e.key === "Escape") hide();
    });
  }

  function tabBtn(id, current, label) {
    return '<button type="button" class="pt-tab' + (current === id ? " on" : "") + '" data-pt-period="' + id + '">' + esc(label) + "</button>";
  }

  function queryFromSpec(spec) {
    if (!spec) return "";
    if (spec.slab_id) return "slab_id=" + encodeURIComponent(spec.slab_id);
    if (spec.card_ref) {
      var q = "card_ref=" + encodeURIComponent(spec.card_ref);
      if (spec.game) q += "&game=" + encodeURIComponent(spec.game);
      return q;
    }
    var parts = [];
    ["game", "set_name", "set_code", "code", "code_printed", "code_normalized", "language", "lang", "variant", "name", "catalog_image"].forEach(function (k) {
      if (spec[k]) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(spec[k]));
    });
    return parts.join("&");
  }

  function fetchTrend(spec) {
    var q = queryFromSpec(spec);
    return fetch("/api/prices/trend?" + q, { credentials: "include" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { return d.trend || null; });
  }

  function mount(el, spec, opts) {
    if (!el) return;
    opts = opts || {};
    if (spec && spec.trend) {
      render(el, spec.trend, opts);
      return;
    }
    el.innerHTML = '<div class="pt-widget' + (opts.compact ? " is-compact" : " pc-loading") + '"><p class="pt-collecting">' + tr("ch.loading", "Carico i prezzi…") + "</p></div>";
    fetchTrend(spec || specFromEl(el)).then(function (trend) {
      if (!trend) {
        if (opts.compact) el.innerHTML = "";
        else renderChart(el, { points: [] }, opts);
        return;
      }
      render(el, trend, opts);
    }).catch(function () {
      if (opts.compact) el.innerHTML = "";
      else renderChart(el, { points: [] }, opts);
    });
  }

  function specFromEl(el) {
    if (el.dataset.slabId) return { slab_id: el.dataset.slabId };
    if (el.dataset.priceQuery) {
      var out = {};
      el.dataset.priceQuery.split("&").forEach(function (part) {
        var kv = part.split("=");
        if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
      return out;
    }
    if (el.dataset.cardRef) return { card_ref: el.dataset.cardRef, game: el.dataset.game };
    return {};
  }

  function placeholder(spec, extraClass, compact) {
    var attrs = ' class="price-trend' + (extraClass ? " " + extraClass : "") + '"';
    if (compact) attrs += ' data-compact="1"';
    if (spec && spec.trend) {
      attrs += ' data-trend="' + esc(JSON.stringify(spec.trend)) + '"';
    }
    if (spec && spec.slab_id) attrs += ' data-slab-id="' + esc(spec.slab_id) + '"';
    else if (spec && spec.card_ref) attrs += ' data-card-ref="' + esc(spec.card_ref) + '"' + (spec.game ? ' data-game="' + esc(spec.game) + '"' : "");
    else if (spec && !spec.trend) attrs += ' data-price-query="' + esc(queryFromSpec(spec)) + '"';
    return "<div" + attrs + "></div>";
  }

  function enhance(root) {
    var scope = root || document;
    scope.querySelectorAll(".price-trend").forEach(function (el) {
      if (el._ptBound) return;
      el._ptBound = true;
      var compact = el.getAttribute("data-compact") === "1" || el.classList.contains("is-compact");
      var title = el.getAttribute("data-title") || "";
      var payload = el.getAttribute("data-trend");
      if (payload) {
        try {
          render(el, JSON.parse(payload), { compact: compact, title: title });
          return;
        } catch (e) { /* fetch instead */ }
      }
      if (el.dataset.hasPayload && el._trend) {
        render(el, el._trend, { compact: compact });
        return;
      }
      mount(el, specFromEl(el), { compact: compact, title: title });
      // stop link navigation when toggling tabs
      el.addEventListener("click", function (ev) {
        if (ev.target && ev.target.closest("[data-pt-period]")) ev.preventDefault();
      });
    });
  }

  function bindPayload(el, trend, compact) {
    if (!el || !trend) return;
    el._ptBound = true;
    render(el, trend, { compact: compact });
  }

  root.DreaMintPrices = {
    mount: mount,
    enhance: enhance,
    placeholder: placeholder,
    bindPayload: bindPayload,
    render: render,
    renderChart: renderChart,
    fetchTrend: fetchTrend,
    formatMoney: formatMoney,
    formatPct: formatPct
  };
})(window);
