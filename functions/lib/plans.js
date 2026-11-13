// Single source of the future plans (page «Commissioni e abbonamenti», calculator, banner, legal pages).
// NOT active in beta (launch-state commissions_active === false). Seller pays, % on item value
// (shipping excluded), no fixed fee per sale, PayPal costs separate. DreaMint does not collect payments.
export const PLANS = Object.freeze([
  Object.freeze({ id: "free", label: "FREE", monthly_cents: 0, fee_bps: 250 }),
  Object.freeze({ id: "pro", label: "PRO", monthly_cents: 990, fee_bps: 200 }),
  Object.freeze({ id: "business", label: "BUSINESS", monthly_cents: 2990, fee_bps: 150 })
]);

export function freePlanPercent() {
  return PLANS.find((p) => p.id === "free").fee_bps / 100;
}

// v26: every non-admin account must pick a plan (signup or gate). In BETA this saves ONLY the preference
// (users.plan + users.plan_chosen_at): no charge, no commission, no subscription is activated.
export function normalizePlanId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return PLANS.some((p) => p.id === id) ? id : null;
}

// Admins are exempt, decided ONLY by users.role === 'admin' (never by email).
export function isPlanExempt(user) {
  return !!user && user.role === "admin";
}

export function needsPlanChoice(user) {
  return !!user && !isPlanExempt(user) && !normalizePlanId(user.plan || "");
}

// Plan that would apply after the official launch (preference only). Admins: exempt, 0%, no subscription.
export function effectivePlan(user) {
  if (isPlanExempt(user)) return { id: "exempt", exempt: true, monthly_cents: 0, fee_bps: 0 };
  const id = normalizePlanId((user && user.plan) || "");
  if (!id) return null;
  const p = PLANS.find((x) => x.id === id);
  return { id: p.id, exempt: false, monthly_cents: p.monthly_cents, fee_bps: p.fee_bps };
}
