// Public usernames (migrate-v16.sql): 3-20 chars [a-z0-9_.], stored lower-case.
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

// Exact reserved names (route words, staff/brand impersonation).
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "amministratore", "root", "system", "sistema", "staff", "moderator", "moderatore", "mod",
  "dreamint", "gemint", "support", "supporto", "assistenza", "help", "aiuto", "info", "contact", "contatti",
  "noreply", "no_reply", "security", "sicurezza", "official", "ufficiale", "owner", "team", "api", "www", "mail",
  "email", "paypal", "me", "user", "users", "utente", "utenti", "search", "album", "account", "login", "signup",
  "logout", "settings", "null", "undefined", "anonymous", "anonimo", "test", "legal", "privacy", "terms", "faq",
  "market", "marketplace", "shop", "cards", "card", "carte", "c"
]);

// Returns { ok:true, username } or { ok:false, code, error }.
export function normalizeUsername(value) {
  if (typeof value !== "string") return { ok: false, code: "username_invalid", error: "Username non valido" };
  const u = value.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) {
    return { ok: false, code: "username_invalid", error: "Lo username deve avere 3-20 caratteri tra a-z, 0-9, _ e ." };
  }
  // Reserved: exact words, and anything impersonating the brand or staff.
  if (RESERVED_USERNAMES.has(u) || u.includes("dreamint") || u.includes("gemint") || /^admin/.test(u) || /^(support|staff|moderat)/.test(u)) {
    return { ok: false, code: "username_invalid", error: "Questo username è riservato" };
  }
  return { ok: true, username: u };
}

// Search query: 2-30 chars after trim, lower-cased; LIKE wildcards escaped with "\".
export function normalizeQuery(value) {
  const q = String(value == null ? "" : value).trim().toLowerCase();
  if (q.length < 2 || q.length > 30) return null;
  return q;
}
export function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (c) => "\\" + c);
}
