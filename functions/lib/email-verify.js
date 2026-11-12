// Email verification + server-issued challenge codes (M4). Pure helpers, no I/O except fetch-free crypto.

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
export const CHALLENGE_TTL_MS = 2 * 60 * 60 * 1000;       // 2h to photograph the slab
export const RESEND_USER_RULE = { name: "verifymail-user", limit: 3, windowSec: 3600 };
const CHALLENGE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars -> byte % 32 is unbiased

export function randomTokenHex(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomChallengeCode(len = 8) {
  const a = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += CHALLENGE_CHARS[a[i] % CHALLENGE_CHARS.length];
  return out;
}

export function isEmailVerified(user) {
  return !!(user && user.email_verified_at);
}

// Endpoints that sell / buy / redeem: blocked (403 email_not_verified) until the email is verified.
// Browsing, login, profile, cancel and the verification endpoints stay open.
export function requiresVerifiedEmail(method, path) {
  const m = String(method || "").toUpperCase();
  const p = String(path || "");
  if (m === "POST") {
    if (p === "cards" || p === "catalog" || p === "listings" || p === "cards/challenge") return true;
    if (/^cards\/[^/]+\/photos$/.test(p)) return true;
    if (/^cards\/challenge\/[^/]+\/video$/.test(p)) return true;
    if (/^listings\/[^/]+\/request$/.test(p)) return true;
    if (/^sales\/[^/]+\/(accept|ship|receive|mark-paid)$/.test(p)) return true;
    if (/^sales\/[^/]+\/paypal\/(order|capture)$/.test(p)) return true;
    if (p === "copies/redeem" || p === "claims") return true;
    if (/^cards\/[^/]+\/transfer-code$/.test(p)) return true;
  }
  if (m === "PATCH") {
    if (/^listings\/[^/]+$/.test(p) || /^cards\/[^/]+\/(price|market)$/.test(p)) return true;
  }
  if (m === "GET" && /^sales\/[^/]+\/paypal-link$/.test(p)) return true;
  return false;
}

export function emailNotVerifiedError() {
  return Object.assign(new Error("Conferma prima la tua email: ti abbiamo mandato un link. Puoi chiederne uno nuovo dal tuo profilo."), {
    status: 403,
    code: "email_not_verified"
  });
}

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function verificationEmail(displayName, link) {
  const name = String(displayName || "").trim();
  const hello = name ? "Ciao " + name + "," : "Ciao,";
  const text = [
    hello,
    "",
    "grazie per esserti registrato su DreaMint.",
    "Per confermare il tuo indirizzo email apri questo link:",
    "",
    link,
    "",
    "Il link vale 24 ore e si può usare una sola volta.",
    "Finché non confermi puoi guardare il sito, ma non puoi vendere, comprare o riscattare carte.",
    "",
    "Se non sei stato tu a registrarti, ignora questa email.",
    "",
    "DreaMint"
  ].join("\n");
  const html =
    "<p>" + escHtml(hello) + "</p>" +
    "<p>grazie per esserti registrato su DreaMint.<br>Per confermare il tuo indirizzo email apri questo link:</p>" +
    '<p><a href="' + escHtml(link) + '">Conferma la mia email</a></p>' +
    '<p style="color:#666;font-size:13px">' + escHtml(link) + "</p>" +
    "<p>Il link vale 24 ore e si può usare una sola volta.<br>Finché non confermi puoi guardare il sito, ma non puoi vendere, comprare o riscattare carte.</p>" +
    "<p>Se non sei stato tu a registrarti, ignora questa email.</p><p>DreaMint</p>";
  return { subject: "DreaMint: conferma la tua email", text, html };
}
