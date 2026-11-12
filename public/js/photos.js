(function (global) {
  "use strict";
  var VARIANT_WIDTHS = [112, 224, 336, 448, 560, 672];
  var MAX_SIDE = 2048;
  var HD_QUALITY = 0.85;
  var VARIANT_QUALITY = 0.8;
  var MAX_DATA_CHARS = 8000000;
  var PREVIEW_SIDE = 1024;
  var EXIF6_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkJv8AXP8A7x/nRRRX29D+FH0RjW/iS9Wf/9k=";

  function releaseCanvas(c) {
    if (!c) return;
    try { c.width = 0; c.height = 0; } catch (e) {}
  }
  function analysisCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") {
      try {
        var oc = new OffscreenCanvas(w, h);
        var octx = oc.getContext("2d", { willReadFrequently: true });
        if (octx) return { canvas: oc, ctx: octx };
      } catch (e) {}
    }
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }) };
  }
  var webpOk = null;
  function canEncodeWebp() {
    if (webpOk === null) {
      try {
        var t = document.createElement("canvas");
        t.width = 1; t.height = 1;
        webpOk = t.toDataURL("image/webp").indexOf("data:image/webp") === 0;
        releaseCanvas(t);
      } catch (e) { webpOk = false; }
    }
    return webpOk;
  }
  function exifTestBlob() {
    var bin = atob(EXIF6_JPEG.split(",")[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: "image/jpeg" });
  }
  var orientSupport = null;
  function detectOrientationSupport() {
    if (orientSupport) return orientSupport;
    var imgP = new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im.naturalWidth === 1 && im.naturalHeight === 2); };
      im.onerror = function () { resolve(false); };
      im.src = EXIF6_JPEG;
    });
    var bmpP = typeof createImageBitmap === "function"
      ? createImageBitmap(exifTestBlob(), { imageOrientation: "from-image" }).then(function (b) {
          var ok = b.width === 1 && b.height === 2;
          if (b.close) b.close();
          return ok;
        }).catch(function () { return null; })
      : Promise.resolve(null);
    orientSupport = Promise.all([imgP, bmpP]).then(function (r) { return { img: r[0], bitmap: r[1] }; });
    return orientSupport;
  }

  function isHeicFile(file) {
    if (!file) return false;
    var typ = String(file.type || "").toLowerCase();
    var name = String(file.name || "").toLowerCase();
    return typ.indexOf("heic") >= 0 || typ.indexOf("heif") >= 0 || /\.hei[cf]$/.test(name);
  }
  function heicError() {
    var en = "This browser cannot open HEIC/HEIF photos. On iPhone go to Settings → Camera → Formats → Most Compatible, or export the photo as JPEG and upload it again.";
    var it = "Questo browser non apre le foto HEIC/HEIF. Su iPhone: Impostazioni → Fotocamera → Formati → «Più compatibile», oppure esporta la foto in JPEG e caricala di nuovo.";
    var lang = (global.DreamintI18n && global.DreamintI18n.getLang) ? global.DreamintI18n.getLang() : "it";
    return new Error(lang === "en" ? en : it);
  }
  function loadError(file) {
    return isHeicFile(file) ? heicError() : new Error(
      (global.DreamintI18n && global.DreamintI18n.getLang && global.DreamintI18n.getLang() === "en")
        ? "Could not read the image. Use JPEG, PNG, or WebP."
        : "Impossibile leggere l'immagine. Usa JPEG, PNG o WebP."
    );
  }

  function readU16(view, offset, le) {
    return le ? view.getUint16(offset, true) : view.getUint16(offset, false);
  }
  function readU32(view, offset, le) {
    return le ? view.getUint32(offset, true) : view.getUint32(offset, false);
  }

  function probeJpeg(buf) {
    var view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return null;
    var offset = 2, orient = 1, w = 0, h = 0;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      var marker = view.getUint8(offset + 1);
      var size = view.getUint16(offset + 2, false);
      if (marker === 0xDA) break;
      if (marker === 0xE1 && size >= 8) {
        var start = offset + 4;
        if (start + 6 <= view.byteLength) {
          var isExif = view.getUint8(start) === 0x45 && view.getUint8(start + 1) === 0x78 && view.getUint8(start + 2) === 0x69 && view.getUint8(start + 3) === 0x66;
          if (isExif) {
            var tiff = start + 6;
            if (tiff + 8 <= view.byteLength) {
              var le = view.getUint16(tiff, false) === 0x4949;
              var ifd = tiff + readU32(view, tiff + 4, le);
              if (ifd + 2 <= view.byteLength) {
                var n = readU16(view, ifd, le);
                var i, entry, tag;
                for (i = 0; i < n; i++) {
                  entry = ifd + 2 + i * 12;
                  if (entry + 12 > view.byteLength) break;
                  tag = readU16(view, entry, le);
                  if (tag === 0x0112) {
                    orient = readU16(view, entry + 8, le) || 1;
                    break;
                  }
                }
              }
            }
          }
        }
      }
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        if (offset + 9 <= view.byteLength) {
          h = view.getUint16(offset + 5, false);
          w = view.getUint16(offset + 7, false);
        }
      }
      offset += 2 + size;
    }
    if (!w || !h) return null;
    return { w: w, h: h, orient: orient };
  }

  function probeFile(file) {
    if (!file || !file.slice) return Promise.resolve(null);
    var typ = String(file.type || "").toLowerCase();
    var name = String(file.name || "").toLowerCase();
    var isJpeg = typ === "image/jpeg" || typ === "image/jpg" || /\.jpe?g$/.test(name);
    if (!isJpeg) return Promise.resolve(null);
    var head = file.slice(0, Math.min(file.size || 0, 131072));
    return head.arrayBuffer().then(function (buf) {
      try { return probeJpeg(buf); } catch (e) { return null; }
    }).catch(function () { return null; });
  }

  function orientedSize(w, h, orient) {
    if (orient >= 5 && orient <= 8) return { w: h, h: w };
    return { w: w, h: h };
  }

  function applyExifToCtx(ctx, w, h, orient) {
    switch (orient) {
      case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
      case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
      case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
      case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
      case 6: ctx.translate(h, 0); ctx.rotate(0.5 * Math.PI); break;
      case 7: ctx.translate(h, w); ctx.rotate(0.5 * Math.PI); ctx.scale(-1, 1); break;
      case 8: ctx.translate(0, w); ctx.rotate(-0.5 * Math.PI); break;
      default: break;
    }
  }

  function downscaleCanvas(src, alreadyOriented, orient, rawSize) {
    var iw = src.naturalWidth || src.width;
    var ih = src.naturalHeight || src.height;
    var o = alreadyOriented ? { w: iw, h: ih } : orientedSize(iw, ih, orient || 1);
    if (!alreadyOriented && rawSize && rawSize.w && iw === rawSize.w && ih === rawSize.h && (orient || 1) !== 1) {
      o = orientedSize(iw, ih, orient);
    } else if (!alreadyOriented && rawSize && rawSize.w) {
      var expect = orientedSize(rawSize.w, rawSize.h, orient || 1);
      if (iw === expect.w && ih === expect.h) {
        alreadyOriented = true;
        o = { w: iw, h: ih };
        orient = 1;
      }
    } else if (!alreadyOriented && !rawSize) {
      alreadyOriented = true;
      o = { w: iw, h: ih };
      orient = 1;
    }
    var scale = Math.min(1, MAX_SIDE / Math.max(o.w, o.h));
    var cw = Math.max(1, Math.round(o.w * scale));
    var ch = Math.max(1, Math.round(o.h * scale));
    var c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#F5F1E8";
    ctx.fillRect(0, 0, cw, ch);
    if (!alreadyOriented && (orient || 1) !== 1) {
      ctx.save();
      var sw = Math.round(iw * scale);
      var sh = Math.round(ih * scale);
      applyExifToCtx(ctx, sw, sh, orient);
      ctx.drawImage(src, 0, 0, iw, ih, 0, 0, sw, sh);
      ctx.restore();
    } else {
      ctx.drawImage(src, 0, 0, iw, ih, 0, 0, cw, ch);
    }
    c.__sourceW = rawSize && rawSize.w ? (orientedSize(rawSize.w, rawSize.h, rawSize.orient || orient || 1).w) : o.w;
    c.__sourceH = rawSize && rawSize.h ? (orientedSize(rawSize.w, rawSize.h, rawSize.orient || orient || 1).h) : o.h;
    if (src.close) { try { src.close(); } catch (e) {} }
    return c;
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(loadError(file));
      };
      img.src = url;
    });
  }

  function loadFile(file) {
    if (!file) return Promise.reject(new Error("Nessun file"));
    return Promise.all([probeFile(file), detectOrientationSupport()]).then(function (r) {
      var meta = r[0], support = r[1];
      var bitmapOpts = { imageOrientation: "from-image" };
      if (meta && meta.w && meta.h && support.bitmap !== false) {
        var o = orientedSize(meta.w, meta.h, meta.orient || 1);
        var scale = Math.min(1, MAX_SIDE / Math.max(o.w, o.h));
        if (scale < 1) {
          bitmapOpts.resizeWidth = Math.max(1, Math.round(o.w * scale));
          bitmapOpts.resizeHeight = Math.max(1, Math.round(o.h * scale));
          bitmapOpts.resizeQuality = "high";
        }
      }
      function viaBitmap(opts, alreadyOriented) {
        return createImageBitmap(file, opts || {}).then(function (bmp) {
          return downscaleCanvas(bmp, alreadyOriented, (meta && meta.orient) || 1, meta);
        });
      }
      var chain;
      if (typeof createImageBitmap === "function" && support.bitmap !== null) {
        chain = viaBitmap(bitmapOpts, support.bitmap).catch(function () {
          return viaBitmap({ imageOrientation: "from-image" }, support.bitmap);
        });
      } else {
        chain = Promise.reject(new Error("no-bitmap"));
      }
      return chain.catch(function () {
        return loadViaImage(file).then(function (img) {
          var c = downscaleCanvas(img, support.img === true, (meta && meta.orient) || 1, meta);
          img.src = "";
          return c;
        });
      }).catch(function (err) {
        if (err && err.message) throw err;
        throw loadError(file);
      });
    });
  }

  function exportCanvas(c, type, q) {
    if (type.indexOf("webp") !== -1 && !canEncodeWebp()) type = "image/jpeg";
    var data = c.toDataURL(type, q);
    if (type.indexOf("webp") !== -1 && data.indexOf("data:image/webp") !== 0) {
      data = c.toDataURL("image/jpeg", q);
    }
    return data;
  }

  function shrinkIfNeeded(data) {
    return data.length > MAX_DATA_CHARS ? null : data;
  }

  function rotatedCanvas(img, rotate90, angle, target) {
    var rad90 = ((rotate90 || 0) % 360) * Math.PI / 180;
    var swap = Math.abs(Math.cos(rad90)) < 0.5;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var fine = (angle || 0) * Math.PI / 180;
    var mid = target || document.createElement("canvas");
    var mw = swap ? ih : iw;
    var mh = swap ? iw : ih;
    var pad = (angle ? 0.12 : 0);
    mid.width = Math.round(mw * (1 + pad));
    mid.height = Math.round(mh * (1 + pad));
    var ctx = mid.getContext("2d", { alpha: false });
    ctx.fillStyle = "#F5F1E8";
    ctx.fillRect(0, 0, mid.width, mid.height);
    ctx.translate(mid.width / 2, mid.height / 2);
    ctx.rotate(rad90 + fine);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    return mid;
  }

  function cropAndScale(mid, crop) {
    var sx = 0, sy = 0, sw = mid.width, sh = mid.height;
    if (crop && crop.sw > 0 && crop.sh > 0) {
      sx = Math.max(0, Math.round(crop.sx));
      sy = Math.max(0, Math.round(crop.sy));
      sw = Math.min(mid.width - sx, Math.round(crop.sw));
      sh = Math.min(mid.height - sy, Math.round(crop.sh));
    }
    var out = document.createElement("canvas");
    var scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    var octx = out.getContext("2d", { alpha: false });
    octx.fillStyle = "#F5F1E8";
    octx.fillRect(0, 0, out.width, out.height);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(mid, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  function detectCrop(img, rotate90, angle) {
    var tmp = rotatedCanvas(img, rotate90, angle);
    var maxA = 360;
    var scale = Math.min(1, maxA / tmp.width, maxA / tmp.height);
    var an = analysisCanvas(Math.max(1, Math.round(tmp.width * scale)), Math.max(1, Math.round(tmp.height * scale)));
    var ac = an.canvas;
    var ctx = an.ctx;
    ctx.drawImage(tmp, 0, 0, ac.width, ac.height);
    var pix = ctx.getImageData(0, 0, ac.width, ac.height).data;
    var acW = ac.width, acH = ac.height;
    releaseCanvas(ac);
    ac = { width: acW, height: acH };
    function sample(x0, y0, s) {
      var r = 0, g = 0, b = 0, n = 0, x, y, i;
      for (y = y0; y < y0 + s; y++) {
        for (x = x0; x < x0 + s; x++) {
          i = (y * ac.width + x) * 4;
          r += pix[i]; g += pix[i + 1]; b += pix[i + 2]; n++;
        }
      }
      return { r: r / n, g: g / n, b: b / n };
    }
    var s = Math.max(2, Math.round(Math.min(ac.width, ac.height) * 0.04));
    var c1 = sample(0, 0, s), c2 = sample(ac.width - s, 0, s);
    var c3 = sample(0, ac.height - s, s), c4 = sample(ac.width - s, ac.height - s, s);
    var bg = { r: (c1.r + c2.r + c3.r + c4.r) / 4, g: (c1.g + c2.g + c3.g + c4.g) / 4, b: (c1.b + c2.b + c3.b + c4.b) / 4 };
    var minX = ac.width, minY = ac.height, maxX = 0, maxY = 0, count = 0, x, y, i, d;
    for (y = 0; y < ac.height; y++) {
      for (x = 0; x < ac.width; x++) {
        i = (y * ac.width + x) * 4;
        d = Math.abs(pix[i] - bg.r) + Math.abs(pix[i + 1] - bg.g) + Math.abs(pix[i + 2] - bg.b);
        if (d > 52) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    var area = ac.width * ac.height;
    if (count < area * 0.015 || maxX <= minX || maxY <= minY) {
      return { sx: 0, sy: 0, sw: tmp.width, sh: tmp.height, failed: true, tmp: tmp };
    }
    var padX = Math.max(4, (maxX - minX) * 0.03);
    var padY = Math.max(4, (maxY - minY) * 0.03);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(ac.width, maxX + padX);
    maxY = Math.min(ac.height, maxY + padY);
    var inv = 1 / scale;
    return {
      sx: minX * inv,
      sy: minY * inv,
      sw: (maxX - minX) * inv,
      sh: (maxY - minY) * inv,
      failed: false,
      tmp: tmp
    };
  }

  function bestAngle(img, rotate90) {
    var best = 0, bestArea = Infinity, a, crop, area;
    for (a = -6; a <= 6; a += 2) {
      crop = detectCrop(img, rotate90, a);
      releaseCanvas(crop.tmp);
      area = crop.sw * crop.sh;
      if (area < bestArea) { bestArea = area; best = a; }
    }
    return best;
  }

  function blurScore(canvas) {
    var maxA = 160;
    var scale = Math.min(1, maxA / canvas.width, maxA / canvas.height);
    var an = analysisCanvas(Math.max(2, Math.round(canvas.width * scale)), Math.max(2, Math.round(canvas.height * scale)));
    var ac = an.canvas;
    var ctx = an.ctx;
    ctx.drawImage(canvas, 0, 0, ac.width, ac.height);
    var pix = ctx.getImageData(0, 0, ac.width, ac.height).data;
    ac = { width: ac.width, height: ac.height };
    releaseCanvas(an.canvas);
    var sum = 0, sum2 = 0, n = 0, x, y, i, v, lap, l, r, u, d;
    function gray(x0, y0) {
      var j = (y0 * ac.width + x0) * 4;
      return pix[j] * 0.3 + pix[j + 1] * 0.59 + pix[j + 2] * 0.11;
    }
    for (y = 1; y < ac.height - 1; y += 2) {
      for (x = 1; x < ac.width - 1; x += 2) {
        v = gray(x, y);
        l = gray(x - 1, y); r = gray(x + 1, y);
        u = gray(x, y - 1); d = gray(x, y + 1);
        lap = 4 * v - l - r - u - d;
        sum += lap; sum2 += lap * lap; n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return sum2 / n - mean * mean;
  }

  function sourceDims(img) {
    return {
      w: img && (img.__sourceW || img.naturalWidth || img.width) || 0,
      h: img && (img.__sourceH || img.naturalHeight || img.height) || 0
    };
  }

  function process(source, opts) {
    opts = opts || {};
    var ready;
    if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement || (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)) {
      ready = Promise.resolve(source);
    } else {
      ready = loadFile(source);
    }
    return ready.then(function (img) {
      var rotate90 = opts.rotate90 || 0;
      var angle = opts.angle;
      var crop = opts.crop || null;
      if (!crop) {
        if (opts.autoCrop && (angle == null || angle === 0) && opts.straighten !== false) {
          angle = bestAngle(img, rotate90);
        }
        angle = angle || 0;
        if (opts.autoCrop) {
          var found = detectCrop(img, rotate90, angle);
          releaseCanvas(found.tmp);
          found.tmp = null;
          if (!found.failed) crop = found;
        }
      } else {
        angle = angle || 0;
      }
      var mid = rotatedCanvas(img, rotate90, angle);
      var canvas = cropAndScale(mid, crop);
      releaseCanvas(mid);
      var warnings = [];
      var nat = sourceDims(img);
      if (Math.max(nat.w, nat.h) < 1000 || Math.min(nat.w, nat.h) < 750) {
        warnings.push("Risoluzione bassa: meglio almeno 1600px sul lato lungo, come su eBay e TCGplayer.");
      }
      if (blurScore(canvas) < 90) {
        warnings.push("La foto sembra sfocata. Scatta di nuovo, con più luce e senza flash.");
      }
      var original = exportCanvas(canvas, "image/jpeg", HD_QUALITY);
      var q = HD_QUALITY;
      while (original.length > MAX_DATA_CHARS && q > 0.6) {
        q -= 0.06;
        original = exportCanvas(canvas, "image/jpeg", q);
      }
      var variants = {};
      VARIANT_WIDTHS.forEach(function (w) {
        if (canvas.width < w * 0.85 && w !== 112) return;
        var vc = document.createElement("canvas");
        var ratio = w / canvas.width;
        vc.width = w;
        vc.height = Math.max(1, Math.round(canvas.height * ratio));
        vc.getContext("2d").drawImage(canvas, 0, 0, vc.width, vc.height);
        variants[String(w)] = exportCanvas(vc, "image/webp", VARIANT_QUALITY);
        releaseCanvas(vc);
      });
      var outW = canvas.width, outH = canvas.height;
      releaseCanvas(canvas);
      return {
        original: original,
        variants: variants,
        warnings: warnings,
        width: outW,
        height: outH,
        preview: original,
        angle: angle
      };
    });
  }

  function url(cardId, kind, w) {
    return "/api/cards/" + cardId + "/photo/" + kind + (w ? ("?w=" + w) : "");
  }
  function srcset(cardId, kind) {
    return VARIANT_WIDTHS.map(function (w) { return url(cardId, kind, w) + " " + w + "w"; }).join(", ");
  }

  function fallback(img) {
    if (!img) return false;
    if (img.getAttribute("data-orig-fallback") === "1") {
      var done = img.closest && img.closest(".product-thumb");
      if (done) done.hidden = true;
      return false;
    }
    img.setAttribute("data-orig-fallback", "1");
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    var current = img.getAttribute("src") || "";
    var next = current.replace(/[?&]w=\d+/, "").replace(/[?&]$/, "");
    if (!next && img.src) next = img.src.replace(/[?&]w=\d+/, "").replace(/[?&]$/, "");
    if (next && next !== current) {
      img.src = next;
      return true;
    }
    var thumb = img.closest && img.closest(".product-thumb");
    if (thumb) thumb.hidden = true;
    return false;
  }

  var CARD_RATIO = 63 / 88;
  var SLAB_RATIO = 3.25 / 5.375;

  function ratioValue(name) {
    if (name === "slab") return SLAB_RATIO;
    if (name === "free") return 0;
    return CARD_RATIO;
  }

  function fitRatioAround(box, midW, midH, ratio) {
    var sx = box.sx, sy = box.sy, sw = box.sw, sh = box.sh;
    if (!ratio || ratio <= 0) {
      return {
        sx: Math.max(0, sx), sy: Math.max(0, sy),
        sw: Math.min(midW, sw), sh: Math.min(midH, sh)
      };
    }
    if (sw / sh > ratio) {
      var newH = sw / ratio;
      sy -= (newH - sh) / 2;
      sh = newH;
    } else {
      var newW = sh * ratio;
      sx -= (newW - sw) / 2;
      sw = newW;
    }
    if (sw > midW) { sw = midW; sh = sw / ratio; }
    if (sh > midH) { sh = midH; sw = sh * ratio; }
    if (sw > midW) { sw = midW; sh = Math.min(midH, sw / ratio); }
    sx = Math.min(Math.max(0, sx), Math.max(0, midW - sw));
    sy = Math.min(Math.max(0, sy), Math.max(0, midH - sh));
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  function suggestCrop(img, rotate90, angle, ratioName) {
    var found = detectCrop(img, rotate90, angle);
    var midW = found.tmp.width, midH = found.tmp.height;
    releaseCanvas(found.tmp);
    found.tmp = null;
    var box = found.failed ? { sx: 0, sy: 0, sw: midW, sh: midH } : found;
    var ratio = ratioValue(ratioName);
    var crop = fitRatioAround(box, midW, midH, ratio);
    crop.midW = midW;
    crop.midH = midH;
    crop.failed = !!found.failed;
    return crop;
  }

  function midSize(img, rotate90, angle) {
    var rad90 = ((rotate90 || 0) % 360) * Math.PI / 180;
    var swap = Math.abs(Math.cos(rad90)) < 0.5;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var pad = (angle ? 0.12 : 0);
    return { width: Math.round((swap ? ih : iw) * (1 + pad)), height: Math.round((swap ? iw : ih) * (1 + pad)) };
  }

  function makePreview(img) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var sc = Math.min(1, PREVIEW_SIDE / Math.max(iw, ih));
    if (sc >= 1) return { src: img, own: false };
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * sc));
    c.height = Math.max(1, Math.round(ih * sc));
    var g = c.getContext("2d", { alpha: false });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, c.width, c.height);
    return { src: c, own: true };
  }

  function createCropper(stage, opts) {
    opts = opts || {};
    stage.style.touchAction = "none";
    var live = stage.querySelector("canvas.crop-live");
    if (!live) {
      live = document.createElement("canvas");
      live.className = "crop-live";
      live.setAttribute("aria-hidden", "true");
      stage.insertBefore(live, stage.firstChild);
    }
    var canvas = stage.querySelector("canvas.crop-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "crop-canvas";
      stage.appendChild(canvas);
    }
    var ctx = canvas.getContext("2d");
    live.style.willChange = "auto";
    var preview = opts.image ? makePreview(opts.image) : { src: null, own: false };
    var liveScale = 1;
    var size = null;
    var canvasBox = null;
    var state = {
      img: opts.image,
      rotate90: opts.rotate90 || 0,
      angle: opts.angle || 0,
      ratioName: opts.ratioName || "card",
      sx: 0, sy: 0, sw: 1, sh: 1,
      mid: null,
      destroyed: false
    };
    var pointers = {};
    var pinch = null;
    var onChange = opts.onChange || function () {};
    var changeTimer = 0;
    var raf = 0;
    var needPaint = false;
    var gesturing = false;

    function ratio() { return ratioValue(state.ratioName); }

    function notify() {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(function () { if (!state.destroyed) onChange(); }, 160);
    }

    function rebuildMid() {
      if (!state.img) return;
      state.mid = midSize(state.img, state.rotate90, state.angle);
      rotatedCanvas(preview.src, state.rotate90, state.angle, live);
      liveScale = state.mid.width / Math.max(1, live.width);
    }

    function maxCrop() {
      var midW = state.mid.width, midH = state.mid.height;
      var r = ratio();
      if (!r) return { sw: midW, sh: midH };
      var sw = midW, sh = midH;
      if (sw / sh > r) sw = sh * r;
      else sh = sw / r;
      return { sw: sw, sh: sh };
    }

    function clamp() {
      var midW = state.mid.width, midH = state.mid.height;
      var r = ratio();
      var max = maxCrop();
      if (state.sw > max.sw) state.sw = max.sw;
      if (state.sh > max.sh) state.sh = max.sh;
      if (r) {
        if (state.sw / state.sh !== r) state.sh = state.sw / r;
        if (state.sh > midH) { state.sh = midH; state.sw = state.sh * r; }
        if (state.sw > midW) { state.sw = midW; state.sh = state.sw / r; }
      } else {
        if (state.sw > midW) state.sw = midW;
        if (state.sh > midH) state.sh = midH;
      }
      var minSide = 32;
      if (r) {
        if (state.sw < minSide) { state.sw = minSide; state.sh = state.sw / r; }
      } else {
        if (state.sw < minSide) state.sw = minSide;
        if (state.sh < minSide) state.sh = minSide;
      }
      state.sx = Math.min(Math.max(0, state.sx), Math.max(0, midW - state.sw));
      state.sy = Math.min(Math.max(0, state.sy), Math.max(0, midH - state.sh));
    }

    function measure() {
      var r = stage.getBoundingClientRect();
      size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      canvasBox = canvas.getBoundingClientRect();
      return size;
    }
    function cssSize() {
      return size || measure();
    }

    function frameRect() {
      var sz = cssSize();
      var pad = 18;
      var maxW = sz.w - pad * 2;
      var maxH = sz.h - pad * 2;
      var r = ratio() || (state.sw / state.sh);
      var fw, fh;
      if (maxW / maxH > r) { fh = maxH; fw = fh * r; }
      else { fw = maxW; fh = fw / r; }
      return { x: (sz.w - fw) / 2, y: (sz.h - fh) / 2, w: fw, h: fh };
    }

    function applyLiveTransform() {
      if (!state.mid) return;
      var fr = frameRect();
      var sc = fr.w / state.sw;
      live.style.transform = "translate3d(" + (fr.x - state.sx * sc) + "px," + (fr.y - state.sy * sc) + "px,0) scale(" + (sc * liveScale) + ")";
    }

    function drawOverlay() {
      if (state.destroyed || !state.mid) return;
      var sz = cssSize();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var bw = Math.round(sz.w * dpr), bh = Math.round(sz.h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sz.w, sz.h);
      var fr = frameRect();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, sz.w, sz.h);
      ctx.rect(fr.x, fr.y, fr.w, fr.h);
      ctx.fillStyle = "rgba(12, 10, 8, 0.58)";
      ctx.fill("evenodd");
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(fr.x, fr.y, fr.w, fr.h);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fr.x + fr.w / 3, fr.y); ctx.lineTo(fr.x + fr.w / 3, fr.y + fr.h);
      ctx.moveTo(fr.x + 2 * fr.w / 3, fr.y); ctx.lineTo(fr.x + 2 * fr.w / 3, fr.y + fr.h);
      ctx.moveTo(fr.x, fr.y + fr.h / 3); ctx.lineTo(fr.x + fr.w, fr.y + fr.h / 3);
      ctx.moveTo(fr.x, fr.y + 2 * fr.h / 3); ctx.lineTo(fr.x + fr.w, fr.y + 2 * fr.h / 3);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "rgba(232, 214, 164, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fr.x + 0.75, fr.y + 0.75, fr.w - 1.5, fr.h - 1.5);
      var arm = Math.max(16, Math.min(fr.w, fr.h) * 0.12);
      ctx.strokeStyle = "#F3E2B0";
      ctx.lineWidth = 3;
      ctx.lineCap = "square";
      function corner(x, y, dx, dy) {
        ctx.beginPath();
        ctx.moveTo(x + dx * arm, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * arm);
        ctx.stroke();
      }
      corner(fr.x, fr.y, 1, 1);
      corner(fr.x + fr.w, fr.y, -1, 1);
      corner(fr.x, fr.y + fr.h, 1, -1);
      corner(fr.x + fr.w, fr.y + fr.h, -1, -1);
    }

    function draw() {
      if (state.destroyed || !state.mid) return;
      applyLiveTransform();
      drawOverlay();
    }

    function schedule(overlayToo) {
      if (overlayToo) needPaint = true;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (state.destroyed) return;
        applyLiveTransform();
        if (needPaint || !gesturing) {
          needPaint = false;
          drawOverlay();
        }
      });
    }

    function applySuggested() {
      var s = suggestCrop(preview.src, state.rotate90, state.angle, state.ratioName);
      var fx = state.mid.width / Math.max(1, s.midW), fy = state.mid.height / Math.max(1, s.midH);
      state.sx = s.sx * fx; state.sy = s.sy * fy; state.sw = s.sw * fx; state.sh = s.sh * fy;
      clamp();
      draw();
    }

    function clientToLocal(e) {
      measure();
      return { x: e.clientX - canvasBox.left, y: e.clientY - canvasBox.top };
    }

    function panBy(dx, dy) {
      var fr = frameRect();
      var sc = fr.w / state.sw;
      state.sx -= dx / sc;
      state.sy -= dy / sc;
      clamp();
      schedule(false);
    }

    function zoomBy(factor, px, py) {
      var fr = frameRect();
      var sc = fr.w / state.sw;
      var ix = state.sx + (px - fr.x) / sc;
      var iy = state.sy + (py - fr.y) / sc;
      var z = getZoom() * factor;
      setZoom(z, true);
      var sc2 = fr.w / state.sw;
      state.sx = ix - (px - fr.x) / sc2;
      state.sy = iy - (py - fr.y) / sc2;
      clamp();
      schedule(false);
    }

    function getZoom() {
      var max = maxCrop();
      return max.sw / state.sw;
    }

    function setZoom(z, skipDraw) {
      var max = maxCrop();
      z = Math.max(1, Math.min(4, z || 1));
      var cx = state.sx + state.sw / 2;
      var cy = state.sy + state.sh / 2;
      state.sw = max.sw / z;
      state.sh = ratio() ? state.sw / ratio() : max.sh / z;
      state.sx = cx - state.sw / 2;
      state.sy = cy - state.sh / 2;
      clamp();
      if (!skipDraw) { schedule(true); }
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      if (!gesturing) {
        measure();
        live.style.willChange = "transform";
      }
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      gesturing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      }
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!pointers[e.pointerId]) return;
      var ids = Object.keys(pointers);
      if (ids.length >= 2 && pinch) {
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0 && dist > 0) {
          var midp = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          var box = canvasBox || measure() && canvasBox;
          zoomBy(dist / pinch.dist, midp.x - box.left, midp.y - box.top);
          pinch.dist = dist;
        }
      } else {
        var prev = pointers[e.pointerId];
        var dx = e.clientX - prev.x;
        var dy = e.clientY - prev.y;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (dx || dy) panBy(dx, dy);
      }
      e.preventDefault();
    }
    function onPointerUp(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length && gesturing) {
        gesturing = false;
        live.style.willChange = "auto";
        schedule(true);
        notify();
      }
    }
    function onWheel(e) {
      e.preventDefault();
      var local = clientToLocal(e);
      var factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomBy(factor, local.x, local.y);
      notify();
    }
    function onTouchGuard(e) { e.preventDefault(); }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("touchstart", onTouchGuard, { passive: false });
    stage.addEventListener("touchmove", onTouchGuard, { passive: false });
    stage.addEventListener("gesturestart", onTouchGuard, { passive: false });
    stage.addEventListener("gesturechange", onTouchGuard, { passive: false });

    var ro = null;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(function () { if (!state.destroyed) { measure(); draw(); } });
      ro.observe(stage);
    }
    var onWin = function () { if (!state.destroyed) { measure(); draw(); } };
    window.addEventListener("resize", onWin);

    rebuildMid();
    if (opts.crop) {
      state.sx = opts.crop.sx; state.sy = opts.crop.sy;
      state.sw = opts.crop.sw; state.sh = opts.crop.sh;
      clamp();
      draw();
    } else {
      applySuggested();
    }
    requestAnimationFrame(function () { if (!state.destroyed) { measure(); draw(); } });

    return {
      draw: draw,
      getCrop: function () { return { sx: state.sx, sy: state.sy, sw: state.sw, sh: state.sh }; },
      getZoom: getZoom,
      setZoom: function (z) { setZoom(z); notify(); },
      getRatioName: function () { return state.ratioName; },
      setRatioName: function (name, refit) {
        state.ratioName = name || "card";
        if (refit !== false) applySuggested();
        else { clamp(); draw(); }
        notify();
      },
      setOrientation: function (rotate90, angle, refit) {
        state.rotate90 = rotate90 || 0;
        state.angle = angle || 0;
        rebuildMid();
        if (refit !== false) applySuggested();
        else { clamp(); draw(); }
        notify();
      },
      reset: function () {
        state.angle = 0;
        rebuildMid();
        applySuggested();
        notify();
      },
      refit: function () { applySuggested(); notify(); },
      destroy: function () {
        state.destroyed = true;
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        stage.removeEventListener("touchstart", onTouchGuard);
        stage.removeEventListener("touchmove", onTouchGuard);
        stage.removeEventListener("gesturestart", onTouchGuard);
        stage.removeEventListener("gesturechange", onTouchGuard);
        window.removeEventListener("resize", onWin);
        if (ro) ro.disconnect();
        clearTimeout(changeTimer);
        if (raf) cancelAnimationFrame(raf);
        if (preview.own) releaseCanvas(preview.src);
        preview = { src: null, own: false };
        releaseCanvas(live);
      }
    };
  }

  global.GemintPhotos = {
    VARIANT_WIDTHS: VARIANT_WIDTHS,
    MAX_SIDE: MAX_SIDE,
    CARD_RATIO: CARD_RATIO,
    SLAB_RATIO: SLAB_RATIO,
    process: process,
    loadFile: loadFile,
    url: url,
    srcset: srcset,
    fallback: fallback,
    isHeicFile: isHeicFile,
    suggestCrop: suggestCrop,
    createCropper: createCropper
  };
})(window);
