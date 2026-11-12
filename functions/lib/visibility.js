// Test cards (slabs.is_test = 1, typically admin-created graded QA cards) are
// visible only to admins: not to anonymous visitors, regular users, or even the
// assigned non-admin owner. Lists omit them; detail endpoints return the same
// 404 as a missing card so existence is not leaked.

const COOKIE = "gemint_sid";

export function canSeeTest(user) {
  return !!(user && user.role === "admin");
}

// SQL fragment for WHERE clauses. Admin: always true. Everyone else: hide test slabs.
export function testVisibleSql(user, alias = "s") {
  return canSeeTest(user) ? "1=1" : `${alias}.is_test = 0`;
}

export function isHiddenTest(row, user) {
  return !!(row && Number(row.is_test) && !canSeeTest(user));
}

// Lightweight session read for handlers that cannot import getUser from the API router
// (e.g. the public /c/ Pages function). Returns { id, role } or null.
export async function loadViewer(request, env) {
  const raw = (request && request.headers && request.headers.get("Cookie")) || "";
  let token = null;
  for (const part of raw.split(";")) {
    const s = part.trim();
    if (s.startsWith(COOKIE + "=")) token = s.slice(COOKIE.length + 1);
  }
  if (!token || !env || !env.DB) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return env.DB.prepare(
    `SELECT u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(hex, new Date().toISOString()).first();
}
