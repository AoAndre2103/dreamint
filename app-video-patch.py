import sys
p=sys.argv[1]; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, old[:70]
    s=s.replace(old,new)
# 1) graded form: video instead of the handwritten-code photo
rep('''        photoSlot("challenge", tr("reg.challengePhoto"), { showSlab: true }) +
        photoSlot("cert", tr("reg.certPhoto"), { optional: true, showSlab: true, defaultRatio: "free" }) + "</div>";
    }''','''        photoSlot("cert", tr("reg.certPhoto"), { optional: true, showSlab: true, defaultRatio: "free" }) + "</div>" +
        '<div class="challenge-video"><p><b>Video-sfida</b>: inquadra la carta nella custodia e leggi ad alta voce il codice qui sopra (circa 5 secondi, massimo 10).</p>' +
        '<input type="file" id="challenge-video" accept="video/*" capture="environment"><p class="dim" id="challenge-video-status"></p></div>';
    }''')
# 2) upload on pick (size + duration checked in the browser, then by the server)
rep('''    var ch = document.getElementById("challenge");
''','''    var ch = document.getElementById("challenge");
    challengeVideoOk = false;
    var cv = document.getElementById("challenge-video");
    if (cv) cv.addEventListener("change", function () {
      var f = cv.files && cv.files[0], st = document.getElementById("challenge-video-status");
      challengeVideoOk = false;
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { st.textContent = "Video troppo pesante (max 20 MB): registra circa 5 secondi."; return; }
      if (!challengeId) { st.textContent = "Codice non ancora pronto, riprova tra un attimo."; return; }
      var probe = document.createElement("video"); probe.preload = "metadata"; probe.muted = true;
      var url = URL.createObjectURL(f);
      var send = function () {
        URL.revokeObjectURL(url);
        if (isFinite(probe.duration) && probe.duration > 10.5) { st.textContent = "Video troppo lungo: massimo 10 secondi (bastano 5)."; return; }
        st.textContent = "Caricamento del video…";
        fetch("/api/cards/challenge/" + encodeURIComponent(challengeId) + "/video", { method: "POST", credentials: "include", headers: { "content-type": f.type || "application/octet-stream" }, body: f })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ("Errore " + r.status)); return d; }); })
          .then(function () { challengeVideoOk = true; st.textContent = "Video caricato."; })
          .catch(function (err) { st.textContent = err.message; });
      };
      probe.onloadedmetadata = send; probe.onerror = send; probe.src = url;
    });
''')
rep('''  var challengeCode = "", challengeId = "";''','''  var challengeCode = "", challengeId = "", challengeVideoOk = false;''')
# 3) submit: the video replaces the photo
rep('''      if (!raw && !photos.challenge) { showErr(tr("photo.needChallenge")); return; }''',
    '''      if (!raw && !challengeVideoOk) { showErr("Carica il video-sfida: inquadra la carta e leggi ad alta voce il codice"); return; }''')
# 4) admin: play the video with audio (legacy photo still shown if present)
rep('''ph("challenge", "Foto-sfida (codice " + esc(c.challenge_code || "") + ")")''',
    '''(c.challenge_video ? '<div class="panel"><h3>Video-sfida (codice ' + esc(c.challenge_code || "") + ')</h3><video controls playsinline preload="metadata" src="/api/cards/' + encodeURIComponent(c.id) + '/challenge-video" style="max-width:100%;border-radius:12px"></video></div>' : (c.photos && c.photos.challenge ? ph("challenge", "Foto-sfida (codice " + esc(c.challenge_code || "") + ")") : (c.is_ungraded ? "" : '<p class="notice">Video-sfida mancante</p>')))''')
open(p,"w").write(s); print("patched", p)
