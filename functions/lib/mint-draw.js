// Digital-copy draws for verified graded cards.
// - Serial: random integer 1..SERIAL_MAX from crypto.getRandomValues (not registration order),
//   unique per card model (UNIQUE index idx_slabs_model_serial + existence check + retry).
// - Rarity: independent of the serial, from the commit-reveal digest of a server seed that is
//   itself generated with crypto.getRandomValues at submission; exact integer buckets on 10000.

export const SERIAL_MAX = 9999;
export const SERIAL_MAX_ATTEMPTS = 10;

// Buckets on 10000: Mitica 10 (0,1%), Leggendaria 190 (1,9%), Epica 800 (8%), Rara 2000 (20%), Comune 7000 (70%).
export const TIER_BUCKETS = [
  ["mitica", 10],
  ["leggendaria", 200],
  ["epica", 1000],
  ["rara", 3000],
  ["comune", 10000]
];

export function tierFromBucket(n) {
  for (const [tier, upTo] of TIER_BUCKETS) if (n < upTo) return tier;
  return "comune";
}

// roll in [0,1) (as stored/shown for verification) -> exact integer bucket 0..9999.
export function tierFromRollExact(roll) {
  const n = Math.min(9999, Math.max(0, Math.floor(Number(roll) * 10000)));
  return tierFromBucket(n);
}

// Uniform integer in [1, max] with rejection sampling (no modulo bias).
export function randomSerial(max = SERIAL_MAX, rng) {
  const getU32 = rng || (() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const x = getU32() >>> 0;
    if (x < limit) return (x % max) + 1;
  }
}

// tryWrite(serial) must resolve true when the serial was stored, false on a collision.
export async function drawUniqueSerial(tryWrite, opts) {
  const o = opts || {};
  const attempts = o.attempts || SERIAL_MAX_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    const s = randomSerial(o.max || SERIAL_MAX, o.rng);
    if (await tryWrite(s)) return s;
  }
  throw Object.assign(new Error("Impossibile assegnare un seriale unico, riprova"), { status: 503 });
}

export function isUniqueViolation(e) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((e && e.message) || e));
}

// Denominator shown next to the serial: random serials are "out of SERIAL_MAX";
// legacy sequential serials keep the registered count.
export function serialTotalFor(slab) {
  if (!slab || slab.serial_number == null) return null;
  if (Number(slab.serial_total_at_assignment) === SERIAL_MAX) return SERIAL_MAX;
  return slab.registered_count || slab.serial_total_at_assignment || slab.serial_number || null;
}
