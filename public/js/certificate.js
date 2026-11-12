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
  function api(path, opts) {
    opts = opts || {};
    return fetch("/api/" + path, {
      credentials: "include",
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: { "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error(d.error || "Errore " + r.status);
          err.payload = d;
          err.status = r.status;
          throw err;
        }
        return d;
      });
    });
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function homeHowToHtml() {
    return '<section class="howto-digital" id="copia-digitale">' +
      "<h2>" + tr("howto.title", "Come funziona la copia digitale") + "</h2>" +
      "<p>" + tr("howto.lede", "Ogni carta gradata verificata su DreaMint riceve una copia digitale unica: l’immagine ufficiale con la cornice della rarità, un seriale e una rarità (da Comune a Mitica) estratti una sola volta. Non è un NFT e non sta su una blockchain.") + "</p>" +
      '<div class="howto-markets">' +
      '<article><h3>' + tr("howto.graded.h", "Gradate") + "</h3><p>" + tr("howto.graded.p", "La carta fisica e la copia digitale si vendono sempre insieme.") + "</p></article>" +
      "<article><h3>" + tr("howto.raw.h", "Non gradate") + "</h3><p>" + tr("howto.raw.p", "Solo la carta fisica: un mercato classico, senza copia digitale.") + "</p></article>" +
      "</div>" +
      '<p class="howto-follow">' + tr("howto.follow", "La copia segue la carta: se vendi fuori da DreaMint, passa il certificato con il codice; senza certificato, il nuovo proprietario può richiederla mandando le foto.") + "</p>" +
      '<p class="row-actions">' +
      '<a class="btn ghost" href="#/riscatta" data-link>' + tr("howto.redeem", "Riscatta una copia") + "</a>" +
      '<a class="btn ghost" href="#/riscatta?modo=foto" data-link>' + tr("howto.claim", "Richiedi con le foto") + "</a>" +
      "</p></section>";
  }

  function collectionExtraLinks() {
    return '<a class="btn ghost" href="#/riscatta" data-link>' + tr("howto.redeem", "Riscatta una copia") + "</a>";
  }

  function cardActionButtons(c) {
    if (!c || c.is_ungraded || !c.id) return "";
    var approved = c.status && c.status !== "in_review" && c.status !== "rejected";
    if (!approved && !c.rarity_tier) return "";
    var html = '<p class="row-actions cert-actions">';
    if (c.rarity_tier || c.can_open || c.can_replay) {
      html += '<a class="btn ghost" href="#/certificato/' + esc(c.id) + '" data-link>' + tr("cert.open", "Certificato") + "</a>";
      html += '<a class="btn ghost" href="/c/' + esc(c.id) + '" target="_blank" rel="noopener">' + tr("cert.public", "Pagina 3D") + "</a>";
      html += '<button type="button" class="btn ghost" data-share-copy="' + esc(c.id) + '">' + tr("cert.share", "Condividi") + "</button>";
    }
    return html + "</p>";
  }

  function bindShareButtons(card) {
    document.querySelectorAll("[data-share-copy]").forEach(function (btn) {
      if (btn._boundShare) return;
      btn._boundShare = true;
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-share-copy");
        var data = card && card.id === id ? cardToShareData(card) : null;
        var run = function (payload) {
          if (!root.DreaMintShare || !root.DreaMintShare.shareCopy) return;
          btn.disabled = true;
          root.DreaMintShare.shareCopy(payload).catch(function () {}).then(function () { btn.disabled = false; });
        };
        if (data && (data.rarity_tier || data.art_url)) return run(data);
        api("copies/" + encodeURIComponent(id)).then(function (d) { run(d.copy); }).catch(function (err) {
          btn.disabled = false;
          alert(err.message);
        });
      });
    });
  }

  function cardToShareData(c) {
    var model = c.model || {};
    var art = c.catalog_image || model.catalog_image || (c.id ? (location.origin + "/api/copies/" + c.id + "/art") : "");
    var total = c.serial_total || c.serial_number;
    var serial = c.serial_number != null ? ("#" + String(c.serial_number).padStart(4, "0") + (total ? " / " + String(total).padStart(4, "0") : " / ∞")) : "";
    return {
      id: c.id,
      name: model.name || c.card_name || c.name,
      set_name: model.set_name,
      rarity_tier: c.rarity_tier,
      rarity_label: c.rarity_label,
      serial_number: c.serial_number,
      serial_total: total,
      serial_label: serial,
      grader: c.grader,
      grade: c.grade,
      share_url: location.origin + "/c/" + c.id,
      art_url: c.id ? (location.origin + "/api/copies/" + c.id + "/art") : art,
      photoUrl: c.id ? (location.origin + "/api/copies/" + c.id + "/art") : art
    };
  }

  function pageCertificate(cert, revealCode) {
    var c = cert || {};
    var code = revealCode || c.transfer_code;
    var qr = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(c.share_url || ("https://dreamint.it/c/" + c.id));
    return '<section class="cert-page" id="cert-print">' +
      '<div class="cert-toolbar no-print">' +
      '<button type="button" class="btn primary" id="cert-print-btn">' + tr("cert.print", "Stampa / Salva PDF") + "</button>" +
      '<button type="button" class="btn ghost" id="cert-regen-btn">' + tr("cert.regen", "Genera un nuovo codice") + "</button>" +
      '<button type="button" class="btn ghost" data-share-copy="' + esc(c.id) + '">' + tr("cert.share", "Condividi") + "</button>" +
      '<a class="btn ghost" href="/c/' + esc(c.id) + '" target="_blank" rel="noopener">' + tr("cert.public", "Pagina 3D") + "</a>" +
      "</div>" +
      '<article class="cert-sheet">' +
      '<header class="cert-head"><img src="/img/dreamint-logo-full.webp?v=20261110e" class="cert-logo-light" alt="DreaMint" width="220">' +
      '<img src="/img/dreamint-logo-full-dark.webp?v=20261110e" class="cert-logo-dark" alt="DreaMint" width="220">' +
      "<p>" + tr("cert.kicker", "Certificato della copia digitale") + "</p></header>" +
      '<div class="cert-body">' +
      (c.art_url ? '<img class="cert-art" src="' + esc(c.art_url) + '" alt="">' : "") +
      "<div><h1>" + esc(c.name || "Carta") + "</h1>" +
      '<p class="muted">' + esc(c.set_name || "") + " · " + esc(c.code_printed || "") + "</p>" +
      '<dl class="cert-dl">' +
      "<div><dt>" + tr("cert.serial", "Seriale") + "</dt><dd>" + esc(c.serial_label || "—") + "</dd></div>" +
      "<div><dt>" + tr("cert.rarity", "Rarità") + "</dt><dd>" + esc(c.rarity_label || "—") + "</dd></div>" +
      "<div><dt>" + tr("cert.grader", "Grader") + "</dt><dd>" + esc(c.grader || "—") + (c.grade ? " " + esc(c.grade) : "") + "</dd></div>" +
      "<div><dt>" + tr("cert.certno", "N. certificato") + "</dt><dd>" + esc(c.certificate_no || "—") + "</dd></div>" +
      "<div><dt>" + tr("cert.minted", "Assegnata il") + "</dt><dd>" + esc(c.minted_at_label || "—") + "</dd></div>" +
      "<div><dt>" + tr("cert.owner", "Proprietario") + "</dt><dd>" + esc(c.owner_name || "—") + "</dd></div>" +
      "</dl></div>" +
      '<div class="cert-qr"><img src="' + esc(qr) + '" width="180" height="180" alt="QR"><p>' + esc((c.share_url || "").replace(/^https?:\/\//, "")) + "</p></div>" +
      "</div>" +
      (code
        ? '<div class="cert-code"><span>' + tr("cert.codeLabel", "Codice di trasferimento") + "</span><strong>" + esc(code) + "</strong><p>" + tr("cert.codeHint", "Se vendi la carta fuori da DreaMint, passa questo codice insieme al certificato. Si usa una sola volta. Conservalo: non potremo mostrartelo di nuovo, solo generarne uno nuovo.") + "</p></div>"
        : '<p class="dim cert-code-missing">' + tr("cert.codeStored", "Il codice di trasferimento è stato inviato alla tua email. Se l’hai perso, genera un nuovo codice: il precedente non sarà più valido.") + "</p>") +
      '<p class="dim">' + tr("cert.disclaimer", "Non è un NFT e non sta su una blockchain. La rarità digitale non ha un valore garantito.") + "</p>" +
      "</article></section>";
  }

  function pageRedeem(mode) {
    var photo = mode === "foto";
    return '<section class="panel redeem-page" style="max-width:620px;margin:20px auto">' +
      "<h1>" + tr("redeem.title", "Riscatta una copia digitale") + "</h1>" +
      "<p class=\"muted\">" + tr("redeem.lede", "Se hai comprato una carta gradata fuori da DreaMint, puoi prendere tu la copia digitale. Con il certificato usi il codice; senza, invii le foto e un operatore controlla.") + "</p>" +
      '<div class="chip-row">' +
      '<a class="chip' + (!photo ? " on" : "") + '" href="#/riscatta" data-link>' + tr("redeem.withCode", "Ho il codice") + "</a>" +
      '<a class="chip' + (photo ? " on" : "") + '" href="#/riscatta?modo=foto" data-link>' + tr("redeem.withPhotos", "Non ho il certificato") + "</a>" +
      "</div>" +
      (photo ? claimForm() : redeemForm()) +
      "</section>";
  }

  function redeemForm() {
    return '<form id="redeem-form">' +
      '<label class="field">' + tr("redeem.grader", "Grader (se lo sai)") + '<input name="grader" placeholder="PSA, BGS, CGC, GRAAD…" autocapitalize="characters"></label>' +
      '<label class="field">' + tr("redeem.cert", "Numero di certificato") + '<input name="certificate_no" required placeholder="es. 12345678" autocapitalize="characters"></label>' +
      '<label class="field">' + tr("redeem.code", "Codice di trasferimento") + '<input name="transfer_code" required placeholder="DM-XXXX-XXXX-XXXX" autocapitalize="characters"></label>' +
      '<p class="error" id="form-err" hidden></p><p class="ok" id="form-ok" hidden></p>' +
      '<button class="btn primary" type="submit">' + tr("redeem.submit", "Riscatta la copia") + "</button></form>";
  }

  function claimForm() {
    return '<form id="claim-form">' +
      '<label class="field">' + tr("redeem.grader", "Grader (se lo sai)") + '<input name="grader" placeholder="PSA, BGS, CGC, GRAAD…" autocapitalize="characters"></label>' +
      '<label class="field">' + tr("redeem.cert", "Numero di certificato") + '<input name="certificate_no" required placeholder="es. 12345678" autocapitalize="characters"></label>' +
      '<label class="field">' + tr("claim.msg", "Messaggio (facoltativo)") + '<textarea name="message" rows="3" maxlength="1000" placeholder="' + esc(tr("claim.msgPh", "Quando e come hai acquistato la carta")) + '"></textarea></label>' +
      '<label class="field">' + tr("claim.photos", "Foto della carta + foglietto con il tuo nome utente") +
      '<input id="claim-photos" type="file" accept="image/*" multiple required></label>' +
      '<p class="dim">' + tr("claim.hint", "Inquadra la carta gradata (etichetta e numero di certificato visibili) e un foglietto con il tuo nome utente scritto a mano. Puoi caricare fino a 4 foto.") + "</p>" +
      '<p class="error" id="form-err" hidden></p><p class="ok" id="form-ok" hidden></p>' +
      '<button class="btn primary" type="submit">' + tr("claim.submit", "Invia la richiesta") + "</button></form>";
  }

  function bindRedeem() {
    var form = document.getElementById("redeem-form");
    if (form) form.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var err = document.getElementById("form-err");
      var ok = document.getElementById("form-ok");
      if (err) err.hidden = true;
      if (ok) ok.hidden = true;
      api("copies/redeem", {
        body: {
          grader: fd.get("grader"),
          certificate_no: fd.get("certificate_no"),
          transfer_code: fd.get("transfer_code")
        }
      }).then(function (d) {
        if (ok) {
          ok.hidden = false;
          ok.innerHTML = tr("redeem.ok", "La copia è tua. Seriale e rarità restano gli stessi.") +
            (d.transfer_code ? " " + tr("redeem.newCode", "Il nuovo codice di trasferimento è") + " <b>" + esc(d.transfer_code) + "</b>." : "") +
            (d.copy ? ' <a href="#/certificato/' + esc(d.copy.id) + '" data-link>' + tr("cert.open", "Apri il certificato") + "</a>" : "");
        }
      }).catch(function (ex) {
        if (err) { err.hidden = false; err.textContent = ex.message; }
      });
    };
    var claim = document.getElementById("claim-form");
    if (claim) claim.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(claim);
      var err = document.getElementById("form-err");
      var ok = document.getElementById("form-ok");
      if (err) err.hidden = true;
      if (ok) ok.hidden = true;
      var input = document.getElementById("claim-photos");
      var files = input && input.files ? Array.prototype.slice.call(input.files, 0, 4) : [];
      if (!files.length) {
        if (err) { err.hidden = false; err.textContent = tr("claim.needPhoto", "Carica almeno una foto."); }
        return;
      }
      Promise.all(files.map(fileToDataUrl)).then(function (photos) {
        return api("claims", {
          body: {
            grader: fd.get("grader"),
            certificate_no: fd.get("certificate_no"),
            message: fd.get("message"),
            photos: photos
          }
        });
      }).then(function (d) {
        if (ok) {
          ok.hidden = false;
          ok.textContent = (d.claim && d.claim.message) || tr("claim.ok", "Richiesta inviata. Un operatore la controllerà.");
        }
        claim.reset();
      }).catch(function (ex) {
        if (err) { err.hidden = false; err.textContent = ex.message; }
      });
    };
  }

  function bindCertificate(cert) {
    var printBtn = document.getElementById("cert-print-btn");
    if (printBtn) printBtn.onclick = function () { window.print(); };
    var regen = document.getElementById("cert-regen-btn");
    if (regen && cert && cert.id) {
      regen.onclick = function () {
        if (!confirm(tr("cert.regenConfirm", "Il codice precedente non sarà più valido. Generarne uno nuovo?"))) return;
        regen.disabled = true;
        api("cards/" + encodeURIComponent(cert.id) + "/transfer-code", { body: {} }).then(function (d) {
          var host = document.getElementById("app");
          if (host) host.innerHTML = pageCertificate(Object.assign({}, cert, d.certificate || {}, { transfer_code: d.transfer_code }), d.transfer_code);
          bindCertificate(Object.assign({}, cert, { transfer_code: d.transfer_code }));
          bindShareButtons(d.certificate || cert);
        }).catch(function (ex) {
          alert(ex.message);
          regen.disabled = false;
        });
      };
    }
    bindShareButtons(cert);
  }

  function claimStatusLabel(s) {
    if (s === "pending") return tr("claim.status.pending", "In verifica");
    if (s === "approved") return tr("claim.status.approved", "Approvata");
    if (s === "rejected") return tr("claim.status.rejected", "Rifiutata");
    return s;
  }

  function pageAdminClaims(claims) {
    var head = '<div class="page-head"><div><h1>' + tr("admin.claims.title", "Riscatti copia digitale") + "</h1>" +
      "<p>" + tr("admin.claims.lede", "Richieste di chi ha comprato la carta fuori da DreaMint e non ha il codice. Controlla le foto; il trasferimento di solito avviene dopo 7 giorni di contestazione.") + "</p></div>" +
      '<a class="btn ghost" href="#/admin" data-link>' + tr("admin.back", "Torna alla verifica") + "</a></div>";
    if (!claims.length) return head + '<section class="panel"><p class="muted">' + tr("admin.claims.empty", "Nessuna richiesta.") + "</p></section>";
    return head + '<div class="list">' + claims.map(function (c) {
      return '<a class="list-item" href="#/admin/riscatti/' + esc(c.id) + '" data-link><div></div><div><b>' +
        esc(c.card_name || "Carta") + "</b> " + pill(c.status) +
        '<div class="dim">' + esc(c.grader || "") + " " + esc(c.certificate_no || "") +
        (c.serial_number ? " · #" + String(c.serial_number).padStart(4, "0") : "") + "</div>" +
        '<div class="dim">' + tr("admin.claims.from", "Da") + " " + esc(c.claimant_name || "") +
        " → " + esc(c.owner_name || "") + " · " + tr("admin.claims.window", "Contestazione fino al") + " " +
        esc(c.dispute_until_label || "—") + "</div></div></a>";
    }).join("") + "</div>";
  }

  function pill(status) {
    var cls = status === "rejected" ? "bad" : status === "pending" ? "warn" : "gold";
    return '<span class="pill ' + cls + '">' + esc(claimStatusLabel(status)) + "</span>";
  }

  function pageAdminClaim(c) {
    var photos = (c.photos || []).map(function (src, i) {
      return '<a href="' + esc(src) + '" target="_blank" rel="noopener"><img src="' + esc(src) + '" alt="Foto ' + (i + 1) + '"></a>';
    }).join("");
    var windowNote = c.window_open
      ? '<p class="notice">' + tr("admin.claims.wait", "Finestra di contestazione aperta fino al {date}. Dopo quella data puoi approvare in sicurezza.", { date: c.dispute_until_label }) + "</p>"
      : '<p class="ok">' + tr("admin.claims.ready", "La finestra di contestazione è scaduta il {date}. Puoi approvare il trasferimento.", { date: c.dispute_until_label }) + "</p>";
    var actions = "";
    if (c.status === "pending") {
      actions = '<form id="claim-approve-form"><label class="field">' + tr("admin.claims.note", "Nota interna (facoltativa)") + '<input name="note"></label>' +
        '<label class="field check"><input type="checkbox" name="force"> ' + tr("admin.claims.force", "Approva prima della fine della finestra") + "</label>" +
        '<p class="error" id="form-err" hidden></p>' +
        '<button class="btn primary" type="submit">' + tr("admin.claims.approve", "Approva e trasferisci") + "</button></form>" +
        '<form id="claim-reject-form" style="margin-top:16px"><label class="field">' + tr("admin.claims.reason", "Motivo del rifiuto") + '<input name="reason" required minlength="3"></label>' +
        '<button class="btn" type="submit">' + tr("admin.claims.reject", "Rifiuta") + "</button></form>";
    }
    return '<div class="page-head"><div><h1>' + esc(c.card_name || "Richiesta") + "</h1><p>" + pill(c.status) + "</p></div>" +
      '<a class="btn ghost" href="#/admin/riscatti" data-link>' + tr("admin.claims.back", "Tutti i riscatti") + "</a></div>" +
      '<section class="panel">' +
      '<p><b>' + esc(c.grader || "") + " " + esc(c.certificate_no || "") + "</b> · " + esc(c.set_name || "") + " " + esc(c.code_printed || "") + "</p>" +
      "<p>" + tr("admin.claims.claimant", "Richiedente") + ": " + esc(c.claimant_name || "") + " · " + esc(c.claimant_email || "") + "</p>" +
      "<p>" + tr("admin.claims.owner", "Proprietario attuale") + ": " + esc(c.owner_name || "") + " · " + esc(c.owner_email || "") + "</p>" +
      "<p>" + tr("admin.claims.opened", "Richiesta il") + " " + esc(c.created_at_label) + " · " + tr("admin.claims.window", "Contestazione fino al") + " " + esc(c.dispute_until_label) + "</p>" +
      (c.message ? "<p class=\"muted\">" + esc(c.message) + "</p>" : "") +
      windowNote +
      '<div class="claim-photos">' + photos + "</div>" +
      actions + "</section>";
  }

  function bindAdminClaim(c) {
    var af = document.getElementById("claim-approve-form");
    if (af) af.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(af);
      var err = document.getElementById("form-err");
      if (err) err.hidden = true;
      api("admin/claims/" + c.id + "/approve", { body: { note: fd.get("note"), force: !!fd.get("force") } })
        .then(function () { location.hash = "#/admin/riscatti"; })
        .catch(function (ex) {
          if (ex.status === 409 && ex.payload && ex.payload.needs_force) {
            if (err) { err.hidden = false; err.textContent = ex.message; }
          } else if (err) { err.hidden = false; err.textContent = ex.message; }
        });
    };
    var rf = document.getElementById("claim-reject-form");
    if (rf) rf.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(rf);
      api("admin/claims/" + c.id + "/reject", { body: { reason: fd.get("reason") } })
        .then(function () { location.hash = "#/admin/riscatti"; })
        .catch(function (ex) { alert(ex.message); });
    };
  }

  function adminNavLink() {
    return '<a class="btn ghost" href="#/admin/riscatti" data-link>' + tr("admin.claims.nav", "Riscatti") + "</a>";
  }

  async function handleRoute(ctx) {
    var p = ctx.p || [];
    var $app = ctx.$app;
    if (! $app) return false;

    if (p[0] === "certificato" && p[1]) {
      if (!ctx.state.user) { $app.innerHTML = ctx.pageAuth("login"); ctx.bindAuth("login"); return true; }
      try {
        var d = await api("cards/" + encodeURIComponent(p[1]) + "/certificate");
        $app.innerHTML = pageCertificate(d.certificate);
        bindCertificate(d.certificate);
      } catch (err) {
        $app.innerHTML = '<section class="panel"><p class="error">' + esc(err.message) + '</p><p><a href="#/riscatta" data-link>' + tr("howto.redeem", "Riscatta una copia") + "</a></p></section>";
      }
      return true;
    }

    if (p[0] === "riscatta") {
      if (!ctx.state.user) { $app.innerHTML = ctx.pageAuth("login"); ctx.bindAuth("login"); return true; }
      var mode = (location.hash.split("?")[1] || "");
      var params = new URLSearchParams(mode);
      $app.innerHTML = pageRedeem(params.get("modo") === "foto" ? "foto" : "codice");
      bindRedeem();
      return true;
    }

    if (p[0] === "admin" && p[1] === "riscatti" && p[2]) {
      if (!ctx.state.user || ctx.state.user.role !== "admin") { $app.innerHTML = ctx.pageAuth("login"); ctx.bindAuth("login"); return true; }
      var one = await api("admin/claims/" + encodeURIComponent(p[2]));
      $app.innerHTML = pageAdminClaim(one.claim);
      bindAdminClaim(one.claim);
      return true;
    }

    if (p[0] === "admin" && p[1] === "riscatti") {
      if (!ctx.state.user || ctx.state.user.role !== "admin") { $app.innerHTML = ctx.pageAuth("login"); ctx.bindAuth("login"); return true; }
      var list = await api("admin/claims");
      $app.innerHTML = pageAdminClaims(list.claims || []);
      return true;
    }

    return false;
  }

  root.DreaMintCert = {
    homeHowToHtml: homeHowToHtml,
    collectionExtraLinks: collectionExtraLinks,
    cardActionButtons: cardActionButtons,
    bindShareButtons: bindShareButtons,
    cardToShareData: cardToShareData,
    handleRoute: handleRoute,
    adminNavLink: adminNavLink
  };
})(window);
