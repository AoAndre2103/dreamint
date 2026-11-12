// Challenge video (M4 proof for graded cards): short clip where the user frames the slab and reads the
// server-issued code aloud. Container-level checks only (no decoding): magic bytes, duration, audio track.

export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;   // 20 MB (KV value limit is 25 MiB); ~5 s clip is usually 2-10 MB
export const VIDEO_MAX_MS = 10500;                 // max 10 s (+0.5 s tolerance)
export const VIDEO_MIN_MS = 2000;                  // at least 2 s
export const VIDEO_KV_PREFIX = "challengevideo:";

const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "MSNV", "3gp4", "3gp5", "3gp6", "3g2a", "dash", "qt  ", "hvc1", "hev1"]);
const IMAGE_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif", "avis"]);

const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Returns { container, mime, ext } or null.
export function sniffVideo(bytes) {
  const b = bytes;
  if (!b || b.length < 16) return null;
  if (str4(b, 4) === "ftyp") {
    const major = str4(b, 8);
    const size = Math.min(u32(b, 0), b.length);
    const brands = [major];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(str4(b, o));
    if (brands.some((x) => IMAGE_BRANDS.has(x)) && !brands.some((x) => MP4_BRANDS.has(x) && x !== "hvc1" && x !== "hev1")) return null;
    if (major === "qt  ") return { container: "mov", mime: "video/quicktime", ext: "mov" };
    if (brands.some((x) => MP4_BRANDS.has(x))) return { container: "mp4", mime: "video/mp4", ext: "mp4" };
    return null;
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = String.fromCharCode(...b.subarray(0, Math.min(64, b.length)));
    if (head.includes("webm")) return { container: "webm", mime: "video/webm", ext: "webm" };
    return null;
  }
  return null;
}

// ISO BMFF (MP4/MOV): walk boxes; mvhd -> duration, trak/mdia/hdlr -> 'soun' / 'vide'.
function boxes(b, start, end, cb) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o), type = str4(b, o + 4), hdr = 8;
    if (size === 1) { if (o + 16 > end) return; size = u32(b, o + 8) * 4294967296 + u32(b, o + 12); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) return;
    cb(type, o + hdr, o + size);
    o += size;
  }
}
export function parseMp4(b) {
  const info = { durationMs: null, hasAudio: false, hasVideo: false, parsed: false };
  boxes(b, 0, b.length, (type, s, e) => {
    if (type !== "moov") return;
    info.parsed = true;
    boxes(b, s, e, (t2, s2, e2) => {
      if (t2 === "mvhd") {
        const v = b[s2];
        const ts = v === 1 ? u32(b, s2 + 20) : u32(b, s2 + 12);
        const du = v === 1 ? u32(b, s2 + 24) * 4294967296 + u32(b, s2 + 28) : u32(b, s2 + 16);
        if (ts > 0) info.durationMs = Math.round((du / ts) * 1000);
      }
      if (t2 === "trak") boxes(b, s2, e2, (t3, s3, e3) => {
        if (t3 === "mdia") boxes(b, s3, e3, (t4, s4) => {
          if (t4 === "hdlr") {
            const h = str4(b, s4 + 8);
            if (h === "soun") info.hasAudio = true;
            if (h === "vide") info.hasVideo = true;
          }
        });
      });
    });
  });
  return info;
}

