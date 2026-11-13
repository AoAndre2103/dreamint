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
