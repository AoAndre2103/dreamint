window.GEMINT_CONFIG = {
  contactEmail: "info@dreamint.it",
  launchPublicDate: null,
  launchPublicDateLabel: "Data di lancio pubblico: da annunciare",
  offerEndDateLabel: "Data di lancio pubblico: da annunciare",
  offerDays: 15,
  // Static fallback until /api/config loads. Fee = FREE plan rate; plans are not active in beta.
  feeAfterPercent: 2.5,
  plans: [
    { id: "free", label: "FREE", monthly_cents: 0, fee_bps: 250 },
    { id: "pro", label: "PRO", monthly_cents: 990, fee_bps: 200 },
    { id: "business", label: "BUSINESS", monthly_cents: 2990, fee_bps: 150 }
  ],
  feeOfferPercent: 0
};
