import test from "node:test";
import assert from "node:assert/strict";
import { randomSerial, drawUniqueSerial, tierFromBucket, tierFromRollExact, SERIAL_MAX, serialTotalFor } from "../functions/lib/mint-draw.js";

test("tier buckets are exact on 10000", () => {
  const c = {};
  for (let n = 0; n < 10000; n++) { const t = tierFromBucket(n); c[t] = (c[t] || 0) + 1; }
  assert.deepEqual(c, { mitica: 10, leggendaria: 190, epica: 800, rara: 2000, comune: 7000 });
  assert.equal(tierFromRollExact(0), "mitica");
  assert.equal(tierFromRollExact(0.0009999), "mitica");
  assert.equal(tierFromRollExact(0.001), "leggendaria");
  assert.equal(tierFromRollExact(0.0199999), "leggendaria");
  assert.equal(tierFromRollExact(0.02), "epica");
  assert.equal(tierFromRollExact(0.1), "rara");
  assert.equal(tierFromRollExact(0.3), "comune");
  assert.equal(tierFromRollExact(0.999999), "comune");
});

test("100k rarity draws from crypto digests match 70/20/8/1.9/0.1", async () => {
  const { webcrypto } = await import("node:crypto");
  const N = 100000; const c = { comune: 0, rara: 0, epica: 0, leggendaria: 0, mitica: 0 };
  for (let i = 0; i < N; i++) {
    const seed = webcrypto.getRandomValues(new Uint8Array(32));
    const d = new Uint8Array(await webcrypto.subtle.digest("SHA-256", seed));
    const hex = Buffer.from(d).toString("hex");
    const roll = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52); // same as rollFromDigest
    c[tierFromRollExact(roll)]++;
  }
  const pct = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (100 * v / N)]));
  console.log("distribution % (100k):", JSON.stringify(pct));
  assert.ok(Math.abs(pct.comune - 70) < 0.6);
  assert.ok(Math.abs(pct.rara - 20) < 0.5);
  assert.ok(Math.abs(pct.epica - 8) < 0.35);
  assert.ok(Math.abs(pct.leggendaria - 1.9) < 0.15);
  assert.ok(Math.abs(pct.mitica - 0.1) < 0.06);
});

test("random serial: range, uniform-ish, unique with retry (100k on a wide range)", async () => {
  const taken = new Set(); let collisions = 0;
  for (let i = 0; i < 100000; i++) {
    await drawUniqueSerial(async (s) => { if (taken.has(s)) { collisions++; return false; } taken.add(s); return true; }, { max: 1e9, attempts: 10 });
  }
  assert.equal(taken.size, 100000);
  for (let i = 0; i < 20000; i++) { const s = randomSerial(); assert.ok(s >= 1 && s <= SERIAL_MAX && Number.isInteger(s)); }
  console.log("serial collisions retried:", collisions);
});

test("serials are not in registration order", () => {
  const seq = Array.from({ length: 50 }, () => randomSerial());
  const ascending = seq.every((v, i) => i === 0 || v > seq[i - 1]);
  assert.equal(ascending, false);
});

test("simulated collisions: retries then succeeds; gives up after 10", async () => {
  let calls = 0;
  const s = await drawUniqueSerial(async () => (++calls) >= 4);
  assert.equal(calls, 4); assert.ok(s >= 1 && s <= SERIAL_MAX);
  calls = 0;
  await assert.rejects(drawUniqueSerial(async () => { calls++; return false; }), /seriale unico/);
  assert.equal(calls, 10);
  // forced RNG collision: first values map to the same serial
  const vals = [5, 5, 5, 6]; const used = new Set([6]);
  const got = await drawUniqueSerial(async (x) => { if (used.has(x)) return false; used.add(x); return true; }, { rng: () => vals.shift() ?? 7 });
  assert.equal(got, 7);
});

test("serial total: random -> SERIAL_MAX, legacy -> registered count", () => {
  assert.equal(serialTotalFor({ serial_number: 4821, serial_total_at_assignment: SERIAL_MAX, registered_count: 3 }), SERIAL_MAX);
  assert.equal(serialTotalFor({ serial_number: 2, serial_total_at_assignment: 2, registered_count: 5 }), 5);
  assert.equal(serialTotalFor({ serial_number: null }), null);
});
