// Why a card the owner holds is not on sale. Mirrors the checks of maybeAutoList (same order) without
// changing them. Returned only to the owner / an admin (never in public APIs).
import { isValidPaypalEmail } from "./paypal.js";

export const LISTING_BLOCKED_REASONS = {
  archived: "Archiviata («venduta fuori da DreaMint»)",
  in_review: "In attesa di approvazione",
  rejected: "Registrazione rifiutata",
  not_available: "Stato attuale non vendibile (es. vendita in corso o spedita)",
  not_opened: "Gradata: apri prima l’estrazione della rarità",
  not_full_owner: "Gradata: possiedi la lastra ma non la copia digitale (o viceversa)",
  no_price: "Manca il prezzo di vendita",
  no_paypal: "Manca l’email PayPal nel profilo",
  auto_list_pending: "Tutto pronto: verrà messa in vendita al prossimo aggiornamento (o mettila in vendita tu)"
};

// slab: row from loadSlab/myCards (listing_id/listing_status from the active/reserved listing join).
export function listingBlockedReason(slab, ownerPaypalEmail) {
  if (!slab) return null;
  if (slab.listing_id && (slab.listing_status === "active" || slab.listing_status === "reserved")) return null;
  if (slab.archived_at) return "archived";
  if (slab.status === "in_review") return "in_review";
  if (slab.status === "rejected") return "rejected";
  if (slab.status !== "approved") return "not_available";
  if (!slab.is_ungraded && !slab.opened_at) return "not_opened";
  if (!slab.is_ungraded && slab.digital_owner_id !== slab.physical_owner_id) return "not_full_owner";
  const price = Number(slab.asking_price_cents);
  if (!Number.isFinite(price) || price <= 0) return "no_price";
  if (!isValidPaypalEmail(ownerPaypalEmail)) return "no_paypal";
  return "auto_list_pending";
}
