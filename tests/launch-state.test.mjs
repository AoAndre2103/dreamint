import assert from "node:assert/strict";
import { presentLaunch, planTransition, allowedTransitions, CONFIRM_PHRASE } from "../functions/lib/launch-state.js";

const NOW = Date.parse("2026-11-12T15:00:00Z");
const DAY = 86400000;

// Default is BETA, no commissions, no countdown.
let v = presentLaunch(null, NOW, 15);
assert.equal(v.state, "BETA");
assert.equal(v.effective_state, "BETA");
assert.equal(v.remaining_ms, null);
assert.equal(v.commissions_active, false);

// Confirmation phrase required.
assert.throws(() => planTransition(null, "LAUNCH_PROMO", "", NOW, 15), /CONFERMO/);
// Cannot skip states.
assert.throws(() => planTransition(null, "MONETIZATION_ENABLED", CONFIRM_PHRASE, NOW, 15), /non consentito/);
assert.throws(() => planTransition(null, "BOGUS", CONFIRM_PHRASE, NOW, 15), /non valido/);
assert.throws(() => planTransition({ state: "BETA" }, "BETA", CONFIRM_PHRASE, NOW, 15), /già/);

// BETA -> LAUNCH_PROMO sets 15 days from server time.
const p = planTransition(null, "LAUNCH_PROMO", "confermo", NOW, 15);
assert.equal(p.from, "BETA");
assert.equal(p.rec.promo_start, new Date(NOW).toISOString());
assert.equal(Date.parse(p.rec.promo_end) - NOW, 15 * DAY);

v = presentLaunch(p.rec, NOW + 2 * DAY, 15);
assert.equal(v.effective_state, "LAUNCH_PROMO");
assert.equal(v.remaining_ms, 13 * DAY);
assert.equal(v.commissions_active, false);

// After the window the public view is PROMO_ENDED, still no commissions.
v = presentLaunch(p.rec, NOW + 16 * DAY, 15);
assert.equal(v.state, "LAUNCH_PROMO");
assert.equal(v.effective_state, "PROMO_ENDED");
assert.equal(v.remaining_ms, 0);
assert.equal(v.commissions_active, false);

// PROMO_ENDED -> MONETIZATION_ENABLED only explicitly.
const e = planTransition(p.rec, "PROMO_ENDED", CONFIRM_PHRASE, NOW + 16 * DAY, 15);
assert.equal(e.rec.state, "PROMO_ENDED");
assert.equal(presentLaunch(e.rec, NOW + 17 * DAY, 15).commissions_active, false);
const m = planTransition(e.rec, "MONETIZATION_ENABLED", CONFIRM_PHRASE, NOW + 17 * DAY, 15);
assert.equal(presentLaunch(m.rec, NOW + 17 * DAY, 15).commissions_active, true);

assert.deepEqual(allowedTransitions("BETA"), ["LAUNCH_PROMO"]);
console.log("launch-state: all tests passed");