// WebM (EBML): Segment > Info (TimecodeScale, Duration) and Tracks > TrackEntry > TrackType (1 video, 2 audio).
function vint(b, o, keepMarker) {
  const first = b[o]; if (first === undefined) return null;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || o + len > b.length) return null;
  let val = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { val = val * 256 + b[o + i]; if (b[o + i] !== 0xff) allOnes = false; }
  return { val, len, unknown: !keepMarker && allOnes };
}
export function parseWebm(b) {
  const info = { durationMs: null, hasAudio: false, hasVideo: false, parsed: false };
  let scale = 1000000, rawDur = null;
  const walk = (start, end, depth) => {
    let o = start;
    while (o < end) {
      const id = vint(b, o, true); if (!id) return;
      const sz = vint(b, o + id.len, false); if (!sz) return;
      const ds = o + id.len + sz.len;
      const de = sz.unknown ? end : Math.min(end, ds + sz.val);
      const ID = id.val;
      if (ID === 0x18538067) { walk(ds, de, depth + 1); return; }          // Segment
      if (ID === 0x1f43b675) return;                                          // Cluster: media data starts
      if (ID === 0x1549a966 || ID === 0x1654ae6b || ID === 0xae) walk(ds, de, depth + 1); // Info, Tracks, TrackEntry
      if (ID === 0x1654ae6b) info.parsed = true;
      if (ID === 0x83) { const t = b[ds]; if (t === 1) info.hasVideo = true; if (t === 2) info.hasAudio = true; }
      if (ID === 0x2ad7b1) { let v = 0; for (let i = ds; i < de; i++) v = v * 256 + b[i]; scale = v; }
      if (ID === 0x4489) {
        const dv = new DataView(b.buffer, b.byteOffset + ds, de - ds);
        rawDur = (de - ds) === 8 ? dv.getFloat64(0) : (de - ds) === 4 ? dv.getFloat32(0) : null;
      }
      if (sz.unknown) return;
      o = de;
    }
  };
  walk(0, b.length, 0);
  if (rawDur != null && isFinite(rawDur)) info.durationMs = Math.round((rawDur * scale) / 1e6);
  return info;
}

// Full validation. Returns { ok:true, mime, ext, durationMs, size } or { ok:false, status, code, error }.
export function validateChallengeVideo(bytes) {
  const fail = (status, code, error) => ({ ok: false, status, code, error });
  if (!bytes || !bytes.length) return fail(400, "video_missing", "Video mancante");
  if (bytes.length > VIDEO_MAX_BYTES) return fail(413, "video_too_large", "Video troppo pesante (massimo 20 MB): registra circa 5 secondi");
  const kind = sniffVideo(bytes);
  if (!kind) return fail(415, "video_invalid", "Formato video non valido: usa MP4, MOV (iPhone) o WebM");
  const info = kind.container === "webm" ? parseWebm(bytes) : parseMp4(bytes);
  if (!info.parsed) return fail(415, "video_invalid", "Video illeggibile o incompleto: registralo di nuovo");
  if (!info.hasVideo) return fail(400, "video_invalid", "Il file non contiene una traccia video");
  if (!info.hasAudio) return fail(400, "video_no_audio", "Il video non ha l’audio: registralo di nuovo leggendo ad alta voce il codice");
  if (info.durationMs != null && info.durationMs > VIDEO_MAX_MS) return fail(400, "video_too_long", "Video troppo lungo: massimo 10 secondi (bastano 5)");
  if (info.durationMs != null && info.durationMs < VIDEO_MIN_MS) return fail(400, "video_too_short", "Video troppo corto: registra circa 5 secondi");
  return { ok: true, mime: kind.mime, ext: kind.ext, durationMs: info.durationMs, size: bytes.length };
}

// Byte-range response (Safari needs 206 to play <video>).
export function videoResponse(bin, mime, ext, request, extraHeaders) {
  const total = bin.byteLength;
  const headers = {
    "content-type": mime,
    "x-content-type-options": "nosniff",
    "content-disposition": 'inline; filename="video-sfida.' + ext + '"',
    "content-security-policy": "default-src 'none'; media-src 'self'; sandbox",
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
    "referrer-policy": "no-referrer",
    ...(extraHeaders || {})
  };
  const range = request.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start, end;
    if (m[1] === "") { start = Math.max(0, total - Number(m[2])); end = total - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1); }
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...headers, "content-range": "bytes */" + total } });
    return new Response(bin.slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) } });
  }
  return new Response(bin, { status: 200, headers: { ...headers, "content-length": String(total) } });
}
