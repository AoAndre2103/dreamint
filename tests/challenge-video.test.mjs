import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateChallengeVideo, sniffVideo, parseMp4, parseWebm, videoResponse, VIDEO_MAX_BYTES } from "../functions/lib/challenge-video.js";
const fx = (n) => new Uint8Array(fs.readFileSync(new URL("./fixtures-video/" + n, import.meta.url)));
test("accepts MP4 (H.264+AAC, moov at end and faststart), iPhone-style MOV HEVC, WebM VP8+Opus", () => {
  for (const [n, mime] of [["ok-h264.mp4", "video/mp4"], ["ok-faststart.mp4", "video/mp4"], ["ok-hevc-iphone.mov", "video/quicktime"], ["ok-vp8.webm", "video/webm"], ["ok-live.webm", "video/webm"]]) {
    const r = validateChallengeVideo(fx(n));
    assert.equal(r.ok, true, n + " " + JSON.stringify(r));
    assert.equal(r.mime, mime, n);
  }
  assert.ok(Math.abs(validateChallengeVideo(fx("ok-h264.mp4")).durationMs - 5000) < 200);
});
test("rejects no audio, too long, too short", () => {
  assert.equal(validateChallengeVideo(fx("noaudio.mp4")).code, "video_no_audio");
  assert.equal(validateChallengeVideo(fx("noaudio.webm")).code, "video_no_audio");
  assert.equal(validateChallengeVideo(fx("toolong.mp4")).code, "video_too_long");
  assert.equal(validateChallengeVideo(fx("short.mp4")).code, "video_too_short");
});
test("rejects non-video: HEIC image, JPEG, SVG/HTML, truncated MP4, too large", () => {
  const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic"), 0, 0, 0, 0]);
  assert.equal(sniffVideo(heic), null);
  assert.equal(validateChallengeVideo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])).code, "video_invalid");
  assert.equal(validateChallengeVideo(new TextEncoder().encode("<svg onload=alert(1)>" + " ".repeat(40))).code, "video_invalid");
  const mp4 = fx("ok-faststart.mp4");
  assert.equal(validateChallengeVideo(mp4.subarray(0, 40)).code, "video_invalid");
  const big = new Uint8Array(VIDEO_MAX_BYTES + 1); big.set(mp4.subarray(0, 32));
  assert.equal(validateChallengeVideo(big).code, "video_too_large");
});
test("live WebM (MediaRecorder style, unknown sizes) is parsed", () => {
  const i = parseWebm(fx("ok-live.webm"));
  assert.equal(i.hasAudio && i.hasVideo, true);
});
test("range responses for Safari", async () => {
  const bin = fx("ok-h264.mp4").buffer;
  const req = (r) => new Request("https://x/v", { headers: r ? { range: r } : {} });
  const full = videoResponse(bin, "video/mp4", "mp4", req());
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.match(full.headers.get("content-disposition"), /^inline; filename="video-sfida\.mp4"$/);
  const p = videoResponse(bin, "video/mp4", "mp4", req("bytes=0-1"));
  assert.equal(p.status, 206); assert.equal(p.headers.get("content-range"), "bytes 0-1/" + bin.byteLength);
  assert.equal((await p.arrayBuffer()).byteLength, 2);
  assert.equal(videoResponse(bin, "video/mp4", "mp4", req("bytes=999999999-")).status, 416);
});
