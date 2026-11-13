/* DreaMint trade v9 — two graded markets, cert search, buyer-seller chat,
 * anti-screenshot (holo + Verificata + social-stamp watermark).
 * Talks to Dev's v17/v18 APIs (no local mocks).
 */
(function (root) {
  "use strict";

  var cfg = (root.GEMINT_CONFIG) || {};
  var userRef = null;
  var verifyTimer = null;

  function setCfg(c) { cfg = c || cfg || {}; }
  function setUser(u) { userRef = u || null; }
  function tr(key, vars) {
    return (root.DreamintI18n && root.DreamintI18n.t) ? root.DreamintI18n.t(key, vars) : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function v9On() {
    return !(cfg && cfg.markets_v9 === false);
  }

  function parseQuery(s) {
    var out = {};
    String(s || "").replace(/^\?/, "").split("&").forEach(function (p) {
      if (!p) return;
      var kv = p.split("=");
      var k = decodeURIComponent((kv[0] || "").replace(/\+/g, " "));
      var v = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      if (k) out[k] = v;
    });
    return out;
  }
  function hashQuery() {
    var h = location.hash || "";
    var i = h.indexOf("?");
    var fromHash = i >= 0 ? parseQuery(h.slice(i + 1)) : {};
    var fromSearch = parseQuery(location.search || "");
    delete fromSearch.shot;
    return Object.assign({}, fromSearch, fromHash);
  }
  function pathOnly(hash) {
    var h = hash || location.hash || "";
    var q = h.indexOf("?");
    return q < 0 ? h : h.slice(0, q);
  }
  function normKind(k) {
    if (k === "full_set" || k === "fullset") return "fullset";
    if (k === "digital" || k === "physical" || k === "ungraded") return k;
    return "";
  }
  function offerHref(base, kind) {
    var path = pathOnly(base || "#/gradate");
    var k = normKind(kind);
    return k ? path + "?offerta=" + encodeURIComponent(k) : path;
  }
  function activeOffer() {
    return normKind(hashQuery().offerta || "");
  }

  function marketOf(c) { return (c && c.market) || null; }
  function isFullSet(c) {
    if (!c || c.is_ungraded) return false;
    var m = marketOf(c);
    if (m && m.full_set) return true;
    if (c.full_set === "yes") return true;
    if (c.full_set === "transferring" || c.status === "in_transit") return false;
    if (c.physical_owner_id && c.digital_owner_id && c.physical_owner_id === c.digital_owner_id) return true;
    return false;
  }
  function isSplitOwners(c) {
    if (!c || c.is_ungraded) return false;
    var m = marketOf(c);
    if (m && m.digital_owned_by_other) return true;
    if (c.digital_owned_by_other) return true;
    if (isFullSet(c)) return false;
    if (c.full_set === "no") return true;
    if (c.physical_owner_id && c.digital_owner_id && c.physical_owner_id !== c.digital_owner_id) return true;
    return false;
  }
  function offerKind(item) {
    if (!item) return "";
    var k = normKind(item.kind || item.offer || item.listing_kind || "");
    if (k) return k;
    if (item.is_ungraded) return "ungraded";
    if (isFullSet(item)) return "fullset";
    return k;
  }

  function offerFilterRow(active) {
    if (!v9On()) return "";
    var kinds = [
      ["", "offer.filterAll"],
      ["fullset", "offer.fullSet"],
      ["digital", "offer.digital"],
      ["physical", "offer.physical"]
    ];
    var base = pathOnly(location.hash || "#/gradate") || "#/gradate";
    if (base.indexOf("#/gradate") !== 0) base = "#/gradate";
    return '<div class="chip-row dm-offer-filters" role="navigation" aria-label="' + esc(tr("offer.filter")) + '">' +
      kinds.map(function (k) {
        return '<a class="chip' + (active === k[0] ? " on" : "") + '" href="' + esc(offerHref(base, k[0])) + '" data-link>' +
          esc(tr(k[1])) + "</a>";
      }).join("") + "</div>";
  }

  function offerBadgeHtml(item, card) {
    if (!v9On()) return "";
    var k = offerKind(item || card);
    var split = isSplitOwners(card || item) || !!(item && item.digital_owned_by_other);
    if (k === "physical" || (split && k !== "digital" && k !== "fullset")) {
      return '<span class="pill pill-physical">' + esc(tr("offer.physical")) + "</span>";
    }
    if (k === "digital") {
      return '<span class="pill pill-digital">' + esc(tr("offer.digital")) + "</span>";
    }
    if (k === "fullset" || isFullSet(card || item)) {
      return '<span class="pill pill-leggendaria pill-fullset">' + esc(tr("pill.fullSet")) + "</span>";
    }
    return "";
  }

  function physicalSplitNoteHtml(item, card) {
    if (!v9On()) return "";
    var k = offerKind(item || card);
    var split = isSplitOwners(card || item) || !!(item && item.digital_owned_by_other);
    if (k === "physical" || (split && k !== "digital" && k !== "fullset")) {
      return '<p class="dm-physical-note">' + esc(tr("offer.physicalNote")) + "</p>";
    }
    return "";
  }

  function dealNoticeHtml() {
    if (!v9On()) return "";
    return '<p class="notice dm-deal-notice" role="note">' + esc(tr("chat.notice")) + "</p>";
  }

  function contactSellerHtml(listing) {
    if (!v9On() || !listing || !listing.id) return "";
    var me = userRef;
    if (me && (me.id === listing.seller_id || (listing.mine))) return "";
    return '<p class="row-actions dm-contact-row">' +
      '<a class="btn primary" href="#/chat/new?listing=' + encodeURIComponent(listing.id) +
      (listing.slab_id ? "&amp;slab=" + encodeURIComponent(listing.slab_id) : "") +
      '" data-link data-contact-seller="' + esc(listing.id) + '">' + esc(tr("chat.contact")) + "</a></p>";
  }

  function ownershipPillsHtml(c) {
    if (!v9On() || !c || c.is_ungraded) return "";
    if (c.full_set === "transferring" || c.status === "in_transit") {
      return '<span class="pill pill-fullset-transfer">' + esc(tr("pill.fullSetTransfer")) + "</span>";
    }
    if (isFullSet(c)) {
      return '<span class="pill pill-leggendaria pill-fullset">' + esc(tr("pill.fullSet")) + "</span>";
    }
    if (isSplitOwners(c)) {
      return '<span class="pill pill-physical">' + esc(tr("offer.physicalOwned")) + "</span>";
    }
    return "";
  }

  function eurosInput(cents) {
    if (!cents) return "";
    return (Number(cents) / 100).toFixed(2);
  }

  function listFormHtml(c) {
    if (!v9On() || !c || c.is_ungraded) return null;
    var m = marketOf(c);
    if (!m) return null;
    if (!(m.can_set_fullset || m.can_set_digital || m.can_set_physical)) return null;
    var html = '<form id="list-form" class="dm-v9-list-form" data-v9="1" style="margin-top:16px">';
    if (m.can_set_fullset || m.can_set_digital) {
      html += '<p class="muted">' + esc(tr("list.twoPriceHint")) + "</p>";
    }
    if (m.can_set_fullset) {
      html += '<label class="field">' + esc(tr("offer.fullSet")) +
        '<input name="price_fullset" type="number" min="0.01" step="0.01" inputmode="decimal" value="' +
        esc(eurosInput(m.price_fullset_cents)) + '"></label>';
    }
    if (m.can_set_digital) {
      html += '<label class="field">' + esc(tr("offer.digital")) +
        '<input name="price_digital" type="number" min="0.01" step="0.01" inputmode="decimal" value="' +
        esc(eurosInput(m.price_digital_cents)) + '"></label>';
    }
    if (m.can_set_physical) {
      html += physicalSplitNoteHtml({ kind: "physical", digital_owned_by_other: true }, c);
      html += '<label class="field">' + esc(tr("offer.physical")) +
        '<input name="price_physical" type="number" min="0.01" step="0.01" inputmode="decimal" value="' +
        esc(eurosInput(m.price_physical_cents)) + '"></label>';
    }
    if (m.can_set_fullset && m.can_set_digital) {
      html += '<p class="dim">' + esc(tr("list.atLeastOne")) + "</p>";
    }
    var feesLink = '<a href="#/commissioni" data-link>' + esc(tr("sell.feesLink")) + "</a>";
    html += '<p class="dim fees-hint">' + tr("sell.feesHint").replace("{link}", feesLink) + "</p>";
    html += '<p class="error" id="list-err" hidden></p>';
    html += '<button class="btn primary" type="submit">' + esc(tr("card.publish")) + "</button></form>";
    return html;
  }

  function isDigitalListing(listing) {
    return !!(listing && offerKind(listing) === "digital");
  }

  function euros(cents) {
    var n = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
    } catch (e) {
      return "€ " + n.toFixed(2);
    }
  }

  function v9api(path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    return fetch("/api/" + path, {
      credentials: "include",
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error(d.error || d.message || tr("error.generic", { status: r.status }));
          err.status = r.status;
          err.code = d.code || "";
          err.body = d;
          var ra = r.headers.get("Retry-After");
          if (ra) err.retryAfter = parseInt(ra, 10) || ra;
          throw err;
        }
        return d;
      });
    });
  }

  function marketErrorMessage(err) {
    var code = err && err.code;
    var map = {
      not_found: "card.notFound",
      graded_only: "market.err.gradedOnly",
      not_available: "market.err.notAvailable",
      not_opened: "market.err.notOpened",
      price_invalid: "list.atLeastOne",
      nothing_to_update: "list.atLeastOne",
      paypal_required: "card.needPaypal",
      not_full_set: "market.err.notFullSet",
      not_digital_owner: "market.err.notDigital",
      not_physical_owner: "market.err.notPhysical",
      use_fullset: "market.err.useFullset",
      listing_reserved: "market.err.reserved"
    };
    if (code && map[code]) return tr(map[code]);
    return (err && err.message) || tr("error.generic", { status: (err && err.status) || "" });
  }

  function bindListForm(form, card, ctx) {
    if (!form || !card) return;
    var prev = marketOf(card) || {};
    form.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var body = {};
      var any = false;
      [["price_fullset", "price_fullset_euros", prev.price_fullset_cents],
       ["price_digital", "price_digital_euros", prev.price_digital_cents],
       ["price_physical", "price_physical_euros", prev.price_physical_cents]].forEach(function (row) {
        var inp = form.querySelector('input[name="' + row[0] + '"]');
        if (!inp) return;
        var raw = String(fd.get(row[0]) || "").replace(",", ".").trim();
        if (raw) { body[row[1]] = raw; any = true; }
        else if (row[2]) { body[row[1].replace("_euros", "_cents")] = null; any = true; }
      });
      var errEl = form.querySelector("#list-err");
      if (!any) {
        if (errEl) { errEl.hidden = false; errEl.textContent = tr("list.atLeastOne"); }
        else window.alert(tr("list.atLeastOne"));
        return;
      }
      var apiFn = (ctx && ctx.api) ? ctx.api : v9api;
      apiFn("cards/" + encodeURIComponent(card.id) + "/market", { method: "PATCH", body: body }).then(function () {
        if (ctx && ctx.go) ctx.go("#/carta/" + encodeURIComponent(card.id));
        else location.hash = "#/carta/" + encodeURIComponent(card.id);
      }).catch(function (err) {
        var msg = marketErrorMessage(err);
        if (err && err.code === "paypal_required" && !document.querySelector(".paypal-needed") && ctx && ctx.paypalNeededHtml) {
          form.insertAdjacentHTML("beforebegin", ctx.paypalNeededHtml());
        }
        if (errEl) { errEl.hidden = false; errEl.textContent = msg; }
        else window.alert(msg);
      });
    };
  }

  function filterByOffer(listings, kind) {
    var k = normKind(kind);
    if (!k) return listings || [];
    return (listings || []).filter(function (l) { return offerKind(l) === k; });
  }

  function serialFmt(n, total) {
    var left = "#" + String(n).padStart(4, "0");
    if (total == null || total === "") return left + " / ∞";
    var t = String(total);
    if (/^\d+$/.test(t)) t = t.padStart(4, "0");
    return left + " / " + t;
  }

  function ownerRefHtml(ref, headingKey) {
    if (!ref) return "";
    var label = ref.label || (ref.username ? "@" + ref.username : tr("cert.private"));
    var html = "<p>" + esc(tr(headingKey)) + " ";
    if (!ref.private && ref.username && (ref.profile_url || true)) {
      var href = ref.profile_url || ("#/u/" + encodeURIComponent(ref.username));
      html += '<a href="' + esc(href) + '" data-link>' + esc(ref.username ? "@" + ref.username : label) + "</a>";
    } else {
      html += esc(label);
      if (ref.private && ref.username) html += ' <span class="dim">' + esc(tr("cert.albumPrivate")) + "</span>";
    }
    return html + "</p>";
  }

  /* Strip a known grader prefix so «PSA 12345678» matches certificate_no «12345678». */
  function certQueryForApi(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/^(PSA|BGS|CGC|SGC|ACE|TAG|HGA|PCA|GS|BVG)\s*[-./]?\s*(.+)$/i);
    if (m && m[2] && /[0-9]/.test(m[2])) return m[2].trim();
    return s;
  }

  function certSearchForm(q) {
    return '<form class="dm-cert-form" id="cert-search-form">' +
      '<label class="field">' + esc(tr("cert.search")) +
      '<input name="q" type="search" value="' + esc(q || "") + '" placeholder="' + esc(tr("cert.ph")) + '" autocomplete="off" required></label>' +
      '<button class="btn primary" type="submit">' + esc(tr("cert.submit")) + "</button></form>";
  }

  function certSearchHtml(q, data, err) {
    var html = '<section class="panel dm-cert-page"><div class="page-head"><div><h1>' + esc(tr("cert.title")) + "</h1>" +
      "<p>" + esc(tr("cert.lede")) + "</p></div></div>" + certSearchForm(q);
    if (err) html += '<p class="error">' + esc(err.message || tr("cert.queryShort")) + "</p>";
    if (data && q) {
      var results = data.results || [];
      if (!results.length) html += '<p class="empty">' + esc(tr("cert.empty")) + "</p>";
      results.forEach(function (r) {
        var card = r.card || {};
        var dig = r.digital;
        var serial = dig && dig.serial_number != null ? serialFmt(dig.serial_number, dig.serial_total) : "";
        html += '<article class="dm-cert-result">' +
          "<h2>" + esc(card.name || tr("share.card")) + "</h2>" +
          '<p class="muted">' + esc([card.grader, card.certificate_no, card.grade].filter(Boolean).join(" · ")) +
          (card.set_name ? " · " + esc(card.set_name) : "") + (card.code_printed ? " · " + esc(card.code_printed) : "") + "</p>";
        if (r.full_set) html += '<p>' + offerBadgeHtml({ kind: "fullset" }) + "</p>";
        if (dig) {
          html += '<p class="price">' + esc(tr("cert.digital")) + ": " +
            esc(dig.rarity_label || dig.rarity_tier || "—") + (serial ? " · " + esc(serial) : "") + "</p>";
        } else {
          html += '<p class="muted">' + esc(tr("cert.notOpened")) + "</p>";
        }
        html += ownerRefHtml(r.digital_owner, "cert.digitalOwner");
        html += ownerRefHtml(r.physical_owner, "cert.physicalOwner");
        html += "<h3>" + esc(tr("cert.listings")) + "</h3>";
        var ls = r.listings || [];
        if (!ls.length) html += '<p class="muted">' + esc(tr("cert.noListings")) + "</p>";
        else {
          html += '<ul class="dm-cert-listings">' + ls.map(function (l) {
            var k = offerKind(l) || "";
            var label = k === "fullset" ? tr("offer.fullSet") : k === "digital" ? tr("offer.digital") : k === "physical" ? tr("offer.physical") : tr("cert.listing");
            return '<li><a href="#/annuncio/' + encodeURIComponent(l.id) + "/" + encodeURIComponent(card.id) + '" data-link>' +
              esc(label) + (l.price_cents ? " · " + euros(l.price_cents) : "") + "</a></li>";
          }).join("") + "</ul>";
        }
        html += "</article>";
      });
    }
    html += "</section>";
    return html;
  }

  function bindCertForm(root) {
    var form = (root || document).querySelector("#cert-search-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = (form.querySelector('input[name="q"]') || {}).value || "";
      location.hash = "#/cerca-certificato?q=" + encodeURIComponent(String(q).trim());
    });
  }

  async function renderCertSearch($app, q) {
    q = q == null ? (hashQuery().q || "") : q;
    $app.innerHTML = certSearchHtml(q, null, null);
    bindCertForm($app);
    if (!q) return;
    $app.innerHTML = certSearchHtml(q, null, null) + '<p class="dim">' + esc(tr("cert.loading")) + "</p>";
    bindCertForm($app);
    try {
      var data = await v9api("search/cert?q=" + encodeURIComponent(certQueryForApi(q)));
      $app.innerHTML = certSearchHtml(q, data, null);
    } catch (err) {
      $app.innerHTML = certSearchHtml(q, null, err);
    }
    bindCertForm($app);
  }

  function certSearchCompact() {
    if (!v9On()) return "";
    return '<div class="dm-cert-compact">' + certSearchForm(hashQuery().q || "") + "</div>";
  }

  function inboxHtml(data) {
    var chats = (data && data.conversations) || [];
    var html = '<section class="panel dm-inbox"><div class="page-head"><div><h1>' + esc(tr("chat.inbox")) + "</h1>" +
      "<p>" + esc(tr("chat.inboxLede")) + "</p></div></div>";
    html += dealNoticeHtml();
    if (!chats.length) html += '<p class="empty">' + esc(tr("chat.empty")) + "</p>";
    else {
      html += '<div class="list">' + chats.map(function (c) {
        var name = c.other_label || (c.other_username ? "@" + c.other_username : tr("chat.collector"));
        return '<a class="list-item" href="#/chat/' + encodeURIComponent(c.id) + '" data-link><div><b>' +
          esc(name) + "</b>" +
          (c.unread ? ' <span class="nav-badge">' + esc(String(c.unread)) + "</span>" : "") +
          (c.card_name ? '<div class="dim">' + esc(c.card_name) + "</div>" : "") +
          (c.last_message_preview ? '<p class="muted">' + esc(c.last_message_preview) + "</p>" : "") +
          (c.last_message_warning ? '<p class="dm-off-warn">' + esc(tr("chat.warnOff")) + "</p>" : "") +
          "</div></a>";
      }).join("") + "</div>";
    }
    html += "</section>";
    return html;
  }

  function reportReasons() {
    return ["spam", "off_platform_payment", "scam", "abuse", "other"];
  }

  function chatHtml(chat, messages) {
    var other = (chat && (chat.other_label || (chat.other_username ? "@" + chat.other_username : ""))) || "";
    var blocked = !!(chat && chat.blocked_by_me);
    var html = '<section class="panel dm-chat"><div class="page-head"><div>' +
      '<p class="kicker"><a href="#/messaggi" data-link>' + esc(tr("chat.inbox")) + "</a></p>" +
      "<h1>" + esc(other) + "</h1>" +
      (chat && chat.card_name ? "<p>" + esc(chat.card_name) + "</p>" : "") +
      "</div></div>";
    html += dealNoticeHtml();
    html += '<p class="dim">' + esc(tr("chat.onlyUsernames")) + "</p>";
    if (chat && chat.blocked_by_other) html += '<p class="error">' + esc(tr("chat.blockedByOther")) + "</p>";
    html += '<div class="row-actions dm-chat-tools">' +
      '<button type="button" class="btn ghost" id="chat-report">' + esc(tr("chat.report")) + "</button>" +
      '<button type="button" class="btn ghost" id="chat-block">' + esc(blocked ? tr("chat.unblock") : tr("chat.block")) + "</button></div>";
    html += '<div class="dm-chat-log" id="chat-log">';
    (messages || []).forEach(function (m) {
      html += '<div class="dm-msg' + (m.mine ? " is-mine" : "") + (m.warning ? " is-flagged" : "") + '" data-msg="' + esc(m.id) + '">' +
        '<div class="dm-msg-meta">@' + esc(m.sender_username || "") + "</div>" +
        "<p>" + esc(m.body) + "</p>";
      if (m.warning || (m.warning_codes && m.warning_codes.length)) {
        html += '<p class="dm-off-warn" role="alert">' + esc(tr("chat.warnOff")) + "</p>";
      }
      html += "</div>";
    });
    html += "</div>";
    if (!blocked && !(chat && chat.blocked_by_other)) {
      html += '<form id="chat-form" class="dm-chat-form"><label class="field sr-only" for="chat-body">' + esc(tr("chat.placeholder")) + "</label>" +
        '<textarea id="chat-body" name="body" required rows="3" maxlength="1000" placeholder="' + esc(tr("chat.placeholder")) + '"></textarea>' +
        '<button class="btn primary" type="submit">' + esc(tr("chat.send")) + "</button>" +
        '<p class="error" id="chat-err" hidden></p><p class="ok" id="chat-ok" hidden></p></form>';
    }
    html += '<form id="chat-report-form" class="dm-report-form" hidden>' +
      '<label class="field">' + esc(tr("chat.reportPrompt")) +
      '<select name="reason" required>' + reportReasons().map(function (r) {
        return '<option value="' + r + '">' + esc(tr("chat.reason." + r)) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="field">' + esc(tr("chat.reportNote")) + '<textarea name="note" maxlength="500" rows="2"></textarea></label>' +
      '<button class="btn" type="submit">' + esc(tr("chat.report")) + "</button></form></section>";
    return html;
  }

  function chatAuthError($app, err) {
    var msg = (err && err.code === "email_not_verified") ? tr("chat.emailNotVerified") : (err && err.message) || tr("error.generic", { status: "" });
    $app.innerHTML = '<section class="panel"><h1>' + esc(tr("chat.inbox")) + '</h1><p class="error">' + esc(msg) +
      (err && err.code === "email_not_verified" ? ' <a href="#/account" data-link>' + esc(tr("card.profile")) + "</a>" : "") +
      "</p></section>";
  }

  async function renderInbox($app) {
    if (!userRef) { location.hash = "#/accedi"; return; }
    $app.innerHTML = '<div class="skel" style="min-height:200px"></div>';
    try {
      var data = await v9api("conversations");
      $app.innerHTML = inboxHtml(data);
    } catch (err) {
      chatAuthError($app, err);
    }
  }

  async function startChatAndGo(listingId, slabId, go) {
    if (!userRef) { location.hash = "#/accedi"; return; }
    var data = await v9api("listings/" + encodeURIComponent(listingId) + "/conversation", { body: {} });
    var id = data && data.conversation && data.conversation.id;
    if (id) (go || function (h) { location.hash = h; })("#/chat/" + encodeURIComponent(id));
  }

  async function renderChat($app, chatId, go) {
    if (!userRef) { location.hash = "#/accedi"; return; }
    $app.innerHTML = '<div class="skel" style="min-height:200px"></div>';
    try {
      var data = await v9api("conversations/" + encodeURIComponent(chatId) + "/messages?limit=50");
      $app.innerHTML = chatHtml(data.conversation, data.messages || []);
      bindChat($app, chatId, data.conversation, go);
      v9api("conversations/" + encodeURIComponent(chatId) + "/read", { body: {} }).catch(function () {});
    } catch (err) {
      chatAuthError($app, err);
    }
  }

  function bindChat(root, chatId, chat, go) {
    var form = root.querySelector("#chat-form");
    if (form) form.onsubmit = function (e) {
      e.preventDefault();
      var ta = form.querySelector("#chat-body");
      var body = (ta && ta.value || "").trim();
      var errEl = document.getElementById("chat-err");
      if (errEl) errEl.hidden = true;
      if (!body) return;
      form.querySelector("button").disabled = true;
      v9api("conversations/" + encodeURIComponent(chatId) + "/messages", { body: { body: body } })
        .then(function () { renderChat(root, chatId, go); })
        .catch(function (err) {
          form.querySelector("button").disabled = false;
          if (errEl) { errEl.hidden = false; errEl.textContent = err.message; }
        });
    };
    var rec = root.querySelector("#chat-report");
    var recForm = root.querySelector("#chat-report-form");
    if (rec && recForm) rec.onclick = function () { recForm.hidden = !recForm.hidden; };
    if (recForm) recForm.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(recForm);
      v9api("conversations/" + encodeURIComponent(chatId) + "/report", {
        body: { reason: fd.get("reason"), note: fd.get("note") || "" }
      }).then(function () {
        var ok = document.getElementById("chat-ok");
        recForm.hidden = true;
        if (ok) { ok.hidden = false; ok.textContent = tr("chat.reported"); }
        else window.alert(tr("chat.reported"));
      }).catch(function (err) { window.alert(err.message); });
    };
    var blk = root.querySelector("#chat-block");
    if (blk) blk.onclick = function () {
      var blocked = !!(chat && chat.blocked_by_me);
      if (!blocked && !window.confirm(tr("chat.blockConfirm", { name: (chat && chat.other_username) || "" }))) return;
      v9api("conversations/" + encodeURIComponent(chatId) + "/block", { method: blocked ? "DELETE" : "POST", body: {} })
        .then(function () {
          if (blocked) renderChat(root, chatId, go);
          else { window.alert(tr("chat.blocked")); (go || function (h) { location.hash = h; })("#/messaggi"); }
        })
        .catch(function (err) { window.alert(err.message); });
    };
  }

  function verifiedBadgeHtml(label, live) {
    if (!v9On()) return "";
    return '<div class="dm-verified' + (live ? " is-live" : "") + '" data-verified-badge role="status">' +
      '<span class="dm-verified-dot" aria-hidden="true"></span>' +
      "<strong>" + esc(tr("verify.badge")) + "</strong>" +
      (label ? "<span>" + esc(tr("verify.owner", { name: label })) + "</span>" : "") +
      "</div>";
  }

  function updateVerifiedBadge(el, copy) {
    if (!el || !copy) return;
    var owner = copy.digital_owner || {};
    var label = owner.label || (owner.username ? "@" + owner.username : "");
    el.classList.add("is-live");
    el.innerHTML = '<span class="dm-verified-dot" aria-hidden="true"></span><strong>' +
      esc(tr("verify.badge")) + "</strong>" +
      (label ? "<span>" + esc(tr("verify.owner", { name: label })) + "</span>" : "");
  }

  function attachVerified(card) {
    if (!v9On() || !card || card.is_ungraded || !card.id) return;
    var stage = document.querySelector(".card-hero .slab-stage, .product-digital, .card-hero .facts");
    if (!stage) return;
    var existing = document.querySelector("[data-verified-badge]");
    if (!existing) {
      stage.insertAdjacentHTML("beforeend", verifiedBadgeHtml("", false));
      existing = document.querySelector("[data-verified-badge]");
    }
    function refresh() {
      v9api("copies/" + encodeURIComponent(card.id)).then(function (d) {
        if (d && d.copy) updateVerifiedBadge(existing, d.copy);
      }).catch(function () {});
    }
    refresh();
    if (verifyTimer) clearInterval(verifyTimer);
    verifyTimer = setInterval(refresh, 20000);
  }

  function attachHoloSheen() {
    if (!v9On()) return;
    var nodes = document.querySelectorAll(
      ".card-hero [data-tilt], .product-digital [data-tilt], .card-hero .rv2-copy, .product-digital .rv2-copy"
    );
    nodes.forEach(function (el) {
      el.setAttribute("data-holo-live", "");
      if (!el.querySelector(".dm-holo-sheen")) {
        var win = el.querySelector(".slab-window, .rv2-window") || el;
        var sheen = document.createElement("div");
        sheen.className = "dm-holo-sheen";
        sheen.setAttribute("aria-hidden", "true");
        win.appendChild(sheen);
      }
      if (el._v9Holo) return;
      el._v9Holo = true;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / Math.max(1, r.width);
        var py = (e.clientY - r.top) / Math.max(1, r.height);
        el.style.setProperty("--hx", (px * 100).toFixed(1) + "%");
        el.style.setProperty("--hy", (py * 100).toFixed(1) + "%");
        el.classList.add("is-live");
      });
      el.addEventListener("pointerleave", function () {
        el.classList.remove("is-live");
      });
    });
    if (root.DeviceOrientationEvent && !root._dmV9Gyro) {
      root._dmV9Gyro = true;
      var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var onOrient = function (e) {
        if (reduce) return;
        var gy = Math.max(-25, Math.min(25, e.gamma || 0));
        var gx = Math.max(-25, Math.min(25, e.beta || 0));
        document.querySelectorAll("[data-holo-live]").forEach(function (el) {
          if (el.classList.contains("is-live")) return;
          el.style.setProperty("--hx", (50 + gy).toFixed(1) + "%");
          el.style.setProperty("--hy", (36 + gx * 0.3).toFixed(1) + "%");
        });
      };
      root.addEventListener("deviceorientation", onOrient, { passive: true });
    }
  }

  function enhanceDigitalCopy(card) {
    attachHoloSheen();
    if (card) attachVerified(card);
  }

  function romeDate() {
    try {
      return new Date().toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) {
      var d = new Date();
      return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
    }
  }

  function watermarkText(card, user) {
    var name = (user && (user.username || user.display_name)) ||
      (card && (card.digital_owner_username || (card.digital_owner && card.digital_owner.label) || card.owner_username)) || "";
    if (name && name.charAt(0) !== "@" && name.indexOf(" ") < 0) name = "@" + name;
    return [name, romeDate()].filter(Boolean).join(" · ");
  }

  function loadStamp(id) {
    if (!id) return Promise.resolve("");
    return v9api("copies/" + encodeURIComponent(id) + "/social-stamp").then(function (d) {
      return (d && d.stamp && d.stamp.text) || "";
    }).catch(function () { return ""; });
  }

  function decorateTiles(root) {
    if (!v9On()) return;
    (root || document).querySelectorAll(".mb-card, .slab-tile, .trade-card").forEach(function (a) {
      if (a.querySelector(".pill-physical, .pill-digital, .pill-fullset")) return;
      var kind = a.getAttribute("data-offer") || "";
      if (!kind) return;
      var badge = offerBadgeHtml({ kind: kind, digital_owned_by_other: a.getAttribute("data-split") === "1" });
      var note = (kind === "physical" || a.getAttribute("data-split") === "1")
        ? '<p class="dm-physical-note dm-tile-note">' + esc(tr("offer.physicalNote")) + "</p>" : "";
      var body = a.querySelector(".mb-body, .tile-meta") || a;
      if (badge) body.insertAdjacentHTML("afterbegin", badge);
      if (note && kind === "physical") body.insertAdjacentHTML("beforeend", note);
    });
  }

  function navItemHtml() {
    if (!v9On() || !userRef) return "";
    return '<a href="#/messaggi" data-link>' + esc(tr("chat.inbox")) + "</a>";
  }

  function stopVerifyPoll() {
    if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
  }

  root.DreaMintTradeV9 = {
    on: v9On,
    setCfg: setCfg,
    setUser: setUser,
    hashQuery: hashQuery,
    offerHref: offerHref,
    activeOffer: activeOffer,
    isFullSet: isFullSet,
    isSplitOwners: isSplitOwners,
    offerKind: offerKind,
    offerFilterRow: offerFilterRow,
    offerBadgeHtml: offerBadgeHtml,
    physicalSplitNoteHtml: physicalSplitNoteHtml,
    ownershipPillsHtml: ownershipPillsHtml,
    listFormHtml: listFormHtml,
    bindListForm: bindListForm,
    isDigitalListing: isDigitalListing,
    dealNoticeHtml: dealNoticeHtml,
    contactSellerHtml: contactSellerHtml,
    certSearchCompact: certSearchCompact,
    bindCertForm: bindCertForm,
    renderCertSearch: renderCertSearch,
    renderInbox: renderInbox,
    renderChat: renderChat,
    startChatAndGo: startChatAndGo,
    filterByOffer: filterByOffer,
    enhanceDigitalCopy: enhanceDigitalCopy,
    decorateTiles: decorateTiles,
    watermarkText: watermarkText,
    loadStamp: loadStamp,
    navItemHtml: navItemHtml,
    stopVerifyPoll: stopVerifyPoll,
    v9api: v9api
  };
})(window);
