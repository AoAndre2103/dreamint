
import {
  paypalMode,
  paypalApiBase,
  isValidPaypalEmail,
  buildWpsCheckoutUrl,
  buildOrdersCreateBody,
  parseFormBody,
  validateIpnPayment,
  validateRestCapture,
  validateRestCaptureStrict,
  extractCaptureFromOrder,
  canMarkPaid,
  canShip,
  shouldAutoComplete,
  publicPaypalConfig,
  ipnVerifyUrl,
  payableCents
} from "../lib/paypal.js";
import {
  publicShippingConfig,
  parseShippingChoice,
  presentShipping,
  trackingUrl,
  formatDestText
} from "../lib/shipping.js";
import {
  normalizePartnerCode,
  isValidPartnerCode,
  presentAdminPartner,
  presentPublicPartnerStats,
  PARTNER_STATS_SQL
} from "../lib/partners.js";
import { lookupExternalCatalog, safeExternalCatalogImage } from "../lib/catalog-search.js";
import { handleCertificateRoutes, issueCertificateForSlab, makeTransferCode, transferCodeRotateStmts, notifyDigitalOwnerTransferCode } from "../lib/certificate.js";
import { handlePriceRoutes, snapshotHits, maybeRefreshModelPrice, attachTrendsToListings, snapshotFromHit } from "../lib/price-history.js";
import { handleLaunchRoutes, getLaunchState } from "../lib/launch-state.js";
import { enforceIpRule, assertLoginAllowed, recordLoginFailure, enforceIdentRule } from "../lib/rate-limit.js";
import {
  VERIFY_TOKEN_TTL_MS, CHALLENGE_TTL_MS, RESEND_USER_RULE, randomTokenHex, randomChallengeCode,
  isEmailVerified, requiresVerifiedEmail, emailNotVerifiedError, verificationEmail
} from "../lib/email-verify.js";
import { SERIAL_MAX, drawUniqueSerial, isUniqueViolation, tierFromRollExact, serialTotalFor } from "../lib/mint-draw.js";
import { listingBlockedReason } from "../lib/listing-status.js";
import { handleChatRoutes } from "../lib/chat.js";
import { KINDS, PRICE_COLUMN, effectiveKind, canSellKind, listingValidSql, conflictSql, parseMarketPrice, certSearchValues, CERT_NORM_SQL } from "../lib/markets.js";
import { normalizeUsername, normalizeQuery, likeEscape, USERNAME_RE } from "../lib/usernames.js";
import { validateChallengeVideo, videoResponse, VIDEO_MAX_BYTES, VIDEO_KV_PREFIX } from "../lib/challenge-video.js";
import { sanitizeImageDataUrl, parseImageDataUrl, safeImageResponse, TEST_CARD_PNG_DATA_URL } from "../lib/image-safety.js";

const COOKIE = "gemint_sid";

const SESSION_DAYS = 30;
const PBKDF2_ITERS = 100000;
const GAMES = [
  { id: "pokemon", label: "Pokémon" },
  { id: "one_piece", label: "One Piece" },
  { id: "lorcana", label: "Lorcana" },
  { id: "magic", label: "Magic" },
  { id: "yugioh", label: "Yu-Gi-Oh!" },
  { id: "other", label: "Altro TCG" },
  { id: "fictional_demo", label: "Demo fittizia" }
];
const PHOTO_VARIANT_WIDTHS = ["112", "224", "336", "448", "560", "672"];
const PHOTO_KV_MAX = 20 * 1024 * 1024;
// SECURITY (M5): cap the total size of one upload request (all photos + variants).
const PHOTO_REQUEST_MAX = 30 * 1024 * 1024;
function totalPhotoChars(photos) {
  let n = 0;
  for (const p of Object.values(photos || {})) {
    n += String(p.original || "").length;
    for (const v of Object.values(p.variants || {})) n += String(v || "").length;
  }
  return n;
}
const LANGUAGES = ["ITA", "ENG", "JPN", "FRA", "DEU", "ESP", "POR", "KOR", "CHS", "CHT"];
const VARIANTS = [
  { id: "normal", label: "Normale" },
  { id: "holo", label: "Holo" },
  { id: "reverse_holo", label: "Reverse holo" },
  { id: "first_edition", label: "1ª edizione" },
  { id: "shadowless", label: "Shadowless" },
  { id: "full_art", label: "Full art" },
  { id: "alt_art", label: "Alt art" },
  { id: "parallel", label: "Parallel" },
  { id: "stamped", label: "Stamped" },
  { id: "promo", label: "Promo" }
];
const GRADERS = [
  { id: "PSA", label: "PSA", graded: true },
  { id: "BGS", label: "BGS", graded: true },
  { id: "CGC", label: "CGC", graded: true },
  { id: "GRAAD", label: "GRAAD", graded: true },
  { id: "VERTEX", label: "Vertex Grading", graded: true },
  { id: "AIGRADING", label: "AiGrading", graded: true },
  { id: "AP", label: "AP Grading", graded: true },
  { id: "PCC", label: "PCC", graded: true },
  { id: "NONE", label: "Non gradata", graded: false }
];
const TIER_LABELS = {
  comune: "Comune",
  rara: "Rara",
  epica: "Epica",
  leggendaria: "Leggendaria",
  mitica: "Mitica"
};
const CONDITIONS = [
  { id: "NM", label: "NM — Near Mint" },
  { id: "EX", label: "EX — Excellent" },
  { id: "GD", label: "GD — Good" },
  { id: "LP", label: "LP — Lightly Played" },
  { id: "PL", label: "PL — Played" },
  { id: "Poor", label: "Poor" }
];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api\/?/, "");
  if (path.endsWith("/")) path = path.slice(0, -1);
  try {
    const method = request.method.toUpperCase();
    // SECURITY: CSRF — state-changing requests must come from this site (PayPal callbacks are
    // exempt here and are verified with PayPal instead).
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "paypal/ipn" && path !== "paypal/webhook") {
      if (!sameOriginRequest(request, url)) return json({ error: "Richiesta non consentita (origine)" }, 403);
    }
    await enforceIpRule(env, request, method, path);
    const res = await route(request, env, path, url);
    return res;
  } catch (err) {
    const status = err.status || 500;
    const extra = status === 429 && err.retryAfter ? { "retry-after": String(err.retryAfter) } : {};
    if (status >= 500) console.log("api error", path, err && err.message);
    const body = { error: status >= 500 ? "Errore interno" : (err.message || "Errore") };
    if (status < 500 && err.code) body.code = err.code;
    return json(body, status, extra);
  }
}

function sameOriginRequest(request, url) {
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === url.host; } catch (e) { return false; }
  }
  const ref = request.headers.get("referer");
  if (ref) {
    try { return new URL(ref).host === url.host; } catch (e) { return false; }
  }
  return true; // non-browser client (no ambient cookies from another site)
}

async function route(request, env, path, url) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  // Email verification gate (server side): sell / buy / redeem need a verified email.
  if (requiresVerifiedEmail(method, path)) {
    const gateUser = await getUser(request, env);
    if (gateUser && !isEmailVerified(gateUser)) throw emailNotVerifiedError();
  }

  const chatRes = await handleChatRoutes(request, env, method, path, url, { requireUser, nowIso, readJson, audit });
  if (chatRes) return chatRes;

  const certRes = await handleCertificateRoutes(request, env, path, url, {
    corsHeaders: cors(),
    getUser,
    requireUser,
    requireAdmin,
    readJson,
    sendNotifyEmail,
    notifyAdminSafe,
    audit
  });
  if (certRes) return certRes;

  const priceRes = await handlePriceRoutes(request, env, path, url, {
    corsHeaders: cors(),
    requireAdmin,
    readJson,
    audit
  });
  if (priceRes) return priceRes;

  const launchRes = await handleLaunchRoutes(request, env, path, {
    corsHeaders: cors(),
    requireAdmin,
    readJson,
    audit
  });
  if (launchRes) return launchRes;

  if (method === "GET" && (path === "config" || path === "")) {
    return json({ ...publicConfig(env), launch: await getLaunchState(env) });
  }

  if (method === "POST" && path === "auth/signup") return signup(request, env);
  if (method === "POST" && path === "auth/login") return login(request, env);
  if (method === "POST" && path === "auth/logout") return logout(request, env);
  if (method === "GET" && path === "auth/verify-email") return verifyEmail(request, env, url);
  if (method === "POST" && path === "auth/resend-verification") return resendVerification(request, env);
  if (method === "POST" && path === "cards/challenge") return issueChallenge(request, env);
  const chVideo = path.match(/^cards\/challenge\/([^/]+)\/video$/);
  if (method === "POST" && chVideo) return uploadChallengeVideo(request, env, chVideo[1]);
  const cardChVideo = path.match(/^cards\/([^/]+)\/challenge-video$/);
  if ((method === "GET" || method === "HEAD") && cardChVideo) return serveChallengeVideo(request, env, cardChVideo[1]);
  if (method === "GET" && path === "me") return me(request, env);
  if (method === "PATCH" && path === "me") return updateMe(request, env);
  if (method === "GET" && path === "users/search") return searchUsers(env, url);
  if (method === "GET" && path === "search/cert") return searchCert(env, url);
  const marketM = path.match(/^cards\/([^/]+)\/market$/);
  if (method === "PATCH" && marketM) return updateMarket(request, env, marketM[1]);
  const userAlbumM = path.match(/^users\/([^/]+)\/album$/);
  if (method === "GET" && userAlbumM) return userAlbum(request, env, userAlbumM[1]);

  if (method === "GET" && path === "catalog") return searchCatalog(url, env);
  if (method === "GET" && path === "catalog/lookup") return lookupCatalog(url, env);
  if (method === "POST" && path === "catalog") return createModel(request, env);

  if (method === "POST" && path === "cards") return registerCard(request, env);
  if (method === "GET" && path === "cards") return myCards(request, env);

  const cardOpen = path.match(/^cards\/([^/]+)\/open$/);
  if (method === "POST" && cardOpen) return openCard(request, env, cardOpen[1]);

  const cardArchive = path.match(/^cards\/([^/]+)\/archive$/);
  if (method === "POST" && cardArchive) return archiveCard(request, env, cardArchive[1]);

  const cardPhotos = path.match(/^cards\/([^/]+)\/photos$/);
  if (method === "POST" && cardPhotos) return replaceCardPhotos(request, env, cardPhotos[1]);

  const cardPhoto = path.match(/^cards\/([^/]+)\/photo\/([^/]+)$/);
  if (method === "GET" && cardPhoto) return servePhoto(request, env, cardPhoto[1], cardPhoto[2], url);

  const cardOne = path.match(/^cards\/([^/]+)$/);
  if (method === "GET" && cardOne) return getCard(request, env, cardOne[1]);

  const pub = path.match(/^public\/cards\/([^/]+)$/);
  if (method === "GET" && pub) return publicCard(env, pub[1]);

  if (method === "GET" && path === "market") return listMarket(url, env);
  if (method === "GET" && path === "recent") return listRecent(env);
  if (method === "POST" && path === "listings") return createListing(request, env);
  const listingOne = path.match(/^listings\/([^/]+)$/);
  if (method === "PATCH" && listingOne) return updateListingPrice(request, env, listingOne[1]);
  const cardPrice = path.match(/^cards\/([^/]+)\/price$/);
  if (method === "PATCH" && cardPrice) return updateCardPrice(request, env, cardPrice[1]);
  const buy = path.match(/^listings\/([^/]+)\/request$/);
  if (method === "POST" && buy) return requestBuy(request, env, buy[1]);

  if (method === "GET" && path === "sales") return mySales(request, env);
  const saleAct = path.match(/^sales\/([^/]+)\/(accept|ship|receive|cancel|mark-paid)$/);
  if (method === "POST" && saleAct) return saleAction(request, env, saleAct[1], saleAct[2]);
  if (method === "GET" && path.match(/^sales\/[^/]+\/paypal-link$/)) {
    return paypalLink(request, env, path.split("/")[1]);
  }
  if (method === "POST" && path.match(/^sales\/[^/]+\/paypal\/order$/)) {
    return paypalCreateOrder(request, env, path.split("/")[1]);
  }
  if (method === "POST" && path.match(/^sales\/[^/]+\/paypal\/capture$/)) {
    return paypalCaptureOrder(request, env, path.split("/")[1]);
  }
  if (method === "POST" && path === "paypal/ipn") return paypalIpn(request, env);
  if (method === "POST" && path === "paypal/webhook") return paypalWebhook(request, env);

  if (method === "POST" && path === "admin/test-card") return adminCreateTestCard(request, env);
  if (method === "POST" && path === "admin/notify-test") return adminNotifyTest(request, env);
  if (method === "GET" && path === "admin/queue") return adminQueue(request, env);
  if (method === "GET" && path === "admin/sales") return adminSales(request, env);
  const adm = path.match(/^admin\/cards\/([^/]+)$/);
  if (method === "GET" && adm) return adminCard(request, env, adm[1]);
  const admAct = path.match(/^admin\/cards\/([^/]+)\/(approve|reject)$/);
  if (method === "POST" && admAct) {
    return admAct[2] === "approve"
      ? approveCard(request, env, admAct[1])
      : rejectCard(request, env, admAct[1]);
  }
  if (method === "GET" && path === "admin/partners") return adminListPartners(request, env);
  if (method === "POST" && path === "admin/partners") return adminCreatePartner(request, env);
  const partnerTok = path.match(/^partner\/([^/]+)$/);
  if (method === "GET" && partnerTok) return publicPartnerStats(request, env, partnerTok[1]);

  return json({ error: "Non trovato" }, 404);
}

function publicConfig(env) {
  const label = env.LAUNCH_PUBLIC_DATE_LABEL || "Data di lancio pubblico: da annunciare";
  const launchDate = env.LAUNCH_PUBLIC_DATE || "";
  return {
    contactEmail: env.CONTACT_EMAIL || "info@dreamint.it",
    launchPublicDate: launchDate || null,
    launchPublicDateLabel: launchDate ? launchDate : label,
    offerEndDateLabel: launchDate ? null : label,
    offerDays: Number(env.OFFER_DAYS || 15),
    feeOfferPercent: Number(env.FEE_OFFER_BPS || 0) / 100,
    feeAfterPercent: Number(env.FEE_AFTER_BPS || 250) / 100,
    // Future plans: NOT active during beta. Seller pays, % on item value (shipping excluded), no fixed fee, PayPal costs separate.
    plans: [
      { id: "free", label: "FREE", monthly_cents: 0, fee_bps: 250 },
      { id: "pro", label: "PRO", monthly_cents: 990, fee_bps: 200 },
      { id: "business", label: "BUSINESS", monthly_cents: 2990, fee_bps: 150 }
    ],
    plansActive: false,
    sold_outside_archive: true,
    public_albums: true,
    games: GAMES.filter((g) => g.id !== "fictional_demo"),
    languages: LANGUAGES,
    variants: VARIANTS,
    graders: GRADERS,
    conditions: CONDITIONS,
    paypal: publicPaypalConfig(env),
    shipping: publicShippingConfig(),
    tiers: [
      { id: "comune", label: "Comune", p: 70 },
      { id: "rara", label: "Rara", p: 20 },
      { id: "epica", label: "Epica", p: 8 },
      { id: "leggendaria", label: "Leggendaria", p: 1.9 },
      { id: "mitica", label: "Mitica", p: 0.1 }
    ]
  };
}

// SECURITY (M3): same-origin API, no wildcard CORS.
function cors() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin"
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors(),
      ...extraHeaders
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function randomHex(bytes) {
  return bufToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  return bufToHex(await crypto.subtle.digest("SHA-256", enc));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBuf(saltHex), iterations: PBKDF2_ITERS },
    key,
    256
  );
  return bufToHex(bits);
}

function parseCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    if (p.startsWith(COOKIE + "=")) return p.slice(COOKIE.length + 1);
  }
  return null;
}

function sessionCookie(token, maxAgeSec) {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`
  ];
  return parts.join("; ");
}


function ownerEmails(env) {
  return String((env && env.OWNER_EMAILS) || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isOwnerEmail(env, email) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && ownerEmails(env).includes(e);
}

// SECURITY: no automatic admin promotion (signup/login/session). Email ownership is never
// verified, so OWNER_EMAILS must not grant admin. Admin stays only on users that already
// have role='admin' in D1 (set manually).
async function ensureOwnerAdmin(env, user) {
  return user;
}

async function getUser(request, env) {
  const token = parseCookie(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, nowIso()).first();
  if (row) await ensureOwnerAdmin(env, row);
  return row || null;
}

async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) {
    const err = new Error("Accedi per continuare");
    err.status = 401;
    throw err;
  }
  return user;
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== "admin") {
    const err = new Error("Area riservata agli operatori");
    err.status = 403;
    throw err;
  }
  return user;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, userId, exp).run();
  return token;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    country: u.country,
    role: u.role,
    paypal_email: u.paypal_email || "",
    email_verified: isEmailVerified(u),
    username: u.username || null,
    album_public: !!u.album_public
  };
}

async function referredByPublic(env, u) {
  if (!u || !u.referred_by_partner_id) return null;
  const p = await env.DB.prepare("SELECT name, code FROM partners WHERE id = ?").bind(u.referred_by_partner_id).first();
  if (!p) return null;
  return { name: p.name, code: p.code };
}

async function publicUserWithMeta(env, u) {
  const pub = publicUser(u);
  pub.referred_by = await referredByPublic(env, u);
  if (u && u.role === "admin") {
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM slabs WHERE status = 'in_review'").first();
      pub.pending_reviews = Number(row && row.n) || 0;
    } catch (e) {
      pub.pending_reviews = 0;
    }
  }
  return pub;
}

const CANONICAL_ORIGIN = "https://dreamint.it";
function siteOrigin(request) {
  try {
    const u = new URL(request.url);
    const host = (u.hostname || "").toLowerCase();
    if (host.endsWith(".gemint-beta.pages.dev") && host !== "gemint-beta.pages.dev") return u.origin;
    if (host === "localhost" || host === "127.0.0.1") return u.origin;
    return CANONICAL_ORIGIN;
  } catch (e) {
    return CANONICAL_ORIGIN;
  }
}

function formatEuros(cents) {
  const n = Number(cents || 0) / 100;
  return "€" + n.toFixed(2).replace(".", ",");
}

function parsePriceEuros(value) {
  if (value == null || value === "") {
    return { ok: false, error: "Indica un prezzo di vendita in euro maggiore di zero" };
  }
  const n = Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Indica un prezzo di vendita in euro maggiore di zero" };
  }
  const cents = Math.round(n * 100);
  if (cents < 1 || cents > 100000000) {
    return { ok: false, error: "Indica un prezzo di vendita in euro maggiore di zero" };
  }
  return { ok: true, cents };
}

function parseCardmarketAvgCents(body) {
  if (!body) return null;
  if (body.cardmarket_avg_cents != null && body.cardmarket_avg_cents !== "") {
    const cents = Math.round(Number(body.cardmarket_avg_cents));
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  }
  if (body.cardmarket_avg_euros != null && body.cardmarket_avg_euros !== "") {
    const n = Number(String(body.cardmarket_avg_euros).replace(",", ".").trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    const cents = Math.round(n * 100);
    return cents > 0 ? cents : null;
  }
  return null;
}

async function maybeAutoList(env, slab) {
  if (!slab || !slab.id) return null;
  if (slab.status !== "approved" || slab.archived_at) return null;
  if (!slab.is_ungraded && !slab.opened_at) return null;
  if (!slab.is_ungraded && slab.digital_owner_id !== slab.physical_owner_id) return null;
  const price = Number(slab.asking_price_cents);
  if (!Number.isFinite(price) || price <= 0) return null;
  const existing = await env.DB.prepare(
    "SELECT id, price_cents, status FROM listings WHERE slab_id = ? AND status IN ('active','reserved','paused') AND COALESCE(kind,'fullset') = 'fullset' ORDER BY created_at DESC LIMIT 1"
  ).bind(slab.id).first();
  if (existing) return existing;
  const seller = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(slab.physical_owner_id).first();
  if (!isValidPaypalEmail(seller && seller.paypal_email)) return null;
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO listings (id, slab_id, seller_id, price_cents, shipping_note, status, created_at)
       SELECT ?, ?, ?, ?, '', 'active', ? WHERE EXISTS (SELECT 1 FROM slabs WHERE id = ? AND archived_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM listings WHERE slab_id = ? AND status = 'reserved')`
    ).bind(id, slab.id, seller.id, price, nowIso(), slab.id, slab.id),
    env.DB.prepare("UPDATE slabs SET status = 'listed' WHERE id = ? AND archived_at IS NULL").bind(slab.id)
  ]);
  await audit(env, seller.id, "auto_list", "listing", id, { slab_id: slab.id, price_cents: price });
  return { id, price_cents: price, status: "active" };
}

async function autoListEligibleForUser(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM slabs
     WHERE physical_owner_id = ?
       AND status = 'approved' AND archived_at IS NULL
       AND asking_price_cents IS NOT NULL AND asking_price_cents > 0
       AND (is_ungraded = 1 OR (opened_at IS NOT NULL AND digital_owner_id = physical_owner_id))`
  ).bind(userId).all();
  for (const s of rows.results || []) {
    await maybeAutoList(env, s);
  }
}

function parseFromAddress(raw, fallbackEmail, fallbackName) {
  const s = String(raw || "").trim();
  const m = s.match(/^(.*)<([^>]+)>$/);
  if (m) return { name: m[1].trim().replace(/^["']|["']$/g, "") || fallbackName, email: m[2].trim() };
  if (s.includes("@")) return { name: fallbackName, email: s };
  return { name: fallbackName, email: fallbackEmail };
}

function notifyConfigured(env) {
  const to = String(env.NOTIFY_EMAIL || "").trim();
  const resend = String(env.RESEND_API_KEY || env.NOTIFY_API_KEY || "").trim();
  const brevo = String(env.BREVO_API_KEY || "").trim();
  return !!(to && (resend || brevo));
}

async function sendNotifyEmail(env, { to, subject, text, html }) {
  const dest = String(to || env.NOTIFY_EMAIL || "").trim();
  const resendKey = String(env.RESEND_API_KEY || env.NOTIFY_API_KEY || "").trim();
  const brevoKey = String(env.BREVO_API_KEY || "").trim();
  if (!dest || (!resendKey && !brevoKey)) return { skipped: true };
  if (!html) {
    html = "<p>" + String(text || "").split("\n").map((line) =>
      line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    ).join("<br>") + "</p>";
  }
  const provider = String(env.NOTIFY_PROVIDER || (brevoKey && !resendKey ? "brevo" : "resend")).toLowerCase();
  try {
    if (provider === "brevo") {
      const from = parseFromAddress(env.NOTIFY_FROM, "noreply@brevosend.com", "DreaMint");
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "content-type": "application/json" },
        body: JSON.stringify({
          sender: from,
          to: [{ email: dest }],
          subject,
          textContent: text,
          htmlContent: html
        })
      });
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }
      if (!res.ok) console.log("notify brevo", res.status);
      return { ok: res.ok, status: res.status, provider: "brevo", id: (data && (data.messageId || data.id)) || null, error: res.ok ? null : "send_failed" };
    }
    const from = env.NOTIFY_FROM || "DreaMint <noreply@dreamint.it>";
    const res = await fetch(String(env.RESEND_API_URL || "https://api.resend.com/emails"), {
      method: "POST",
      headers: { authorization: "Bearer " + resendKey, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [dest], subject, text, html })
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!res.ok) console.log("notify resend", res.status);
    return {
      ok: res.ok,
      status: res.status,
      provider: "resend",
      id: (data && data.id) || null,
      error: res.ok ? null : ((data && (data.message || data.name)) || "send_failed")
    };
  } catch (err) {
    console.log("notify error", err && err.message);
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function notifyAdminSafe(env, request, msg) {
  if (!notifyConfigured(env) || !msg) return { skipped: true };
  const lines = [msg.title, ""];
  if (msg.cardName) lines.push("Carta: " + msg.cardName);
  if (msg.setName) lines.push("Set: " + msg.setName);
  if (msg.code) lines.push("Numero: " + msg.code);
  if (msg.typeLabel) lines.push("Tipo: " + msg.typeLabel);
  if (msg.sellerName) lines.push("Venditore: " + msg.sellerName);
  if (msg.buyerName) lines.push("Acquirente: " + msg.buyerName);
  if (msg.amount) lines.push("Importo: " + msg.amount);
  if (msg.link) { lines.push(""); lines.push("Apri: " + msg.link); }
  const text = lines.join("\n");
  return sendNotifyEmail(env, { subject: msg.subject, text }).catch((err) => {
    console.log("notify error", err && err.message);
    return { ok: false };
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("JSON non valido"), { status: 400 });
  }
}

function normalizeCode(raw) {
  let s = String(raw || "").normalize("NFKC").trim().toUpperCase();
  s = s.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2044\u2215\uFF0F]/g, "/");
  s = s.replace(/\s+/g, " ");
  let m = s.match(/^0*(\d+)\s*\/\s*0*(\d+)$/);
  if (m) return `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}`;
  if (s.includes("-")) {
    m = s.match(/^([A-Z]+)(\d*)\s*-\s*0*(\d+)$/);
    if (m) {
      const prefix = m[1] + (m[2] ? m[2].padStart(2, "0") : "");
      return `${prefix}-${String(parseInt(m[3], 10)).padStart(3, "0")}`;
    }
  }
  m = s.match(/^([A-Z]+)\s*0*(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10)).padStart(3, "0");
  return s;
}

function canonicalPrinted(raw) {
  let s = String(raw || "").normalize("NFKC").trim().toUpperCase();
  s = s.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2044\u2215\uFF0F]/g, "/");
  s = s.replace(/\s+/g, " ");
  let m = s.match(/^0*(\d+)\s*\/\s*0*(\d+)$/);
  if (m) return `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}`;
  if (s.includes("-")) {
    m = s.match(/^([A-Z]+)(\d*)\s*-\s*0*(\d+)$/);
    if (m) {
      const prefix = m[1] + (m[2] ? m[2].padStart(2, "0") : "");
      return `${prefix}-${String(parseInt(m[3], 10)).padStart(3, "0")}`;
    }
  }
  m = s.match(/^([A-Z]+)\s*0*(\d+)$/);
  if (m) {
    const letters = m[1];
    const num = String(parseInt(m[2], 10)).padStart(3, "0");
    return letters.length <= 3 ? `${letters} ${num}` : `${letters}${num}`;
  }
  return s;
}

function slugify(parts) {
  return parts
    .join("-")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function tierFromRoll(roll) {
  if (roll < 0.001) return "mitica";
  if (roll < 0.020) return "leggendaria";
  if (roll < 0.100) return "epica";
  if (roll < 0.300) return "rara";
  return "comune";
}

function rollFromDigest(hex) {
  const n = parseInt(hex.slice(0, 13), 16);
  return n / Math.pow(2, 52);
}

function normalizeCert(grader, cert) {
  return String(cert || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isGradedId(id) {
  return id && id !== "NONE";
}

/* ---------------- auth ---------------- */

async function signup(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const display_name = String(body.display_name || "").trim();
  const country = String(body.country || "Italia").trim() || "Italia";
  if (!email || !email.includes("@")) return json({ error: "Inserisci un'email valida" }, 400);
  if (password.length < 8) return json({ error: "La password deve avere almeno 8 caratteri" }, 400);
  if (password.length > 256) return json({ error: "Password troppo lunga (massimo 256 caratteri)" }, 400);
  if (!display_name) return json({ error: "Inserisci un nome visibile" }, 400);
  // v16: username is mandatory for new accounts; album_public defaults to false.
  const un = normalizeUsername(body.username);
  if (!un.ok) return json({ error: body.username == null || body.username === "" ? "Scegli uno username" : un.error, code: "username_invalid" }, 400);
  if (body.album_public != null && typeof body.album_public !== "boolean") return json({ error: "album_public non valido", code: "album_public_invalid" }, 400);
  const albumPublic = body.album_public === true ? 1 : 0;
  const inviteRaw = body.invite_code || body.ref || "";
  let partnerId = null;
  if (String(inviteRaw).trim()) {
    const code = normalizePartnerCode(inviteRaw);
    if (!isValidPartnerCode(code)) return json({ error: "Codice invito non valido" }, 400);
    const partner = await env.DB.prepare("SELECT id FROM partners WHERE code = ?").bind(code).first();
    if (!partner) return json({ error: "Questo codice invito non esiste" }, 400);
    partnerId = partner.id;
  }
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (exists) return json({ error: "Questa email è già registrata" }, 409);
  if (await usernameTaken(env, un.username, null)) return usernameTakenResponse();
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  // Single INSERT: if the UNIQUE index loses a race nothing is created (no half account).
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_salt, password_hash, display_name, country, role, created_at, is_test, referred_by_partner_id, username, album_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(id, email, salt, hash, display_name.slice(0, 60), country.slice(0, 60), "user", nowIso(), partnerId, un.username, albumPublic).run();
  } catch (e) {
    if (isUniqueViolation(e) && /username/i.test(String(e && e.message))) return usernameTakenResponse();
    if (isUniqueViolation(e)) return json({ error: "Questa email è già registrata" }, 409);
    throw e;
  }
  await dropCurrentSession(request, env);
  const token = await createSession(env, id);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  const sent = await sendVerificationEmail(request, env, user);
  return json({ user: await publicUserWithMeta(env, user), verification_sent: !!sent.ok }, 201, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  await assertLoginAllowed(env, request, email);
  if (password.length > 256) {
    await recordLoginFailure(env, request, email);
    return json({ error: "Email o password non corretti" }, 401);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    await recordLoginFailure(env, request, email);
    return json({ error: "Email o password non corretti" }, 401);
  }
  const hash = await hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) {
    await recordLoginFailure(env, request, email);
    return json({ error: "Email o password non corretti" }, 401);
  }
  await ensureOwnerAdmin(env, user);
  await dropCurrentSession(request, env);
  const token = await createSession(env, user.id);
  return json({ user: await publicUserWithMeta(env, user) }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

// Session rotation: a login/signup never keeps the session token the browser had before.
async function dropCurrentSession(request, env) {
  const old = parseCookie(request);
  if (!old) return;
  try {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(old)).run();
  } catch (e) { /* ignore */ }
}

/* ---------------- email verification ---------------- */

async function sendVerificationEmail(request, env, user) {
  if (!user || isEmailVerified(user)) return { ok: false, skipped: true };
  const token = randomTokenHex(32);
  const now = nowIso();
  const exp = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  // Only the newest link stays valid.
  await env.DB.batch([
    env.DB.prepare("UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now, user.id),
    env.DB.prepare("INSERT INTO email_verifications (token_hash, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), user.id, user.email, now, exp)
  ]);
  const link = siteOrigin(request) + "/api/auth/verify-email?token=" + token;
  const msg = verificationEmail(user.display_name, link);
  const res = await sendNotifyEmail(env, { to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
  if (!res || !res.ok) console.log("verification email not sent", res && (res.status || res.error || (res.skipped ? "skipped" : "")));
  return res || { ok: false };
}

async function verifyEmail(request, env, url) {
  const token = String(url.searchParams.get("token") || "");
  const dest = (esito) => new Response(null, {
    status: 302,
    headers: { location: siteOrigin(request) + "/?email=" + esito + "#/account", "cache-control": "no-store", ...cors() }
  });
  if (!/^[0-9a-f]{64}$/.test(token)) return dest("link-non-valido");
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const row = await env.DB.prepare("SELECT * FROM email_verifications WHERE token_hash = ?").bind(tokenHash).first();
  if (!row) return dest("link-non-valido");
  if (row.used_at) return dest("link-gia-usato");
  if (row.expires_at <= now) return dest("link-scaduto");
  // Single use: consume the token atomically, then mark the user (only if the email did not change).
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE email_verifications SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
      .bind(now, tokenHash, now),
    env.DB.prepare(
      `UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ? AND email_verified_at IS NULL
       AND EXISTS (SELECT 1 FROM email_verifications WHERE token_hash = ? AND used_at = ?)`
    ).bind(now, row.user_id, row.email, tokenHash, now)
  ]);
  if (!res[0].meta || !res[0].meta.changes) return dest("link-gia-usato");
  await audit(env, row.user_id, "email_verified", "user", row.user_id, {});
  return dest("verificata");
}

async function resendVerification(request, env) {
  const user = await requireUser(request, env);
  if (isEmailVerified(user)) return json({ ok: true, already_verified: true });
  await enforceIdentRule(env, RESEND_USER_RULE, user.id);
  const sent = await sendVerificationEmail(request, env, user);
  if (!sent.ok) return json({ error: "Non siamo riusciti a inviare l’email. Riprova più tardi." }, 503);
  return json({ ok: true, sent: true });
}

/* ---------------- challenge codes (M4) ---------------- */

async function issueChallenge(request, env) {
  const user = await requireUser(request, env);
  const id = crypto.randomUUID();
  const code = randomChallengeCode(8);
  const now = nowIso();
  const exp = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO challenge_codes (id, user_id, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, user.id, code, now, exp).run();
  return json({ challenge_id: id, code, expires_at: exp }, 201);
}

// Challenge video: ~5 s clip, card in its slab, code read aloud. Raw body (video/*), bound to an issued,
// unused, unexpired challenge of this user. Stored as one binary KV value (photos are data URLs in KV too).
async function uploadChallengeVideo(request, env, challengeId) {
  const user = await requireUser(request, env);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > VIDEO_MAX_BYTES) return json({ error: "Video troppo pesante (massimo 20 MB): registra circa 5 secondi", code: "video_too_large" }, 413);
  const row = await env.DB.prepare("SELECT * FROM challenge_codes WHERE id = ? AND user_id = ?").bind(String(challengeId), user.id).first();
  if (!row || row.used_at || row.expires_at <= nowIso()) {
    return json({ error: "Codice-sfida non valido o scaduto: ricarica la pagina per averne uno nuovo", code: "challenge_invalid" }, 400);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const v = validateChallengeVideo(bytes);
  if (!v.ok) return json({ error: v.error, code: v.code }, v.status);
  const key = VIDEO_KV_PREFIX + row.id;
  await env.PHOTOS.put(key, bytes, { metadata: { mime: v.mime, ext: v.ext } });
  const upd = await env.DB.prepare(
    `UPDATE challenge_codes SET video_key = ?, video_mime = ?, video_size = ?, video_duration_ms = ?, video_uploaded_at = ?
     WHERE id = ? AND user_id = ? AND used_at IS NULL`
  ).bind(key, v.mime, v.size, v.durationMs, nowIso(), row.id, user.id).run();
  if (!upd.meta || !upd.meta.changes) return json({ error: "Codice-sfida già usato", code: "challenge_invalid" }, 409);
  return json({ ok: true, challenge_id: row.id, size: v.size, duration_ms: v.durationMs, mime: v.mime }, 201);
}

async function challengeVideoRow(env, slabId) {
  return env.DB.prepare("SELECT * FROM challenge_codes WHERE slab_id = ? AND video_key IS NOT NULL ORDER BY used_at DESC LIMIT 1").bind(slabId).first();
}

async function serveChallengeVideo(request, env, slabId) {
  const user = await getUser(request, env);
  const slab = await env.DB.prepare("SELECT * FROM slabs WHERE id = ?").bind(slabId).first();
  if (!slab || !user) return json({ error: "Video non trovato" }, 404);
  const row = await challengeVideoRow(env, slabId);
  // Privacy: the clip has the uploader's voice -> only the uploader (while still an owner) and admins.
  if (!row || !(user.role === "admin" || (row.user_id === user.id && isOwner(slab, user)))) return json({ error: "Video non trovato" }, 404);
  const bin = await env.PHOTOS.get(row.video_key, "arrayBuffer");
  if (!bin) return json({ error: "Video non trovato" }, 404);
  const ext = row.video_mime === "video/quicktime" ? "mov" : row.video_mime === "video/webm" ? "webm" : "mp4";
  return videoResponse(bin, row.video_mime || "application/octet-stream", ext, request);
}

async function logout(request, env) {
  const token = parseCookie(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function me(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ user: null });
  return json({ user: await publicUserWithMeta(env, user) });
}

/* ---------------- catalog ---------------- */

function modelPublic(m) {
  if (!m) return null;
  return {
    id: m.id,
    game: m.game,
    set_name: m.set_name,
    set_code: m.set_code,
    code_printed: m.code_printed,
    code_normalized: m.code_normalized,
    name: m.name,
    language: m.language,
    variant: m.variant,
    slug: m.slug,
    catalog_image: m.catalog_image || null
  };
}

async function searchCatalog(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const game = url.searchParams.get("game") || "";
  const language = url.searchParams.get("language") || "";
  const variant = url.searchParams.get("variant") || "";
  let sql = "SELECT * FROM card_models WHERE 1=1";
  const binds = [];
  if (game) { sql += " AND game = ?"; binds.push(game); }
  if (language) { sql += " AND language = ?"; binds.push(language); }
  if (variant) { sql += " AND variant = ?"; binds.push(variant); }
  if (q) {
    const norm = normalizeCode(q);
    sql += " AND (code_normalized = ? OR code_printed LIKE ? OR name LIKE ? OR set_name LIKE ? OR code_normalized LIKE ?)";
    binds.push(norm, `%${q}%`, `%${q}%`, `%${q}%`, `%${norm}%`);
  }
  sql += " ORDER BY name LIMIT 40";
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  return json({ models: (rows.results || []).map(modelPublic), normalized: q ? normalizeCode(q) : "" });
}

function safeCatalogImage(url) {
  return safeExternalCatalogImage(url);
}

async function lookupCatalog(url, env) {
  const game = (url.searchParams.get("game") || "pokemon").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  const lang = (url.searchParams.get("lang") || "ITA").trim().toUpperCase();
  const allowed = new Set(["pokemon", "magic", "yugioh", "one_piece", "lorcana"]);
  if (!allowed.has(game)) return json({ hits: [] });
  try {
    const result = await lookupExternalCatalog(env, { game, q, id, lang });
    const hits = result.hits || [];
    try { await snapshotHits(env, hits); } catch (e) { /* snapshot must not hide results */ }
    return json({ hits, cached: !!result.cached, game });
  } catch (err) {
    return json({ hits: [], error: "Catalogo temporaneamente non disponibile" }, 200);
  }
}

async function findOrCreateModel(env, fields, opts) {
  const game = String(fields.game || "").trim();
  if (game && !GAMES.some((g) => g.id === game && (g.id !== "fictional_demo" || (opts && opts.allowFictional)))) {
    throw Object.assign(new Error("Gioco non valido"), { status: 400 });
  }
  const set_name = String(fields.set_name || "").trim();
  const name = String(fields.name || "").trim();
  const language = String(fields.language || "ITA").trim().toUpperCase();
  const variant = String(fields.variant || "normal").trim();
  const code_printed = canonicalPrinted(fields.code || fields.code_printed);
  const code_normalized = normalizeCode(fields.code || fields.code_printed || code_printed);
  if (!game || !set_name || !code_normalized || !name) {
    throw Object.assign(new Error("Compila gioco, set, codice e nome della carta"), { status: 400 });
  }
  if (!LANGUAGES.includes(language)) throw Object.assign(new Error("Lingua non valida"), { status: 400 });
  if (!VARIANTS.some((v) => v.id === variant)) throw Object.assign(new Error("Variante non valida"), { status: 400 });
  const existing = await env.DB.prepare(
    `SELECT * FROM card_models WHERE game = ? AND set_name = ? AND code_normalized = ? AND language = ? AND variant = ?`
  ).bind(game, set_name, code_normalized, language, variant).first();
  const catalog_image = safeCatalogImage(fields.catalog_image);
  if (existing) {
    if (catalog_image && !existing.catalog_image) {
      await env.DB.prepare("UPDATE card_models SET catalog_image = ? WHERE id = ?").bind(catalog_image, existing.id).run();
      existing.catalog_image = catalog_image;
    }
    return existing;
  }
  const id = crypto.randomUUID();
  const slug = slugify([game, set_name, code_printed, language, variant]) + "-" + id.slice(0, 6);
  const created_at = nowIso();
  await env.DB.prepare(
    `INSERT INTO card_models (id, game, set_name, set_code, code_printed, code_normalized, name, language, variant, slug, catalog_image, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, game, set_name, fields.set_code || null, code_printed, code_normalized, name.slice(0, 80), language, variant, slug, catalog_image, created_at).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO card_model_counters (card_model_id, last_serial, registered_count) VALUES (?, 0, 0)`
  ).bind(id).run();
  return await env.DB.prepare("SELECT * FROM card_models WHERE id = ?").bind(id).first();
}

async function createModel(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const model = await findOrCreateModel(env, body, { allowFictional: user.role === "admin" });
  return json({ model: modelPublic(model) });
}

/* ---------------- cards ---------------- */

async function registerCard(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  let model = null;
  if (body.model_id) {
    model = await env.DB.prepare("SELECT * FROM card_models WHERE id = ?").bind(body.model_id).first();
    if (model && model.game === "fictional_demo" && user.role !== "admin") model = null;
  }
  if (!model) model = await findOrCreateModel(env, body, { allowFictional: user.role === "admin" });
  const is_ungraded = !!body.is_ungraded || body.grader === "NONE";
  const grader = is_ungraded ? "NONE" : String(body.grader || "").trim().toUpperCase();
  if (!is_ungraded && !GRADERS.some((g) => g.id === grader && g.graded)) {
    return json({ error: "Scegli un grader valido oppure «Non gradata»" }, 400);
  }
  let certificate_no = is_ungraded ? ("RAW-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase())
    : normalizeCert(grader, body.certificate_no);
  if (!is_ungraded && certificate_no.length < 4) return json({ error: "Inserisci il numero di certificato" }, 400);
  if (!is_ungraded) {
    const dup = await env.DB.prepare("SELECT id, status FROM slabs WHERE grader = ? AND certificate_no = ?")
      .bind(grader, certificate_no).first();
    if (dup) return json({ error: "Questa lastra (grader + certificato) è già registrata su DreaMint", duplicate: true, slab_id: dup.id }, 409);
  }
  const rawPhotos = body.photos || {};
  const photos = {};
  for (const k of ["front", "back", "challenge", "cert"]) {
    const n = normalizePhotoInput(rawPhotos[k]);
    if (rawPhotos[k] && !n) return json({ error: "Formato foto non valido" }, 400);
    if (n) photos[k] = n;
  }
  if (totalPhotoChars(photos) > PHOTO_REQUEST_MAX) return json({ error: "Foto troppo pesanti in totale: comprimi e riprova" }, 413);
  if (!photos.front) return json({ error: "Carica la foto del fronte" }, 400);
  if (is_ungraded && !photos.back) return json({ error: "Per le carte non gradate serve anche la foto del retro", code: "back_photo_required" }, 400);
  const condition = is_ungraded ? String(body.condition || "").trim() : null;
  if (is_ungraded && !CONDITIONS.some((c) => c.id === condition)) {
    return json({ error: "Indica la condizione della carta (NM, EX, GD, LP, PL o Poor)" }, 400);
  }
  const kinds = ["front"].concat(photos.back ? ["back"] : []).concat(!is_ungraded && photos.challenge ? ["challenge"] : []).concat(photos.cert ? ["cert"] : []);
  for (const k of kinds) {
    if (!photos[k]) continue;
    if (photos[k].original.length > PHOTO_KV_MAX) return json({ error: "Foto troppo grande: comprimi e riprova" }, 400);
    for (const v of Object.values(photos[k].variants)) {
      if (v.length > PHOTO_KV_MAX) return json({ error: "Foto troppo grande: comprimi e riprova" }, 400);
    }
  }
  let server_seed = "";
  let client_nonce = "";
  let commit_hash = "";
  let challenge_code = null;
  if (!is_ungraded) {
    server_seed = randomHex(32);
    client_nonce = randomHex(16);
    commit_hash = await sha256Hex(server_seed);
  }
  let challengeRow = null;
  if (!is_ungraded) {
    // SECURITY (M4): the code must be one the server issued to this user, unused and not expired.
    const cid = String(body.challenge_id || "");
    challengeRow = cid ? await env.DB.prepare("SELECT * FROM challenge_codes WHERE id = ? AND user_id = ?").bind(cid, user.id).first() : null;
    const sentCode = String(body.challenge_code || "").trim().toUpperCase();
    if (!challengeRow || challengeRow.used_at || challengeRow.expires_at <= nowIso() || (sentCode && sentCode !== challengeRow.code)) {
      return json({ error: "Codice-sfida non valido o scaduto: ricarica la pagina per averne uno nuovo e rifai la foto", code: "challenge_invalid" }, 400);
    }
    if (!challengeRow.video_key) {
      return json({ error: "Carica il video-sfida: inquadra la carta nella custodia e leggi ad alta voce il codice", code: "challenge_video_required" }, 400);
    }
    challenge_code = challengeRow.code;
  }
  // Price is optional: no price = album-only card (never auto-listed; listing_blocked_reason "no_price").
  const rawPrice = body.price_euros != null ? body.price_euros : body.asking_price_euros;
  const parsedPrice = (rawPrice == null || String(rawPrice).trim() === "") ? { ok: true, cents: null } : parsePriceEuros(rawPrice);
  if (!parsedPrice.ok) return json({ error: parsedPrice.error }, 400);
  const cardmarket_avg_cents = parseCardmarketAvgCents(body);
  const id = crypto.randomUUID();
  const grade = is_ungraded ? null : (body.grade ? String(body.grade).slice(0, 20) : null);
  if (challengeRow) {
    const used = await env.DB.prepare(
      "UPDATE challenge_codes SET used_at = ?, slab_id = ? WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?"
    ).bind(nowIso(), id, challengeRow.id, user.id, nowIso()).run();
    if (!used.meta || !used.meta.changes) {
      return json({ error: "Codice-sfida già usato o scaduto: ricarica la pagina per averne uno nuovo e rifai la foto", code: "challenge_invalid" }, 400);
    }
  }
  await env.DB.prepare(
    `INSERT INTO slabs (
      id, card_model_id, submitter_id, physical_owner_id, digital_owner_id,
      grader, certificate_no, grade, is_ungraded, status,
      challenge_code, challenge_expires_at, server_seed, commit_hash, client_nonce, created_at,
      card_condition, is_test, asking_price_cents, cardmarket_avg_cents
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_review', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    id, model.id, user.id, user.id, user.id,
    grader, certificate_no, grade, is_ungraded ? 1 : 0,
    challenge_code, is_ungraded ? null : challengeRow.expires_at,
    server_seed, commit_hash, client_nonce, nowIso(),
    condition, parsedPrice.cents, cardmarket_avg_cents
  ).run();
  for (const k of kinds) {
    if (!photos[k]) continue;
    await env.PHOTOS.put(`photo:${id}:${k}`, photos[k].original);
    for (const w of PHOTO_VARIANT_WIDTHS) {
      if (photos[k].variants[w]) await env.PHOTOS.put(`photo:${id}:${k}:w${w}`, photos[k].variants[w]);
    }
  }
  await audit(env, user.id, "submit_card", "slab", id, { grader, is_ungraded, model_id: model.id });
  const slab = await loadSlab(env, id);
  const card = presentSlab(slab, user, true);
  card.photos = { front: true, back: !!photos.back, challenge: !!photos.challenge, cert: !!photos.cert };
  card.missing_back = !photos.back;
  await notifyAdminSafe(env, request, {
    subject: "DreaMint: nuova richiesta di verifica — " + ((card.model && card.model.name) || "Carta"),
    title: "Nuova richiesta di verifica.",
    cardName: card.model && card.model.name,
    setName: card.model && card.model.set_name,
    code: card.model && card.model.code_printed,
    typeLabel: card.is_ungraded ? "Non gradata" : "Gradata",
    sellerName: user.display_name,
    link: siteOrigin(request) + "/#/admin/carta/" + card.id
  });
  return json({ card }, 201);
}


async function replaceCardPhotos(request, env, id) {
  const user = await requireUser(request, env);
  const slab = await loadSlab(env, id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (!isOwner(slab, user)) return json({ error: "Non puoi modificare queste foto" }, 403);
  if (slab.status !== "in_review") return json({ error: "Puoi modificare le foto solo mentre la carta è in verifica" }, 400);
  const body = await readJson(request);
  const rawPhotos = (body && body.photos) || {};
  const photos = {};
  for (const k of ["front", "back", "challenge", "cert"]) {
    const n = normalizePhotoInput(rawPhotos[k]);
    if (rawPhotos[k] && !n) return json({ error: "Formato foto non valido" }, 400);
    if (n) photos[k] = n;
  }
  if (totalPhotoChars(photos) > PHOTO_REQUEST_MAX) return json({ error: "Foto troppo pesanti in totale: comprimi e riprova" }, 413);
  const kinds = Object.keys(photos);
  if (!kinds.length) return json({ error: "Nessuna foto da aggiornare" }, 400);
  for (const k of kinds) {
    if (photos[k].original.length > PHOTO_KV_MAX) return json({ error: "Foto troppo grande: comprimi e riprova" }, 400);
    for (const v of Object.values(photos[k].variants)) {
      if (v.length > PHOTO_KV_MAX) return json({ error: "Foto troppo grande: comprimi e riprova" }, 400);
    }
  }
  for (const k of kinds) {
    try {
      const listed = await env.PHOTOS.list({ prefix: "photo:" + id + ":" + k });
      for (const key of listed.keys || []) await env.PHOTOS.delete(key.name);
    } catch (e) { /* ignore */ }
    await env.PHOTOS.put("photo:" + id + ":" + k, photos[k].original);
    for (const w of PHOTO_VARIANT_WIDTHS) {
      if (photos[k].variants[w]) await env.PHOTOS.put("photo:" + id + ":" + k + ":w" + w, photos[k].variants[w]);
    }
  }
  await audit(env, user.id, "replace_photos", "slab", id, { kinds });
  const fresh = await loadSlab(env, id);
  const card = presentSlab(fresh, user, true);
  return json({ card: applyPhotoPresence(card, await listPhotoKinds(env, id)) });
}

// SECURITY: only real JPEG/PNG/WebP (magic bytes); MIME is rewritten from the bytes.
function normalizePhotoInput(p) {
  if (!p) return null;
  if (typeof p === "string") {
    const clean = sanitizeImageDataUrl(p);
    return clean ? { original: clean, variants: {} } : null;
  }
  if (typeof p === "object") {
    const original = sanitizeImageDataUrl(p.original);
    if (!original) return null;
    const variants = {};
    const src = p.variants || {};
    for (const w of PHOTO_VARIANT_WIDTHS) {
      const v = src[w] || src[Number(w)];
      if (!v) continue;
      const cv = sanitizeImageDataUrl(v);
      if (!cv) return null;
      variants[w] = cv;
    }
    return { original, variants };
  }
  return null;
}

function randomChallenge() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const a = crypto.getRandomValues(new Uint8Array(8));
  for (const n of a) out += chars[n % chars.length];
  return out;
}

async function loadSlab(env, id) {
  return env.DB.prepare(
    `SELECT s.*, m.game, m.set_name, m.set_code, m.code_printed, m.code_normalized, m.name AS card_name,
            m.language, m.variant, m.slug, m.catalog_image,
            c.last_serial AS model_last_serial, c.registered_count,
            po.display_name AS physical_owner_name, po.paypal_email AS physical_owner_paypal_email,
            do.display_name AS digital_owner_name,
            li.id AS listing_id, li.price_cents AS listing_price_cents,
            li.status AS listing_status, li.seller_id AS listing_seller_id
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     LEFT JOIN users po ON po.id = s.physical_owner_id
     LEFT JOIN users do ON do.id = s.digital_owner_id
     LEFT JOIN listings li ON li.slab_id = s.id AND li.status IN ('active','reserved') AND COALESCE(li.kind,'fullset') = 'fullset'
     WHERE s.id = ?`
  ).bind(id).first().then(async (slab) => {
    if (slab) await attachListings(env, [slab]);
    return slab;
  });
}

// All open listings (active / reserved / paused) of these slabs, as slab._listings.
async function attachListings(env, slabs) {
  const ids = slabs.filter((x) => x && !x.is_ungraded).map((x) => x.id);
  for (const x of slabs) if (x) x._listings = [];
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const rows = await env.DB.prepare(
      `SELECT id, slab_id, seller_id, kind, price_cents, status, reserved_sale_id FROM listings
       WHERE slab_id IN (${part.map(() => "?").join(",")}) AND status IN ('active','reserved','paused')
       ORDER BY created_at`
    ).bind(...part).all();
    for (const r of rows.results || []) {
      const x = slabs.find((y) => y && y.id === r.slab_id);
      if (x) x._listings.push(r);
    }
  }
}

// Market view of a graded card (two markets). Prices of open listings are public; configured prices
// and the per-kind permissions only for the viewer who owns that part.
function presentMarket(slab, user) {
  if (slab.is_ungraded) return null;
  const uid = user && user.id;
  const split = !!(slab.physical_owner_id && slab.digital_owner_id && slab.physical_owner_id !== slab.digital_owner_id);
  const reviewed = slab.status !== "in_review" && slab.status !== "rejected";
  const listings = (slab._listings || []).map((l) => ({
    id: l.id, kind: effectiveKind(l.kind), price_cents: l.price_cents, status: l.status, mine: !!(uid && l.seller_id === uid)
  }));
  const active = (k) => listings.find((l) => l.kind === k && l.status === "active");
  const open = !!(slab.opened_at && reviewed && !slab.archived_at);
  const can = (k) => !!(open && uid && canSellKind(slab, uid, k));
  const own = (k) => !!(uid && canSellKind(slab, uid, k));
  return {
    full_set: !split && reviewed && !!slab.physical_owner_id,
    digital_owned_by_other: split,           // «La copia digitale di questa carta appartiene a un altro collezionista»
    physical_only_available: !!active("physical"), // badge «Disponibile solo carta fisica»
    digital_available: !!active("digital"),
    fullset_available: !!active("fullset"),
    listings,
    price_fullset_cents: own("fullset") ? (slab.asking_price_cents || null) : (active("fullset") ? active("fullset").price_cents : null),
    price_digital_cents: own("digital") ? (slab.price_digital_cents || null) : (active("digital") ? active("digital").price_cents : null),
    price_physical_cents: own("physical") ? (slab.price_physical_cents || null) : (active("physical") ? active("physical").price_cents : null),
    can_set_fullset: can("fullset"),
    can_set_digital: can("digital"),
    can_set_physical: can("physical")
  };
}

function isOwner(slab, user) {
  if (!user) return false;
  // SECURITY (M8): only current owners (digital owner counts only for graded cards), never the past submitter.
  return user.id === slab.physical_owner_id || (!slab.is_ungraded && user.id === slab.digital_owner_id) || user.role === "admin";
}

function fullSetState(slab) {
  if (slab.is_ungraded) return "none";
  if (slab.physical_owner_id && slab.physical_owner_id === slab.digital_owner_id) {
    if (slab.status === "in_transit") return "transferring";
    if (slab.status === "in_review" || slab.status === "rejected") return "none";
    return "yes";
  }
  return "no";
}


async function listPhotoKinds(env, id) {
  try {
    const listed = await env.PHOTOS.list({ prefix: "photo:" + id + ":" });
    const names = (listed.keys || []).map((k) => k.name);
    const has = (kind) => names.some((n) => n === "photo:" + id + ":" + kind || n.startsWith("photo:" + id + ":" + kind + ":"));
    return { front: has("front"), back: has("back"), challenge: has("challenge"), cert: has("cert") };
  } catch (e) {
    return { front: true, back: true, challenge: false, cert: false };
  }
}

function applyPhotoPresence(card, presence) {
  const prev = card.photos || {};
  card.photos = {
    front: !!presence.front,
    back: !!presence.back,
    challenge: !!(prev.challenge && presence.challenge),
    cert: !!(prev.cert && presence.cert)
  };
  card.missing_back = !presence.back;
  return card;
}

function presentSlab(slab, user, includePrivate) {
  const opened = !!slab.opened_at;
  const admin = user && user.role === "admin";
  const owner = isOwner(slab, user);
  const showFair = opened || admin;
  const showResult = opened || admin;
  return {
    id: slab.id,
    model: {
      id: slab.card_model_id,
      game: slab.game,
      set_name: slab.set_name,
      set_code: slab.set_code || "",
      code_printed: slab.code_printed,
      code_normalized: slab.code_normalized || "",
      name: slab.card_name,
      language: slab.language,
      variant: slab.variant,
      slug: slab.slug,
      registered_count: slab.registered_count || 0,
      catalog_image: slab.catalog_image || null
    },
    catalog_image: slab.is_ungraded ? null : (slab.catalog_image || null),
    grader: slab.grader,
    certificate_no: slab.is_ungraded ? null : slab.certificate_no,
    raw_id: slab.is_ungraded ? slab.certificate_no : null,
    grade: slab.grade,
    is_ungraded: !!slab.is_ungraded,
    is_test: !!slab.is_test,
    card_condition: slab.card_condition || null,
    status: slab.status,
    rejection_reason: slab.rejection_reason,
    rarity_tier: (!slab.is_ungraded && showResult) ? slab.rarity_tier : null,
    rarity_label: (!slab.is_ungraded && showResult && slab.rarity_tier) ? TIER_LABELS[slab.rarity_tier] : null,
    serial_number: (!slab.is_ungraded && showResult) ? slab.serial_number : null,
    serial_total: slab.is_ungraded ? null : serialTotalFor(slab),
    assigned_at: slab.is_ungraded && !(owner || admin) ? null : slab.assigned_at,
    opened_at: slab.opened_at,
    created_at: slab.created_at,
    commit_hash: slab.is_ungraded ? null : (slab.status !== "in_review" && slab.status !== "rejected" ? slab.commit_hash : (owner || admin ? slab.commit_hash : null)),
    client_nonce: slab.is_ungraded ? null : (showFair ? slab.client_nonce : (owner && slab.status !== "rejected" ? slab.client_nonce : null)),
    server_seed: (!slab.is_ungraded && showFair) ? slab.server_seed : null,
    digest: (!slab.is_ungraded && showFair) ? slab.digest : null,
    roll: (!slab.is_ungraded && showFair) ? slab.roll : null,
    cert_key: slab.is_ungraded ? null : `${slab.grader}-${slab.certificate_no}`,
    full_set: fullSetState(slab),
    // Privacy (B7): internal user UUIDs only to that user or an admin; others get the public name.
    physical_owner_id: (admin || (user && user.id === slab.physical_owner_id)) ? slab.physical_owner_id : null,
    digital_owner_id: (admin || (!slab.is_ungraded && user && user.id === slab.digital_owner_id)) ? slab.digital_owner_id : null,
    physical_owner_name: slab.physical_owner_name,
    // Ungraded cards have no digital copy: never expose digital owner data for them.
    digital_owner_name: slab.is_ungraded ? null : slab.digital_owner_name,
    challenge_code: owner || admin ? slab.challenge_code : null,
    photos: {
      front: true,
      back: true,
      challenge: !!(owner || admin),
      cert: !slab.is_ungraded
    },
    can_open: !!( !slab.is_ungraded && owner && slab.status !== "in_review" && slab.status !== "rejected" && slab.rarity_tier && !slab.opened_at),
    can_replay: !!( !slab.is_ungraded && owner && slab.opened_at),
    archived_at: (owner || admin) ? (slab.archived_at || null) : undefined,
    can_archive: (user && user.id === slab.physical_owner_id)
      ? !!(slab.is_ungraded && !slab.archived_at && !slab.listing_id)
      : undefined,
    // Owner / admin only: why maybeAutoList did not put the card on sale (see lib/listing-status.js).
    listing_blocked_reason: (admin || (user && user.id === slab.physical_owner_id))
      ? listingBlockedReason(slab, user && user.id === slab.physical_owner_id ? user.paypal_email : slab.physical_owner_paypal_email)
      : undefined,
    can_list: !!(owner && !slab.archived_at && slab.status === "approved" && slab.physical_owner_id === user?.id && (slab.is_ungraded || (slab.opened_at && slab.digital_owner_id === user?.id))),
    can_update_photos: !!(owner && slab.status === "in_review"),
    market: presentMarket(slab, user),
    asking_price_cents: (owner || admin || includePrivate) ? (slab.asking_price_cents || null) : null,
    cardmarket_avg_cents: slab.cardmarket_avg_cents || null,
    listing_id: slab.listing_id || null,
    listing_price_cents: slab.listing_price_cents || null,
    listing_status: slab.listing_status || null,
    can_edit_price: !!(owner && user && !slab.archived_at && (
      (slab.listing_id && slab.listing_status === "active" && slab.listing_seller_id === user.id) ||
      (["in_review", "approved"].includes(slab.status) && slab.physical_owner_id === user.id)
    ))
  };
}

async function myCards(request, env) {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT s.*, m.game, m.set_name, m.code_printed, m.code_normalized, m.name AS card_name,
            m.language, m.variant, m.slug, m.catalog_image, c.registered_count,
            po.display_name AS physical_owner_name, do.display_name AS digital_owner_name,
            li.id AS listing_id, li.price_cents AS listing_price_cents,
            li.status AS listing_status, li.seller_id AS listing_seller_id
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     LEFT JOIN users po ON po.id = s.physical_owner_id
     LEFT JOIN users do ON do.id = s.digital_owner_id
     LEFT JOIN listings li ON li.slab_id = s.id AND li.status IN ('active','reserved') AND COALESCE(li.kind,'fullset') = 'fullset'
     WHERE (s.physical_owner_id = ? OR (s.is_ungraded = 0 AND s.digital_owner_id = ?) OR (s.submitter_id = ? AND 0))
       AND s.archived_at IS NULL
     ORDER BY s.created_at DESC`
  ).bind(user.id, user.id, user.id).all();
  const list = rows.results || [];
  await attachListings(env, list);
  return json({ cards: list.map((s) => presentSlab(s, user, true)) });
}

// «Ho venduto fuori da DreaMint»: soft archive of an ungraded card by its owner. Nothing is deleted;
// the card leaves the album and can no longer be listed. Refused while a listing or a sale is open.
async function archiveCard(request, env, id) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const slab = await env.DB.prepare("SELECT * FROM slabs WHERE id = ?").bind(id).first();
  if (!slab || slab.physical_owner_id !== user.id) return json({ error: "Carta non trovata" }, 404);
  if (!slab.is_ungraded) return json({ error: "Per una carta gradata usa il trasferimento con codice" }, 400);
  if (slab.archived_at) return json({ error: "Carta già archiviata" }, 409);
  const reason = String((body && body.reason) || "sold_outside").trim().slice(0, 40) || "sold_outside";
  const at = nowIso();
  const open = "NOT EXISTS (SELECT 1 FROM listings WHERE slab_id = ? AND status IN ('active','reserved'))" +
    " AND NOT EXISTS (SELECT 1 FROM sales WHERE slab_id = ? AND status IN ('requested','accepted','paid','shipped'))";
  const ok = "EXISTS (SELECT 1 FROM slabs WHERE id = ? AND archived_at = ? AND physical_owner_id = ?)";
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE slabs SET archived_at = ?, archived_reason = ?
       WHERE id = ? AND physical_owner_id = ? AND archived_at IS NULL AND ` + open
    ).bind(at, reason, id, user.id, id, id),
    env.DB.prepare(
      `INSERT INTO slab_owner_history (id, slab_id, from_user_id, to_user_id, reason, sale_id, created_at)
       SELECT ?, ?, ?, NULL, 'sold_outside', NULL, ? WHERE ` + ok
    ).bind(crypto.randomUUID(), id, user.id, at, id, at, user.id),
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, payload, created_at)
       SELECT ?, ?, 'archive_sold_outside', 'slab', ?, ?, ? WHERE ` + ok
    ).bind(crypto.randomUUID(), user.id, id, JSON.stringify({ reason }), at, id, at, user.id)
  ]);
  if (!res[0].meta || !res[0].meta.changes) {
    return json({ error: "C’è un annuncio o una vendita in corso su questa carta: chiudili prima di archiviarla" }, 409);
  }
  return json({ ok: true, archived_at: at });
}

async function getCard(request, env, id) {
  const user = await getUser(request, env);
  const slab = await loadSlab(env, id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  const priv = isOwner(slab, user);
  // SECURITY (M2): cards in review / rejected are visible only to the owner or an admin.
  if (!priv && (slab.status === "in_review" || slab.status === "rejected")) return json({ error: "Carta non trovata" }, 404);
  const card = presentSlab(slab, user, priv);
  if (!slab.is_ungraded && (priv || (user && user.role === "admin"))) {
    const vr = await challengeVideoRow(env, id);
    card.challenge_video = !!(vr && (user.role === "admin" || vr.user_id === user.id));
  }
  try { await maybeRefreshModelPrice(env, card.model); } catch (e) { /* ignore */ }
  return json({ card: applyPhotoPresence(card, await listPhotoKinds(env, id)) });
}

async function publicCard(env, id) {
  const slab = await loadSlab(env, id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (slab.status === "in_review" || slab.status === "rejected") {
    return json({ error: "Questa carta non è pubblica" }, 404);
  }
  const card = presentSlab(slab, null, false);
  try { await maybeRefreshModelPrice(env, card.model); } catch (e) { /* ignore */ }
  return json({ card: applyPhotoPresence(card, await listPhotoKinds(env, id)) });
}

async function servePhoto(request, env, slabId, kind, url) {
  const allowed = ["front", "back", "challenge", "cert"];
  if (!allowed.includes(kind)) return json({ error: "Foto sconosciuta" }, 404);
  const user = await getUser(request, env);
  const slab = await loadSlab(env, slabId);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  const owner = isOwner(slab, user);
  const admin = user && user.role === "admin";
  const publicKind = (kind === "front" || kind === "back" || kind === "cert") && slab.status !== "in_review" && slab.status !== "rejected";
  if (!publicKind && !owner && !admin) return json({ error: "Foto non disponibile" }, 403);
  const w = url ? String(url.searchParams.get("w") || "") : "";
  let data = null;
  if (w && PHOTO_VARIANT_WIDTHS.includes(w)) {
    data = await env.PHOTOS.get(`photo:${slabId}:${kind}:w${w}`);
  }
  if (!data) data = await env.PHOTOS.get(`photo:${slabId}:${kind}`);
  if (!data) return json({ error: "Foto non presente" }, 404);
  const parsed = parseImageDataUrl(data);
  if (!parsed) return json({ error: "Foto non valida" }, 415);
  return safeImageResponse(parsed.bin, {
    "cache-control": publicKind ? "public, max-age=3600" : "private, max-age=300",
    ...(publicKind ? { "access-control-allow-origin": "*" } : {})
  });
}

async function listRecent(env) {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.grader, s.grade, s.is_ungraded, s.is_test, s.card_condition, s.status, s.created_at,
            m.game, m.set_name, m.code_printed, m.name AS card_name, m.language, m.catalog_image
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     WHERE s.status IN ('approved', 'listed') AND s.is_test = 0
     ORDER BY s.created_at DESC
     LIMIT 12`
  ).all();
  return json({
    items: (rows.results || []).map((r) => ({
      id: r.id,
      game: r.game,
      language: r.language,
      set_name: r.set_name,
      card_name: r.card_name,
      code_printed: r.code_printed,
      grader: r.grader,
      grade: r.grade,
      is_ungraded: !!r.is_ungraded,
      card_condition: r.card_condition || null,
      created_at: r.created_at,
      catalog_image: r.catalog_image || null
    }))
  });
}

async function openCard(request, env, id) {
  const user = await requireUser(request, env);
  const slab = await loadSlab(env, id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (!isOwner(slab, user)) return json({ error: "Non puoi aprire questa carta" }, 403);
  if (slab.is_ungraded) return json({ error: "Le carte non gradate non hanno copia digitale né estrazione di rarità" }, 400);
  if (slab.status === "in_review") return json({ error: "La carta è ancora in verifica" }, 400);
  if (slab.status === "rejected") return json({ error: "Questa registrazione è stata rifiutata" }, 400);
  if (!slab.rarity_tier) return json({ error: "Estrazione non ancora assegnata" }, 400);
  if (!slab.opened_at) {
    await env.DB.prepare("UPDATE slabs SET opened_at = ? WHERE id = ? AND opened_at IS NULL")
      .bind(nowIso(), id).run();
  }
  let fresh = await loadSlab(env, id);
  await maybeAutoList(env, fresh);
  fresh = await loadSlab(env, id);
  return json({ card: presentSlab(fresh, user, true), replay: !!slab.opened_at });
}

/* ---------------- marketplace ---------------- */

async function listMarket(url, env) {
  const section = (url.searchParams.get("section") || "").toLowerCase();
  let extra = "";
  if (section === "ungraded" || section === "non_gradate" || section === "raw") extra = " AND s.is_ungraded = 1";
  else if (section === "graded" || section === "gradate") extra = " AND s.is_ungraded = 0";
  const rows = await env.DB.prepare(
    `SELECT l.*, s.grader, s.grade, s.is_ungraded, s.is_test, s.card_condition, s.rarity_tier, s.serial_number, s.serial_total_at_assignment, s.opened_at,
            s.certificate_no, s.cardmarket_avg_cents, m.game, m.set_name, m.set_code, m.code_printed, m.code_normalized, m.name AS card_name, m.catalog_image,
            m.language, m.variant, u.display_name AS seller_name, c.registered_count,
            (s.physical_owner_id <> s.digital_owner_id) AS split_owners
     FROM listings l
     JOIN slabs s ON s.id = l.slab_id
     JOIN card_models m ON m.id = s.card_model_id
     JOIN users u ON u.id = l.seller_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     WHERE l.status = 'active' AND ` + listingValidSql("l") + extra + `
     ORDER BY l.created_at DESC
     LIMIT 100`
  ).all();
  const listings = (rows.results || []).map((r) => ({
      id: r.id,
      slab_id: r.slab_id,
      kind: r.is_ungraded ? "ungraded" : effectiveKind(r.kind),
      digital_owned_by_other: r.is_ungraded ? false : !!r.split_owners,
      price_cents: r.price_cents,
      shipping_note: r.shipping_note,
      created_at: r.created_at,
      seller_name: r.seller_name,
      grader: r.grader,
      grade: r.grade,
      is_ungraded: !!r.is_ungraded,
      is_test: !!r.is_test,
      card_condition: r.card_condition || null,
      rarity_tier: r.is_ungraded ? null : r.rarity_tier,
      rarity_label: r.is_ungraded ? null : TIER_LABELS[r.rarity_tier],
      serial_number: r.is_ungraded ? null : r.serial_number,
      serial_total: r.is_ungraded ? null : serialTotalFor(r),
      card_name: r.card_name,
      set_name: r.set_name,
      code_printed: r.code_printed,
      language: r.language,
      variant: r.variant,
      game: r.game,
      catalog_image: r.is_ungraded ? null : (r.catalog_image || null),
      cardmarket_avg_cents: r.cardmarket_avg_cents || null,
      set_code: r.set_code || null,
      code_normalized: r.code_normalized || null
    }));
  let withTrends = listings;
  try { withTrends = await attachTrendsToListings(env, listings); } catch (e) { withTrends = listings; }
  return json({ listings: withTrends });
}

async function createListing(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const slab = await loadSlab(env, body.slab_id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (slab.physical_owner_id !== user.id) {
    return json({ error: "Puoi vendere solo una carta che possiedi" }, 403);
  }
  if (!slab.is_ungraded && slab.digital_owner_id !== user.id) {
    return json({ error: "Puoi vendere solo un bundle che possiedi per intero (Full Set)" }, 403);
  }
  if (!slab.is_ungraded && !slab.opened_at) return json({ error: "Apri prima l'estrazione della rarità" }, 400);
  if (!(slab.status === "approved" || (!slab.is_ungraded && slab.status === "listed")) || slab.archived_at) return json({ error: "Questa carta non può essere messa in vendita ora" }, 400);
  if (!isValidPaypalEmail(user.paypal_email)) {
    return json({ error: "Aggiungi l’email PayPal nel profilo prima di vendere" }, 400);
  }
  const existing = await env.DB.prepare(
    "SELECT id, price_cents, status FROM listings WHERE slab_id = ? AND status IN ('active','reserved','paused') AND (COALESCE(kind,'fullset') = 'fullset' OR status = 'reserved') ORDER BY created_at DESC LIMIT 1"
  ).bind(slab.id).first();
  if (existing) return json({ error: "Questa carta è già in vendita", listing: existing }, 409);
  let price_cents;
  if (body.price_euros != null && body.price_euros !== "") {
    const parsed = parsePriceEuros(body.price_euros);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    price_cents = parsed.cents;
  } else if (Number(slab.asking_price_cents) > 0) {
    price_cents = Number(slab.asking_price_cents);
  } else {
    return json({ error: "Indica un prezzo di vendita in euro maggiore di zero" }, 400);
  }
  const id = crypto.randomUUID();
  const ins = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO listings (id, slab_id, seller_id, price_cents, shipping_note, status, created_at, kind)
       SELECT ?, ?, ?, ?, ?, 'active', ?, ? WHERE EXISTS (SELECT 1 FROM slabs WHERE id = ? AND archived_at IS NULL)`
    ).bind(id, slab.id, user.id, price_cents, String(body.shipping_note || "").slice(0, 400), nowIso(), slab.is_ungraded ? null : "fullset", slab.id),
    env.DB.prepare("UPDATE slabs SET status = 'listed', asking_price_cents = ? WHERE id = ? AND archived_at IS NULL").bind(price_cents, slab.id)
  ]);
  if (!ins[0].meta || !ins[0].meta.changes) return json({ error: "Questa carta non può essere messa in vendita ora" }, 400);
  return json({ listing: { id, slab_id: slab.id, price_cents, status: "active" } }, 201);
}

async function updateListingPrice(request, env, listingId) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const listing = await env.DB.prepare("SELECT * FROM listings WHERE id = ?").bind(listingId).first();
  if (!listing) return json({ error: "Annuncio non trovato" }, 404);
  if (listing.seller_id !== user.id) return json({ error: "Puoi modificare solo i tuoi annunci" }, 403);
  if (listing.status !== "active") return json({ error: "Questo annuncio non si può più modificare" }, 400);
  const parsed = parsePriceEuros(body.price_euros);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE listings SET price_cents = ? WHERE id = ? AND status = 'active'").bind(parsed.cents, listing.id),
    env.DB.prepare("UPDATE slabs SET " + PRICE_COLUMN[effectiveKind(listing.kind)] + " = ? WHERE id = ?").bind(parsed.cents, listing.slab_id)
  ]);
  await audit(env, user.id, "update_listing_price", "listing", listing.id, { price_cents: parsed.cents });
  return json({ listing: { id: listing.id, slab_id: listing.slab_id, price_cents: parsed.cents, status: listing.status } });
}

async function updateCardPrice(request, env, id) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const slab = await env.DB.prepare("SELECT * FROM slabs WHERE id = ?").bind(id).first();
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (slab.physical_owner_id !== user.id) return json({ error: "Puoi modificare solo una carta che possiedi" }, 403);
  if (slab.archived_at || !["in_review", "approved", "listed"].includes(slab.status)) {
    return json({ error: "Il prezzo non si può modificare in questo stato" }, 400);
  }
  if (!slab.is_ungraded && slab.digital_owner_id !== user.id) {
    return json({ error: "La copia digitale appartiene a un altro collezionista: usa il prezzo «Solo carta fisica»", code: "not_full_set" }, 400);
  }
  const parsed = parsePriceEuros(body.price_euros);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  await env.DB.prepare("UPDATE slabs SET asking_price_cents = ? WHERE id = ?").bind(parsed.cents, slab.id).run();
  const listing = await env.DB.prepare(
    "SELECT * FROM listings WHERE slab_id = ? AND status = 'active' AND COALESCE(kind,'fullset') = 'fullset'"
  ).bind(slab.id).first();
  if (listing) {
    if (listing.seller_id !== user.id) return json({ error: "Non puoi modificare questo annuncio" }, 403);
    await env.DB.prepare("UPDATE listings SET price_cents = ? WHERE id = ? AND status = 'active'").bind(parsed.cents, listing.id).run();
  }
  await audit(env, user.id, "update_asking_price", "slab", slab.id, { price_cents: parsed.cents, listing_id: listing && listing.id });
  const fresh = await loadSlab(env, slab.id);
  return json({ card: presentSlab(fresh, user, true), listing: listing ? { id: listing.id, price_cents: parsed.cents, status: "active" } : null });
}


async function requestBuy(request, env, listingId) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const listing = await env.DB.prepare("SELECT * FROM listings WHERE id = ?").bind(listingId).first();
  if (!listing || listing.status !== "active") return json({ error: "Annuncio non disponibile" }, 404);
  if (listing.seller_id === user.id) return json({ error: "Non puoi acquistare un tuo annuncio" }, 400);
  const existing = await env.DB.prepare(
    "SELECT id FROM sales WHERE listing_id = ? AND buyer_id = ? AND status IN ('requested','accepted','paid','shipped')"
  ).bind(listingId, user.id).first();
  if (existing) return json({ error: "Hai già una richiesta aperta su questo annuncio", sale_id: existing.id }, 409);
  const valid = await env.DB.prepare("SELECT 1 AS ok FROM listings WHERE id = ? AND " + listingValidSql("listings")).bind(listing.id).first();
  if (!valid) return json({ error: "Annuncio non disponibile" }, 404);
  const kind = listing.kind ? effectiveKind(listing.kind) : null;
  // «Solo digitale»: nothing is shipped.
  const ship = kind === "digital"
    ? { ok: true, method_id: null, shipping_cents: 0, insurance: 0, insurance_cents: 0, total_cents: listing.price_cents, dest_json: null }
    : parseShippingChoice(body, listing.price_cents);
  if (!ship.ok) return json({ error: ship.error }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sales (id, listing_id, slab_id, seller_id, buyer_id, price_cents, message, contact, status, created_at,
                        shipping_method, shipping_cents, insurance, insurance_cents, total_cents, shipping_dest, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, listing.id, listing.slab_id, listing.seller_id, user.id, listing.price_cents,
    String(body.message || "").slice(0, 500),
    String(body.contact || "").slice(0, 200),
    nowIso(),
    ship.method_id,
    ship.shipping_cents,
    ship.insurance,
    ship.insurance_cents,
    ship.total_cents,
    ship.dest_json,
    kind
  ).run();
  try {
    const info = await env.DB.prepare(
      `SELECT m.name AS card_name, m.set_name, m.code_printed, sl.is_ungraded,
              seller.display_name AS seller_name
       FROM listings l
       JOIN slabs sl ON sl.id = l.slab_id
       JOIN card_models m ON m.id = sl.card_model_id
       JOIN users seller ON seller.id = l.seller_id
       WHERE l.id = ?`
    ).bind(listing.id).first();
    await notifyAdminSafe(env, request, {
      subject: "DreaMint: nuova richiesta di acquisto — " + ((info && info.card_name) || "Carta"),
      title: "Nuova richiesta di acquisto.",
      cardName: info && info.card_name,
      setName: info && info.set_name,
      code: info && info.code_printed,
      typeLabel: info && info.is_ungraded ? "Non gradata" : "Gradata",
      sellerName: info && info.seller_name,
      buyerName: user.display_name,
      amount: formatEuros(ship.total_cents),
      link: siteOrigin(request) + "/#/vendite"
    });
  } catch (e) { /* notify must not block the request */ }
  return json({ sale: { id, listing_id: listingId, status: "requested", kind: kind || "fullset" } }, 201);
}

function presentSale(r, viewer) {
  const ship = presentShipping(r, viewer || null);
  return {
    id: r.id,
    listing_id: r.listing_id,
    kind: effectiveKind(r.kind),
    slab_id: r.slab_id,
    seller_id: r.seller_id,
    buyer_id: r.buyer_id,
    seller_name: r.seller_name,
    buyer_name: r.buyer_name,
    price_cents: r.price_cents,
    message: r.message,
    contact: r.contact,
    status: r.status,
    tracking: ship.tracking,
    tracking_url: ship.tracking_url,
    created_at: r.created_at,
    shipped_at: r.shipped_at,
    received_at: r.received_at,
    paid_at: r.paid_at || null,
    paypal_txn_id: r.paypal_txn_id || null,
    seller_paypal_email: r.seller_paypal_email || r.paypal_email || null,
    card_name: r.card_name,
    code_printed: r.code_printed,
    grader: r.grader,
    rarity_tier: r.rarity_tier,
    serial_number: r.serial_number,
    shipping_method: ship.shipping_method,
    shipping_label: ship.shipping_label,
    shipping_short_label: ship.shipping_short_label,
    shipping_carrier: ship.shipping_carrier,
    shipping_cents: ship.shipping_cents,
    insurance: ship.insurance,
    insurance_cents: ship.insurance_cents,
    total_cents: ship.total_cents,
    label_url: ship.label_url || null,
    label_label: ship.label_label || null,
    shipping_dest: ship.shipping_dest || null,
    shipping_dest_text: ship.shipping_dest_text || null
  };
}

async function mySales(request, env) {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT sa.*, sl.grader, sl.rarity_tier, sl.serial_number,
            m.name AS card_name, m.code_printed,
            seller.display_name AS seller_name, buyer.display_name AS buyer_name,
            seller.paypal_email AS seller_paypal_email
     FROM sales sa
     JOIN slabs sl ON sl.id = sa.slab_id
     JOIN card_models m ON m.id = sl.card_model_id
     JOIN users seller ON seller.id = sa.seller_id
     JOIN users buyer ON buyer.id = sa.buyer_id
     WHERE sa.seller_id = ? OR sa.buyer_id = ?
     ORDER BY sa.created_at DESC`
  ).bind(user.id, user.id).all();
  const days = Number(env.PAYPAL_AUTOCOMPLETE_DAYS || 14);
  const now = Date.now();
  for (const row of rows.results || []) {
    if (shouldAutoComplete(row, now, days)) {
      if (await completeSaleTransfer(env, row, user.id, "auto_receive")) {
        row.status = "completed";
        row.received_at = nowIso();
        await notifyDigitalOwnerTransferCode(env, request, { sendNotifyEmail }, row.slab_id);
      }
    }
  }
  const origin = new URL(request.url).origin;
  const mode = paypalMode(env);
  return json({
    sales: (rows.results || []).map((r) => {
      const sale = presentSale(r, user);
      const unpaid = canMarkPaid(r.status);
      sale.paypal_mode = mode;
      sale.paypal_checkout_url = (unpaid && r.seller_paypal_email && mode === "wps")
        ? buildWpsCheckoutUrl({
            env,
            sellerEmail: r.seller_paypal_email,
            saleId: r.id,
            amountCents: payableCents(r),
            itemName: r.card_name || "Carta DreaMint",
            returnUrl: origin + "/#/vendite",
            cancelUrl: origin + "/#/vendite",
            notifyUrl: origin + "/api/paypal/ipn"
          })
        : "";
      return sale;
    })
  });
}

async function saleAction(request, env, saleId, action) {
  const user = await requireUser(request, env);
  const sale = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(saleId).first();
  if (!sale) return json({ error: "Richiesta non trovata" }, 404);
  const body = request.headers.get("content-type")?.includes("json") ? await readJson(request).catch(() => ({})) : {};

  if (action === "cancel") {
    if (user.id !== sale.buyer_id && user.id !== sale.seller_id && user.role !== "admin") {
      return json({ error: "Non puoi annullare questa richiesta" }, 403);
    }
    if (!["requested", "accepted"].includes(sale.status)) {
      return json({ error: "Questa vendita non si può più annullare da qui" }, 400);
    }
    // SECURITY (A3): cancelling the sale that holds the listing releases it atomically.
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ? AND status IN ('requested','accepted')").bind(saleId),
      releaseListingStmt(env, sale.listing_id, saleId),
      ...resumePausedStmts(env, saleId, "EXISTS (SELECT 1 FROM sales WHERE id = ? AND status = 'cancelled')", [saleId])
    ]);
    if (!res[0].meta || res[0].meta.changes !== 1) return json({ error: "Questa vendita non si può più annullare da qui" }, 409);
    await audit(env, user.id, "sale_cancelled", "sale", saleId, { released: !!(res[1].meta && res[1].meta.changes) });
    return json({ ok: true });
  }

  if (action === "accept") {
    if (user.id !== sale.seller_id) return json({ error: "Solo il venditore può accettare" }, 403);
    if (sale.status !== "requested") return json({ error: "Questa richiesta non è in attesa" }, 400);
    // No reservation: accepting does not lock the listing or pause the other market.
    // The listing stays active until a payment is confirmed (markSalePaid / PayPal).
    const res = await env.DB.prepare(
      `UPDATE sales SET status = 'accepted' WHERE id = ? AND status = 'requested'
         AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'active' AND ` + listingValidSql("listings") + `)`
    ).bind(saleId, sale.listing_id).run();
    if (!res.meta || res.meta.changes !== 1) {
      return json({ error: "Annuncio non più disponibile" }, 409);
    }
    return json({ ok: true, status: "accepted" });
  }

  if (action === "mark-paid") {
    if (user.id !== sale.seller_id) return json({ error: "Solo il venditore può confermare il pagamento" }, 403);
    if (!canMarkPaid(sale.status)) return json({ error: "Questa vendita non è in attesa di pagamento" }, 400);
    const marked = await markSalePaid(env, sale, "", "", { manual: true, source: "seller" }, user.id, request);
    if (!marked.ok) return json({ error: marked.reason || "Annuncio già riservato a un altro acquirente" }, 409);
    await audit(env, user.id, "sale_marked_paid", "sale", saleId, { manual: true });
    await notifySalePaid(env, request, sale, "Pagamento confermato dal venditore.");
    return json({ ok: true, status: marked.completed ? "completed" : "paid", transferred: !!marked.completed });
  }

  if (action === "ship") {
    if (user.id !== sale.seller_id) return json({ error: "Solo il venditore può segnare la spedizione" }, 403);
    if (sale.kind === "digital") return json({ error: "La copia digitale non si spedisce: passa al compratore con la conferma del pagamento", code: "digital_not_shipped" }, 400);
    if (!canShip(sale.status)) return json({ error: "Conferma prima il pagamento, poi spedisci" }, 400);
    const tracking = String((body && body.tracking) || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (sale.shipping_method && tracking.length < 5) {
      return json({ error: "Incolla il codice di tracking ricevuto dal corriere" }, 400);
    }
    const trackUrl = trackingUrl(sale.shipping_method, tracking);
    const shippedAt = nowIso();
    const res = await env.DB.batch([
      env.DB.prepare(
        `UPDATE sales SET status = 'shipped', tracking = ?, tracking_url = ?, shipped_at = ?
         WHERE id = ? AND status = 'paid'
           AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'reserved' AND reserved_sale_id = ?)`
      ).bind(tracking, trackUrl, shippedAt, saleId, sale.listing_id, saleId),
      env.DB.prepare(
        "UPDATE slabs SET status = 'in_transit' WHERE id = ? AND EXISTS (SELECT 1 FROM sales WHERE id = ? AND status = 'shipped' AND shipped_at = ?)"
      ).bind(sale.slab_id, saleId, shippedAt)
    ]);
    if (!res[0].meta || res[0].meta.changes !== 1) return json({ error: "Questa vendita non si può spedire (pagamento o prenotazione mancanti)" }, 409);
    await audit(env, user.id, "sale_shipped", "sale", saleId, { tracking, tracking_url: trackUrl });
    sale.tracking = tracking;
    sale.tracking_url = trackUrl;
    sale.status = "shipped";
    sale.shipped_at = nowIso();
    await notifySaleShipped(env, request, sale, tracking, trackUrl);
    return json({ ok: true, status: "shipped", tracking, tracking_url: trackUrl });
  }

  if (action === "receive") {
    if (user.id !== sale.buyer_id) return json({ error: "Solo l'acquirente può confermare la ricezione" }, 403);
    if (sale.status !== "shipped") return json({ error: "Il venditore deve prima segnare la spedizione" }, 400);
    const done = await completeSaleTransfer(env, sale, user.id, "sale_received");
    if (!done) return json({ error: "Questa vendita non è più in spedizione" }, 409);
    await notifyDigitalOwnerTransferCode(env, request, { sendNotifyEmail }, sale.slab_id);
    return json({ ok: true, status: "completed", transferred: true });
  }

  return json({ error: "Azione sconosciuta" }, 400);
}

/* ---------------- admin ---------------- */

async function adminNotifyTest(request, env) {
  await requireAdmin(request, env);
  const result = await sendNotifyEmail(env, {
    subject: "DreaMint · email di prova avvisi",
    text: "Questa è un'email di prova degli avvisi DreaMint.\n\nSe la ricevi, le notifiche di verifica, richieste di acquisto e pagamenti arriveranno a questo indirizzo.\n\nApri: " + siteOrigin(request) + "/#/admin"
  });
  return json({
    ok: !!result.ok,
    skipped: !!result.skipped,
    status: result.status || null,
    id: result.id || null,
    provider: result.provider || null,
    error: result.error || null
  });
}

async function adminQueue(request, env) {
  await requireAdmin(request, env);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.status, s.grader, s.certificate_no, s.grade, s.is_ungraded, s.created_at,
            s.challenge_code, s.asking_price_cents, s.cardmarket_avg_cents, s.card_condition,
            m.name AS card_name, m.code_printed, m.set_name, m.language, m.variant, m.game,
            u.display_name, u.email
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     JOIN users u ON u.id = s.submitter_id
     WHERE s.status = 'in_review'
     ORDER BY s.created_at ASC`
  ).all();
  const items = [];
  for (const it of rows.results || []) {
    const presence = await listPhotoKinds(env, it.id);
    it.missing_back = !presence.back;
    it.photos = presence;
    items.push(it);
  }
  return json({ items });
}

async function adminCard(request, env, id) {
  const admin = await requireAdmin(request, env);
  const slab = await loadSlab(env, id);
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  const card = presentSlab(slab, admin, true);
  card.challenge_video = !slab.is_ungraded && !!(await challengeVideoRow(env, id));
  return json({ card: applyPhotoPresence(card, await listPhotoKinds(env, id)) });
}

async function approveCard(request, env, id) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request).catch(() => ({}));
  const slab = await env.DB.prepare("SELECT * FROM slabs WHERE id = ?").bind(id).first();
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (slab.status !== "in_review") return json({ error: "Questa carta non è in verifica" }, 400);

  let modelId = slab.card_model_id;
  if (body.model && (body.model.game || body.model.code || body.model.name)) {
    const model = await findOrCreateModel(env, { ...body.model, code: body.model.code || body.model.code_printed }, { allowFictional: true });
    modelId = model.id;
  } else if (body.model_id) {
    const exists = await env.DB.prepare("SELECT id FROM card_models WHERE id = ?").bind(String(body.model_id)).first();
    if (!exists) return json({ error: "Modello di carta inesistente" }, 400);
    modelId = exists.id;
  }

  if (slab.is_ungraded) {
    // Ungraded cards need the back photo too (only checked when approving a card in review).
    let hasBack = false;
    try {
      const l = await env.PHOTOS.list({ prefix: "photo:" + id + ":back", limit: 1 });
      hasBack = !!(l.keys && l.keys.length);
    } catch (e) {
      return json({ error: "Archivio foto non raggiungibile, riprova" }, 503);
    }
    if (!hasBack) return json({ error: "Manca la foto del retro: chiedi al proprietario di caricarla prima di approvare", code: "back_photo_required" }, 400);
    await env.DB.prepare(
      `UPDATE slabs SET card_model_id = ?, status = 'approved', assigned_at = ?, rejection_reason = NULL,
         digest = NULL, roll = NULL, rarity_tier = NULL, serial_number = NULL, serial_total_at_assignment = NULL,
         server_seed = '', commit_hash = '', client_nonce = ''
       WHERE id = ?`
    ).bind(modelId, nowIso(), id).run();
    await audit(env, admin.id, "publish_ungraded", "slab", id, { modelId });
    let fresh = await loadSlab(env, id);
    await maybeAutoList(env, fresh);
    fresh = await loadSlab(env, id);
    return json({ card: presentSlab(fresh, admin, true) });
  }

  // Draw once: if the record already has rarity/serial, never reassign (idempotent re-approval).
  const certKey = `${slab.grader}-${slab.certificate_no}`;
  const digest = slab.digest || await sha256Hex(`${slab.server_seed}:${slab.client_nonce}:${certKey}`);
  const roll = slab.roll != null ? slab.roll : rollFromDigest(digest);
  const tier = slab.rarity_tier || tierFromRollExact(roll);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO card_model_counters (card_model_id, last_serial, registered_count) VALUES (?, 0, 0)`
  ).bind(modelId).run();

  let serial = slab.serial_number;
  if (serial) {
    await env.DB.prepare(
      `UPDATE slabs SET card_model_id = ?, status = 'approved', rarity_tier = COALESCE(rarity_tier, ?),
         assigned_at = COALESCE(assigned_at, ?), rejection_reason = NULL WHERE id = ?`
    ).bind(modelId, tier, nowIso(), id).run();
  } else {
    // Serial: random (crypto.getRandomValues), not registration order; unique per model with retry.
    serial = await drawUniqueSerial(async (s) => {
      const taken = await env.DB.prepare(
        "SELECT 1 AS x FROM slabs WHERE card_model_id = ? AND serial_number = ? AND id != ?"
      ).bind(modelId, s, id).first();
      if (taken) return false;
      try {
        await env.DB.prepare(
          `UPDATE slabs SET
             card_model_id = ?, status = 'approved', digest = ?, roll = ?, rarity_tier = ?,
             serial_number = ?, serial_total_at_assignment = ?, assigned_at = ?, rejection_reason = NULL
           WHERE id = ? AND serial_number IS NULL`
        ).bind(modelId, digest, roll, tier, s, SERIAL_MAX, nowIso(), id).run();
        return true;
      } catch (e) {
        if (isUniqueViolation(e)) return false;
        throw e;
      }
    });
    await env.DB.prepare(
      `UPDATE card_model_counters SET last_serial = last_serial + 1, registered_count = registered_count + 1 WHERE card_model_id = ?`
    ).bind(modelId).run();
  }

  await audit(env, admin.id, "approve_card", "slab", id, { tier, serial, modelId, is_test: !!slab.is_test });
  let issued = null;
  try {
    issued = await issueCertificateForSlab(env, request, id, { sendNotifyEmail, audit }, { actorId: admin.id });
  } catch (e) {
    console.log("certificate issue failed", e && e.message);
  }
  const fresh = await loadSlab(env, id);
  const out = { card: presentSlab(fresh, admin, true) };
  if (issued && issued.code) out.transfer_code = issued.code;
  return json(out);
}

async function rejectCard(request, env, id) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return json({ error: "Indica il motivo del rifiuto" }, 400);
  const slab = await env.DB.prepare("SELECT * FROM slabs WHERE id = ?").bind(id).first();
  if (!slab) return json({ error: "Carta non trovata" }, 404);
  if (slab.status !== "in_review") return json({ error: "Questa carta non è in verifica" }, 400);
  await env.DB.prepare("UPDATE slabs SET status = 'rejected', rejection_reason = ? WHERE id = ?")
    .bind(reason.slice(0, 500), id).run();
  await audit(env, admin.id, "reject_card", "slab", id, { reason });
  return json({ ok: true });
}


async function adminCreateTestCard(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return json({ error: "Indica l'email dell'utente a cui assegnare la carta TEST" }, 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return json({ error: "Nessun account con questa email. L'utente deve prima registrarsi." }, 404);

  const model = await findOrCreateModel(env, {
    game: "fictional_demo",
    set_name: "Laboratorio TEST",
    set_code: "TEST",
    code: "TEST/001",
    name: "Carta TEST DreaMint",
    language: "ITA",
    variant: "normal"
  }, { allowFictional: true });

  const server_seed = randomHex(32);
  const client_nonce = randomHex(16);
  const commit_hash = await sha256Hex(server_seed);
  const grader = "GRAAD";
  const certificate_no = "TEST-" + randomHex(5).toUpperCase();
  const certKey = grader + "-" + certificate_no;
  const digest = await sha256Hex(server_seed + ":" + client_nonce + ":" + certKey);
  const roll = rollFromDigest(digest);
  const tier = tierFromRollExact(roll);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO card_model_counters (card_model_id, last_serial, registered_count) VALUES (?, 0, 0)`
  ).bind(model.id).run();

  const id = crypto.randomUUID();
  const serial = await drawUniqueSerial(async (s) => {
    const taken = await env.DB.prepare("SELECT 1 AS x FROM slabs WHERE card_model_id = ? AND serial_number = ?").bind(model.id, s).first();
    if (taken) return false;
    try {
        await env.DB.prepare(
          `INSERT INTO slabs (
            id, card_model_id, submitter_id, physical_owner_id, digital_owner_id,
            grader, certificate_no, grade, is_ungraded, status,
            challenge_code, challenge_expires_at, server_seed, commit_hash, client_nonce,
            digest, roll, rarity_tier, serial_number, serial_total_at_assignment, assigned_at, created_at,
            card_condition, is_test
          ) VALUES (?, ?, ?, ?, ?, ?, ?, '10', 0, 'approved', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`
        ).bind(
          id, model.id, admin.id, user.id, user.id,
          grader, certificate_no,
          server_seed, commit_hash, client_nonce,
          digest, roll, tier, s, SERIAL_MAX, nowIso(), nowIso()
        ).run();
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  });
  await env.DB.prepare(
    `UPDATE card_model_counters SET last_serial = last_serial + 1, registered_count = registered_count + 1 WHERE card_model_id = ?`
  ).bind(model.id).run();

  await env.PHOTOS.put("photo:" + id + ":front", TEST_CARD_PNG_DATA_URL);

  await audit(env, admin.id, "create_test_card", "slab", id, { user_id: user.id, email, serial, tier, model_id: model.id });
  let issued = null;
  try {
    issued = await issueCertificateForSlab(env, request, id, { sendNotifyEmail, audit }, { actorId: admin.id, to: user.email });
  } catch (e) {
    console.log("certificate issue failed", e && e.message);
  }
  const fresh = await loadSlab(env, id);
  const out = { card: presentSlab(fresh, admin, true) };
  if (issued && issued.code) out.transfer_code = issued.code;
  return json(out, 201);
}

async function audit(env, actorId, action, entity, entityId, payload) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), actorId || null, action, entity, entityId, JSON.stringify(payload || {}), nowIso()).run();
  } catch (e) {
    console.log("audit failed", e.message);
  }
}

/* wrap require* errors as HTTP */
const _requireUser = requireUser;
const _requireAdmin = requireAdmin;
async function safeWrap() {}


async function adminSales(request, env) {
  const admin = await requireAdmin(request, env);
  const rows = await env.DB.prepare(
    `SELECT sa.*, sl.grader, sl.rarity_tier, sl.serial_number, sl.is_ungraded,
            m.name AS card_name, m.code_printed, m.set_name,
            seller.display_name AS seller_name, seller.email AS seller_email,
            buyer.display_name AS buyer_name, buyer.email AS buyer_email,
            seller.paypal_email AS seller_paypal_email
     FROM sales sa
     JOIN slabs sl ON sl.id = sa.slab_id
     JOIN card_models m ON m.id = sl.card_model_id
     JOIN users seller ON seller.id = sa.seller_id
     JOIN users buyer ON buyer.id = sa.buyer_id
     ORDER BY sa.created_at DESC
     LIMIT 200`
  ).all();
  return json({
    sales: (rows.results || []).map((r) => presentSale(r, admin))
  });
}

async function loadPartnerStats(env, extraWhere, bindValue) {
  const sql = extraWhere
    ? PARTNER_STATS_SQL + " WHERE " + extraWhere
    : PARTNER_STATS_SQL + " ORDER BY p.created_at DESC";
  const stmt = extraWhere
    ? env.DB.prepare(sql).bind(bindValue)
    : env.DB.prepare(sql);
  if (extraWhere) return stmt.first();
  const rows = await stmt.all();
  return rows.results || [];
}

async function adminListPartners(request, env) {
  const admin = await requireAdmin(request, env);
  const rows = await loadPartnerStats(env);
  const origin = siteOrigin(request);
  return json({ partners: rows.map((p) => presentAdminPartner(p, origin)) });
}

async function adminCreatePartner(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const code = normalizePartnerCode(body.code);
  const contact_note = String(body.contact_note || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!name) return json({ error: "Inserisci il nome del partner" }, 400);
  if (!isValidPartnerCode(code)) return json({ error: "Il codice deve avere da 3 a 20 caratteri (lettere e numeri)" }, 400);
  const exists = await env.DB.prepare("SELECT id FROM partners WHERE code = ?").bind(code).first();
  if (exists) return json({ error: "Questo codice partner esiste già" }, 409);
  const id = crypto.randomUUID();
  const token = randomHex(24);
  const created = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO partners (id, name, code, contact_note, token, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, code, contact_note || null, token, created, admin.id).run();
  } catch (err) {
    const msg = String((err && err.message) || "");
    if (msg.toLowerCase().includes("unique")) return json({ error: "Questo codice partner esiste già" }, 409);
    throw err;
  }
  await audit(env, admin.id, "create_partner", "partner", id, { code, name });
  const row = await loadPartnerStats(env, "p.id = ?", id);
  return json({ partner: presentAdminPartner(row, siteOrigin(request)) }, 201);
}

async function publicPartnerStats(request, env, token) {
  const tok = String(token || "").trim();
  if (!/^[a-f0-9]{48}$/i.test(tok)) return json({ error: "Link non valido" }, 404);
  const row = await loadPartnerStats(env, "p.token = ?", tok);
  if (!row) return json({ error: "Link non valido" }, 404);
  return json({ partner: presentPublicPartnerStats(row) });
}

async function notifySaleShipped(env, request, sale, tracking, trackUrl) {
  try {
    const info = await env.DB.prepare(
      `SELECT sa.*, m.name AS card_name, m.set_name, m.code_printed,
              seller.display_name AS seller_name, buyer.display_name AS buyer_name,
              buyer.email AS buyer_email
       FROM sales sa
       JOIN slabs sl ON sl.id = sa.slab_id
       JOIN card_models m ON m.id = sl.card_model_id
       JOIN users seller ON seller.id = sa.seller_id
       JOIN users buyer ON buyer.id = sa.buyer_id
       WHERE sa.id = ?`
    ).bind(sale.id).first();
    const methodLabel = (info && presentShipping(info, null).shipping_label) || "Spedizione tracciata";
    const link = siteOrigin(request) + "/#/vendite";
    const codeLine = tracking ? ("Codice tracking: " + tracking) : "Codice tracking non indicato.";
    const urlLine = trackUrl ? ("Traccia la spedizione: " + trackUrl) : "";
    const card = (info && info.card_name) || "Carta";
    const buyerText = [
      "La tua carta è stata spedita.",
      "",
      "Carta: " + card,
      "Metodo: " + methodLabel,
      codeLine,
      urlLine,
      "",
      "Quando arriva, conferma la ricezione da Vendite: " + link
    ].filter(Boolean).join("\n");
    const adminText = [
      "Spedizione segnalata dal venditore.",
      "",
      "Carta: " + card,
      "Metodo: " + methodLabel,
      "Venditore: " + ((info && info.seller_name) || ""),
      "Acquirente: " + ((info && info.buyer_name) || ""),
      codeLine,
      urlLine,
      "",
      "Apri: " + link
    ].filter(Boolean).join("\n");
    if (info && info.buyer_email) {
      await sendNotifyEmail(env, {
        to: info.buyer_email,
        subject: "DreaMint: la tua carta è stata spedita — " + card,
        text: buyerText
      });
    }
    await sendNotifyEmail(env, {
      subject: "DreaMint: spedizione — " + card,
      text: adminText
    });
  } catch (e) { /* notify must not block shipping */ }
}

// SECURITY (A2): every step is conditional on this exact sale being completed now, and the card
// moves only if the seller still owns it.
async function completeSaleTransfer(env, sale, actorId, actionName) {
  const at = nowIso();
  const kind = sale.kind ? effectiveKind(sale.kind) : "fullset";
  // «Solo digitale» completes when the payment is confirmed (nothing to ship); the others on receipt.
  const from = kind === "digital" ? "paid" : "shipped";
  const done = "EXISTS (SELECT 1 FROM sales WHERE id = ? AND status = 'completed' AND received_at = ?)";
  const action = actionName || "sale_received";
  let slabStmt, ownedNow;
  if (kind === "digital") {
    // Only the digital copy moves; the seller stays physical owner. Prices of the old split are cleared.
    slabStmt = env.DB.prepare(
      `UPDATE slabs SET digital_owner_id = ?, price_digital_cents = NULL, asking_price_cents = NULL
       WHERE id = ? AND is_ungraded = 0 AND digital_owner_id = ? AND ` + done
    ).bind(sale.buyer_id, sale.slab_id, sale.seller_id, sale.id, at);
    ownedNow = "digital_owner_id = ?";
  } else if (kind === "physical") {
    slabStmt = env.DB.prepare(
      `UPDATE slabs SET physical_owner_id = ?, price_physical_cents = NULL, asking_price_cents = NULL, status = 'approved'
       WHERE id = ? AND is_ungraded = 0 AND physical_owner_id = ? AND ` + done
    ).bind(sale.buyer_id, sale.slab_id, sale.seller_id, sale.id, at);
    ownedNow = "physical_owner_id = ?";
  } else {
    // Full Set / legacy / ungraded (unchanged): both owners move to the buyer.
    slabStmt = env.DB.prepare(
      `UPDATE slabs SET physical_owner_id = ?, digital_owner_id = ?, status = 'approved', price_digital_cents = NULL, price_physical_cents = NULL
       WHERE id = ? AND physical_owner_id = ? AND (is_ungraded = 1 OR digital_owner_id = ?) AND ` + done
    ).bind(sale.buyer_id, sale.buyer_id, sale.slab_id, sale.seller_id, sale.seller_id, sale.id, at);
    ownedNow = "physical_owner_id = ?";
  }
  // Graded cards: rotate the transfer code in this same batch so the previous
  // owner's code stops working immediately. Ungraded rows are skipped by the SQL.
  // The reveal row is written after the owner UPDATE so it belongs to the current digital owner
  // (buyer on Full Set / Solo digitale; the unchanged digital owner on Solo carta fisica).
  const rotation = await makeTransferCode();
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE sales SET status = 'completed', received_at = ? WHERE id = ? AND status = ?").bind(at, sale.id, from),
    env.DB.prepare("UPDATE listings SET status = 'completed' WHERE id = ? AND " + done).bind(sale.listing_id, sale.id, at),
    slabStmt,
    ...transferCodeRotateStmts(env, sale.slab_id, rotation, done, [sale.id, at]),
    env.DB.prepare(
      `INSERT INTO slab_owner_history (id, slab_id, from_user_id, to_user_id, reason, sale_id, created_at, part)
       SELECT ?, ?, ?, ?, 'sale', ?, ?, ? WHERE ` + done + ` AND EXISTS (SELECT 1 FROM slabs WHERE id = ? AND ` + ownedNow + `)`
    ).bind(crypto.randomUUID(), sale.slab_id, sale.seller_id, sale.buyer_id, sale.id, at, sale.kind ? kind : null, sale.id, at, sale.slab_id, sale.buyer_id),
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, payload, created_at)
       SELECT ?, ?, ?, 'sale', ?, ?, ? WHERE ` + done
    ).bind(crypto.randomUUID(), actorId || null, action, sale.id,
      JSON.stringify({ buyer_id: sale.buyer_id, seller_id: sale.seller_id, slab_id: sale.slab_id, kind }), at, sale.id, at),
    // Listings paused by this sale: reopened if still sellable, otherwise closed; any other listing
    // of the card that its seller can no longer deliver is closed too. Then the card status is refreshed.
    ...resumePausedStmts(env, sale.id, done, [sale.id, at]),
    env.DB.prepare(
      "UPDATE listings SET status = 'closed' WHERE slab_id = ? AND status IN ('active','paused') AND NOT " + listingValidSql("listings") + " AND " + done
    ).bind(sale.slab_id, sale.id, at),
    refreshSlabStatusStmt(env, sale.slab_id, done, [sale.id, at])
  ]);
  if (!res[0].meta || res[0].meta.changes !== 1) return false;
  return true;
}

// Conflicting listings of the same card (same part) are paused while `saleId` holds `listingId`.
function pauseConflictsStmt(env, listingId, saleId) {
  return env.DB.prepare(
    `UPDATE listings SET status = 'paused', paused_by_sale_id = ?
     WHERE status = 'active' AND id <> ? AND slab_id = (SELECT slab_id FROM listings WHERE id = ?)
       AND EXISTS (SELECT 1 FROM listings h WHERE h.id = ? AND h.status = 'reserved' AND h.reserved_sale_id = ? AND ` + conflictSql("h", "listings") + `)`
  ).bind(saleId, listingId, listingId, listingId, saleId);
}

// After a sale is cancelled or completed (guard): its paused listings reopen if still sellable, else close.
function resumePausedStmts(env, saleId, guard, guardBinds) {
  return [
    env.DB.prepare(
      "UPDATE listings SET status = 'active', paused_by_sale_id = NULL WHERE paused_by_sale_id = ? AND status = 'paused' AND " + listingValidSql("listings") + " AND " + guard
    ).bind(saleId, ...guardBinds),
    env.DB.prepare(
      "UPDATE listings SET status = 'closed' WHERE paused_by_sale_id = ? AND status = 'paused' AND " + guard
    ).bind(saleId, ...guardBinds)
  ];
}

function refreshSlabStatusStmt(env, slabId, guard, guardBinds) {
  return env.DB.prepare(
    `UPDATE slabs SET status = CASE WHEN EXISTS (SELECT 1 FROM listings WHERE slab_id = slabs.id AND status IN ('active','reserved','paused'))
       THEN 'listed' ELSE 'approved' END
     WHERE id = ? AND status IN ('approved','listed')` + (guard ? " AND " + guard : "")
  ).bind(slabId, ...(guardBinds || []));
}

// Takes (or keeps) the listing for saleId at payment confirmation (not on accept).
// Succeeds only if the listing is active, already held by this sale, or a legacy reservation
// without holder that no other paid sale is using.
function lockListingStmt(env, listingId, saleId) {
  // The seller must still own what the listing sells, and no conflicting listing of the same card
  // (same part) may already be reserved by a paid sale.
  return env.DB.prepare(
    `UPDATE listings SET status = 'reserved', reserved_sale_id = ?
     WHERE id = ? AND (
       status = 'active'
       OR (status = 'reserved' AND reserved_sale_id = ?)
       OR (status = 'reserved' AND reserved_sale_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM sales WHERE listing_id = ? AND id <> ? AND status IN ('paid','shipped')))
     ) AND ` + listingValidSql("listings") + `
       AND NOT EXISTS (SELECT 1 FROM listings o WHERE o.slab_id = listings.slab_id AND o.id <> listings.id
                       AND o.status = 'reserved' AND ` + conflictSql("o", "listings") + `)`
  ).bind(saleId, listingId, saleId, listingId, saleId);
}

function releaseListingStmt(env, listingId, saleId) {
  return env.DB.prepare(
    `UPDATE listings SET status = 'active', reserved_sale_id = NULL
     WHERE id = ? AND status = 'reserved' AND (
       reserved_sale_id = ?
       OR (reserved_sale_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM sales WHERE listing_id = ? AND status IN ('paid','shipped')))
     )`
  ).bind(listingId, saleId, listingId);
}

async function updateMe(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request) || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const profileKeys = has("username") || has("album_public");
  // Legacy behaviour (body without username/album_public) is unchanged: it sets paypal_email.
  const setPaypal = has("paypal_email") || !profileKeys;
  const email = String(body.paypal_email || "").trim();
  if (setPaypal && email && !isValidPaypalEmail(email)) return json({ error: "Inserisci un’email PayPal valida" }, 400);
  let newUsername = user.username || null;
  if (has("username")) {
    const un = normalizeUsername(body.username);
    if (!un.ok) return json({ error: un.error, code: un.code }, 400);
    newUsername = un.username;
    if (newUsername !== (user.username || null) && await usernameTaken(env, newUsername, user.id)) return usernameTakenResponse();
  }
  let newAlbum = user.album_public ? 1 : 0;
  if (has("album_public")) {
    if (typeof body.album_public !== "boolean") return json({ error: "album_public non valido", code: "album_public_invalid" }, 400);
    newAlbum = body.album_public ? 1 : 0;
  }
  if (newAlbum && !newUsername) return json({ error: "Scegli prima uno username per rendere pubblico l'album", code: "username_required" }, 400);
  if (profileKeys) {
    try {
      await env.DB.prepare("UPDATE users SET username = ?, album_public = ? WHERE id = ?").bind(newUsername, newAlbum, user.id).run();
    } catch (e) {
      if (isUniqueViolation(e)) return usernameTakenResponse();
      throw e;
    }
  }
  if (setPaypal) {
    await env.DB.prepare("UPDATE users SET paypal_email = ? WHERE id = ?").bind(email, user.id).run();
    if (isValidPaypalEmail(email)) await autoListEligibleForUser(env, user.id);
  }
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return json({ user: await publicUserWithMeta(env, fresh) });
}

/* ---------------- public usernames & albums (migrate-v16.sql) ---------------- */

async function usernameTaken(env, username, exceptUserId) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE lower(username) = ? AND id != ?")
    .bind(username, exceptUserId || "").first();
  return !!row;
}
function usernameTakenResponse() {
  return json({ error: "Questo username è già in uso", code: "username_taken" }, 409);
}

// A card is in a public album when approved/listed, not a test card and not archived.
const ALBUM_CARD_WHERE = "s.status IN ('approved','listed') AND s.is_test = 0 AND s.archived_at IS NULL";
const ALBUM_MAX_CARDS = 500;

/* ---------------- two markets for graded cards (migrate-v17.sql) ---------------- */

const MARKET_OWN_SQL = {
  fullset: "physical_owner_id = ? AND digital_owner_id = ?",
  digital: "digital_owner_id = ?",
  physical: "physical_owner_id = ? AND digital_owner_id <> ?"
};
const MARKET_OWN_BINDS = { fullset: 2, digital: 1, physical: 2 };

// PATCH /api/cards/:id/market {price_fullset_cents?, price_digital_cents?, price_physical_cents?}
// (or *_euros). A number opens/updates that listing, null closes it.
async function updateMarket(request, env, id) {
  const user = await requireUser(request, env);
  const body = await readJson(request) || {};
  const slab = await loadSlab(env, id);
  if (!slab || !(user.id === slab.physical_owner_id || user.id === slab.digital_owner_id)) return json({ error: "Carta non trovata", code: "not_found" }, 404);
  if (slab.is_ungraded) return json({ error: "Le carte non gradate hanno un solo prezzo", code: "graded_only" }, 400);
  if (slab.archived_at || !["approved", "listed", "in_transit"].includes(slab.status)) return json({ error: "Questa carta non può essere messa in vendita ora", code: "not_available" }, 400);
  if (!slab.opened_at) return json({ error: "Apri prima l'estrazione della rarità", code: "not_opened" }, 400);
  const changes = [];
  for (const kind of KINDS) {
    const pr = parseMarketPrice(body, kind, parsePriceEuros);
    if (!pr.present) continue;
    if (!pr.ok) return json({ error: pr.error, code: "price_invalid", kind }, 400);
    if (!canSellKind(slab, user.id, kind)) {
      const code = kind === "fullset" ? "not_full_set"
        : kind === "digital" ? "not_digital_owner"
        : (slab.physical_owner_id === user.id ? "use_fullset" : "not_physical_owner");
      return json({ error: code === "use_fullset" ? "Possiedi carta e copia digitale: usa il prezzo Full Set" : "Non possiedi questa parte della carta", code, kind }, 403);
    }
    const cur = (slab._listings || []).find((l) => effectiveKind(l.kind) === kind && l.seller_id === user.id);
    if (cur && cur.status === "reserved") return json({ error: "C'è una vendita in corso su questo annuncio", code: "listing_reserved", kind }, 409);
    changes.push({ kind, cents: pr.cents, cur });
  }
  if (!changes.length) return json({ error: "Nessun prezzo da aggiornare", code: "nothing_to_update" }, 400);
  if (changes.some((c) => c.cents != null) && !isValidPaypalEmail(user.paypal_email)) {
    return json({ error: "Aggiungi l’email PayPal nel profilo prima di vendere", code: "paypal_required" }, 400);
  }
  const reserved = (slab._listings || []).filter((l) => l.status === "reserved");
  for (const c of changes) {
    const col = PRICE_COLUMN[c.kind];
    const stmts = [];
    if (c.cents == null) {
      stmts.push(env.DB.prepare(`UPDATE slabs SET ${col} = NULL WHERE id = ?`).bind(slab.id));
      if (c.cur) stmts.push(env.DB.prepare("UPDATE listings SET status = 'closed', paused_by_sale_id = NULL WHERE id = ? AND status IN ('active','paused')").bind(c.cur.id));
    } else {
      stmts.push(env.DB.prepare(`UPDATE slabs SET ${col} = ? WHERE id = ?`).bind(c.cents, slab.id));
      if (c.cur) {
        stmts.push(env.DB.prepare("UPDATE listings SET price_cents = ? WHERE id = ? AND status IN ('active','paused')").bind(c.cents, c.cur.id));
      } else {
        // A conflicting sale in progress: the new listing starts paused and follows that sale.
        const blocker = reserved.find((l) => kindsConflictJs(l.kind, c.kind));
        const own = Array(MARKET_OWN_BINDS[c.kind]).fill(user.id);
        stmts.push(env.DB.prepare(
          `INSERT INTO listings (id, slab_id, seller_id, price_cents, shipping_note, status, created_at, kind, paused_by_sale_id)
           SELECT ?, ?, ?, ?, '', ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM slabs WHERE id = ? AND archived_at IS NULL AND is_ungraded = 0 AND ${MARKET_OWN_SQL[c.kind]})
             AND NOT EXISTS (SELECT 1 FROM listings WHERE slab_id = ? AND seller_id = ? AND COALESCE(kind,'fullset') = ? AND status IN ('active','reserved','paused'))`
        ).bind(crypto.randomUUID(), slab.id, user.id, c.cents, blocker ? "paused" : "active", nowIso(), c.kind,
          blocker ? blocker.reserved_sale_id || null : null, slab.id, ...own, slab.id, user.id, c.kind));
      }
    }
    stmts.push(refreshSlabStatusStmt(env, slab.id));
    await env.DB.batch(stmts);
  }
  await audit(env, user.id, "market_prices", "slab", slab.id, { changes: changes.map((c) => ({ kind: c.kind, price_cents: c.cents })) });
  const fresh = await loadSlab(env, slab.id);
  return json({ card: presentSlab(fresh, user, true) });
}

function kindsConflictJs(a, b) {
  const x = effectiveKind(a), y = effectiveKind(b);
  return !((x === "digital" && y === "physical") || (x === "physical" && y === "digital"));
}

function publicOwnerRef(username, albumPublic) {
  if (username && albumPublic) return { username, profile_url: "/#/u/" + encodeURIComponent(username), private: false };
  return { username: null, profile_url: null, private: true, label: "Collezionista privato" };
}

// GET /api/search/cert?q=<grading certificate number>
async function searchCert(env, url) {
  const values = certSearchValues(url && url.searchParams.get("q"));
  if (!values.length) return json({ error: "Inserisci il numero di certificato (4-40 lettere o cifre)", code: "query_too_short" }, 400);
  const certMatch = values.map(() => `${CERT_NORM_SQL} = ?`).join(" OR ");
  const rows = await env.DB.prepare(
    `SELECT s.id, s.grader, s.grade, s.certificate_no, s.rarity_tier, s.serial_number, s.serial_total_at_assignment, s.opened_at,
            s.physical_owner_id, s.digital_owner_id, m.name AS card_name, m.set_name, m.code_printed, m.language, m.game,
            c.registered_count, po.username AS po_username, po.album_public AS po_public,
            do.username AS do_username, do.album_public AS do_public
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     LEFT JOIN users po ON po.id = s.physical_owner_id
     LEFT JOIN users do ON do.id = s.digital_owner_id
     WHERE s.is_ungraded = 0 AND s.is_test = 0 AND s.archived_at IS NULL AND s.status IN ('approved','listed','in_transit')
       AND (${certMatch})
     ORDER BY s.created_at DESC
     LIMIT 10`
  ).bind(...values).all();
  const list = rows.results || [];
  const listings = {};
  if (list.length) {
    const lr = await env.DB.prepare(
      `SELECT l.id, l.slab_id, l.kind, l.price_cents FROM listings l
       WHERE l.slab_id IN (${list.map(() => "?").join(",")}) AND l.status = 'active' AND ` + listingValidSql("l") + ` ORDER BY l.created_at`
    ).bind(...list.map((r) => r.id)).all();
    for (const l of lr.results || []) (listings[l.slab_id] = listings[l.slab_id] || []).push({ id: l.id, kind: effectiveKind(l.kind), price_cents: l.price_cents });
  }
  return json({
    results: list.map((r) => {
      const opened = !!r.opened_at;
      return {
        card: { id: r.id, name: r.card_name, set_name: r.set_name, code_printed: r.code_printed, language: r.language, game: r.game,
                grader: r.grader, grade: r.grade, certificate_no: r.certificate_no },
        opened,
        digital: opened ? { serial_number: r.serial_number || null, serial_total: serialTotalFor(r), rarity_tier: r.rarity_tier || null,
                            rarity_label: r.rarity_tier ? (TIER_LABELS[r.rarity_tier] || null) : null } : null,
        full_set: !!(r.physical_owner_id && r.physical_owner_id === r.digital_owner_id),
        digital_owner: publicOwnerRef(r.do_username, r.do_public),
        physical_owner: publicOwnerRef(r.po_username, r.po_public),
        listings: listings[r.id] || []
      };
    })
  }, 200, { "cache-control": "no-store" });
}

async function searchUsers(env, url) {
  const q = normalizeQuery(url && url.searchParams.get("q"));
  if (!q) return json({ error: "Scrivi da 2 a 30 caratteri", code: "query_too_short" }, 400);
  const like = likeEscape(q);
  const rows = await env.DB.prepare(
    `SELECT u.username,
            (SELECT COUNT(*) FROM slabs s WHERE s.physical_owner_id = u.id AND ${ALBUM_CARD_WHERE}) AS cards_count,
            CASE WHEN u.username LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
     FROM users u
     WHERE u.album_public = 1 AND u.username IS NOT NULL AND u.username LIKE ? ESCAPE '\\'
     ORDER BY rank, cards_count DESC, u.username
     LIMIT 20`
  ).bind(like + "%", "%" + like + "%").all();
  return json({ users: (rows.results || []).map((r) => ({ username: r.username, cards_count: Number(r.cards_count) || 0 })) },
    200, { "cache-control": "no-store" });
}

async function userAlbum(request, env, rawName) {
  const notFound = () => json({ error: "Album non trovato", code: "not_found" }, 404, { "cache-control": "no-store" });
  let name;
  try { name = decodeURIComponent(rawName).trim().toLowerCase(); } catch (e) { return notFound(); }
  if (!USERNAME_RE.test(name)) return notFound();
  // Missing user, private album and NULL username give the same 404.
  const u = await env.DB.prepare("SELECT id, username FROM users WHERE lower(username) = ? AND username IS NOT NULL AND album_public = 1")
    .bind(name).first();
  if (!u) return notFound();
  const rows = await env.DB.prepare(
    `SELECT s.id, s.is_ungraded, s.grader, s.grade, s.card_condition, s.rarity_tier, s.serial_number, s.serial_total_at_assignment,
            s.opened_at, s.status, m.game, m.name AS card_name, m.set_name, m.code_printed, m.language, m.variant,
            c.registered_count, li.price_cents AS listing_price_cents
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     LEFT JOIN listings li ON li.slab_id = s.id AND li.status = 'active' AND li.seller_id = s.physical_owner_id
     WHERE s.physical_owner_id = ? AND ${ALBUM_CARD_WHERE}
     ORDER BY s.created_at DESC
     LIMIT ${ALBUM_MAX_CARDS}`
  ).bind(u.id).all();
  const list = rows.results || [];
  const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM slabs s WHERE s.physical_owner_id = ? AND ${ALBUM_CARD_WHERE}`).bind(u.id).first();
  const cards = list.map((r) => {
    const graded = !r.is_ungraded;
    const revealed = graded && !!r.opened_at; // rarity/serial are public only after opening (as in presentSlab)
    const forSale = r.listing_price_cents != null;
    const id = encodeURIComponent(r.id);
    return {
      id: r.id,
      name: r.card_name,
      set_name: r.set_name,
      code_printed: r.code_printed,
      game: r.game,
      language: r.language,
      variant: r.variant,
      is_ungraded: !graded,
      type: graded ? "graded" : "ungraded",
      grader: graded ? r.grader : null,
      grade: graded ? r.grade : null,
      card_condition: graded ? null : (r.card_condition || null),
      rarity_tier: revealed ? (r.rarity_tier || null) : null,
      rarity_label: revealed && r.rarity_tier ? (TIER_LABELS[r.rarity_tier] || null) : null,
      serial_number: revealed ? (r.serial_number || null) : null,
      serial_total: revealed ? serialTotalFor(r) : null,
      front_url: "/api/cards/" + id + "/photo/front",
      back_url: "/api/cards/" + id + "/photo/back",
      public_url: (revealed && r.rarity_tier && r.serial_number) ? "/c/" + id : null,
      in_vendita: forSale,
      on_sale: forSale, // alias read by app.js normalizePublicCard
      price_cents: forSale ? r.listing_price_cents : null
    };
  });
  return json({ username: u.username, cards_count: Number(cnt && cnt.n) || 0, cards }, 200, { "cache-control": "no-store" });
}

async function loadSaleForPaypal(env, saleId) {
  return env.DB.prepare(
    `SELECT sa.*, seller.paypal_email AS seller_paypal_email, m.name AS card_name
     FROM sales sa
     JOIN users seller ON seller.id = sa.seller_id
     JOIN slabs sl ON sl.id = sa.slab_id
     JOIN card_models m ON m.id = sl.card_model_id
     WHERE sa.id = ?`
  ).bind(saleId).first();
}

async function notifySalePaid(env, request, sale, title) {
  try {
    const info = (sale && sale.card_name) ? sale : await env.DB.prepare(
      `SELECT sa.*, m.name AS card_name, m.set_name, m.code_printed, sl.is_ungraded,
              seller.display_name AS seller_name, buyer.display_name AS buyer_name
       FROM sales sa
       JOIN slabs sl ON sl.id = sa.slab_id
       JOIN card_models m ON m.id = sl.card_model_id
       JOIN users seller ON seller.id = sa.seller_id
       JOIN users buyer ON buyer.id = sa.buyer_id
       WHERE sa.id = ?`
    ).bind(sale.id).first();
    await notifyAdminSafe(env, request, {
      subject: "DreaMint: pagamento ricevuto — " + ((info && info.card_name) || "Carta"),
      title: title || "Pagamento ricevuto.",
      cardName: info && info.card_name,
      setName: info && info.set_name,
      code: info && info.code_printed,
      typeLabel: info && info.is_ungraded ? "Non gradata" : "Gradata",
      sellerName: info && (info.seller_name || info.seller_display_name),
      buyerName: info && info.buyer_name,
      amount: formatEuros(payableCents(info || sale)),
      link: siteOrigin(request) + "/#/vendite"
    });
  } catch (e) { /* ignore */ }
}

async function markSalePaid(env, sale, txnId, orderId, extra, actorId, request) {
  if (sale.status === "paid") return { ok: true, idempotent: true };
  if (!canMarkPaid(sale.status)) return { ok: false, reason: "Stato non pagabile" };
  // SECURITY (A2): payment confirmation takes the listing lock atomically; only one sale can be paid.
  const res = await env.DB.batch([
    lockListingStmt(env, sale.listing_id, sale.id),
    env.DB.prepare(
      `UPDATE sales SET status = 'paid', paid_at = ?, paypal_txn_id = ?, paypal_order_id = ?
       WHERE id = ? AND status IN ('requested','accepted')
         AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'reserved' AND reserved_sale_id = ?)`
    ).bind(nowIso(), txnId || sale.paypal_txn_id || "", orderId || sale.paypal_order_id || "", sale.id, sale.listing_id, sale.id),
    pauseConflictsStmt(env, sale.listing_id, sale.id)
  ]);
  if (!res[1].meta || res[1].meta.changes !== 1) {
    await audit(env, actorId || null, "sale_payment_conflict", "sale", sale.id, { ...(extra || {}), txnId, orderId });
    return { ok: false, reason: "Annuncio già riservato a un altro acquirente: pagamento non applicato (da rimborsare)" };
  }
  await audit(env, actorId || null, "sale_paid", "sale", sale.id, extra || { txnId, orderId });
  // «Solo digitale»: nothing to ship, the digital copy moves to the buyer as soon as the payment is confirmed.
  if (sale.kind === "digital") {
    const completed = await completeSaleTransfer(env, { ...sale, status: "paid" }, actorId || null, "digital_sale_paid");
    if (completed) await notifyDigitalOwnerTransferCode(env, request, { sendNotifyEmail }, sale.slab_id);
    return { ok: true, completed };
  }
  return { ok: true };
}

async function paypalLink(request, env, saleId) {
  const user = await requireUser(request, env);
  const sale = await loadSaleForPaypal(env, saleId);
  if (!sale) return json({ error: "Vendita non trovata" }, 404);
  if (user.id !== sale.buyer_id && user.id !== sale.seller_id) return json({ error: "Non autorizzato" }, 403);
  if (!isValidPaypalEmail(sale.seller_paypal_email)) return json({ error: "Il venditore non ha un’email PayPal" }, 400);
  const origin = new URL(request.url).origin;
  const url = buildWpsCheckoutUrl({
    env,
    sellerEmail: sale.seller_paypal_email,
    saleId: sale.id,
    amountCents: payableCents(sale),
    itemName: sale.card_name || "Carta DreaMint",
    returnUrl: origin + "/#/vendite",
    cancelUrl: origin + "/#/vendite",
    notifyUrl: origin + "/api/paypal/ipn"
  });
  return json({ url, mode: paypalMode(env) });
}

async function paypalAccessToken(env) {
  const res = await fetch(paypalApiBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw Object.assign(new Error("Autenticazione PayPal non riuscita"), { status: 502 });
  const data = await res.json();
  return data.access_token;
}

async function paypalCreateOrder(request, env, saleId) {
  if (paypalMode(env) !== "rest") return json({ error: "Checkout REST non configurato" }, 400);
  const user = await requireUser(request, env);
  const sale = await loadSaleForPaypal(env, saleId);
  if (!sale) return json({ error: "Vendita non trovata" }, 404);
  if (user.id !== sale.buyer_id) return json({ error: "Solo l’acquirente può pagare" }, 403);
  if (!canMarkPaid(sale.status)) return json({ error: "Questa vendita non è in attesa di pagamento" }, 400);
  if (!isValidPaypalEmail(sale.seller_paypal_email)) return json({ error: "Il venditore non ha un’email PayPal" }, 400);
  const origin = new URL(request.url).origin;
  const token = await paypalAccessToken(env);
  const body = buildOrdersCreateBody({
    sellerEmail: sale.seller_paypal_email,
    saleId: sale.id,
    amountCents: payableCents(sale),
    itemName: sale.card_name || "Carta DreaMint",
    returnUrl: origin + "/#/vendite",
    cancelUrl: origin + "/#/vendite"
  });
  const res = await fetch(paypalApiBase(env) + "/v2/checkout/orders", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data.message || "Impossibile creare l’ordine PayPal" }, 502);
  await env.DB.prepare("UPDATE sales SET paypal_order_id = ? WHERE id = ?").bind(data.id, sale.id).run();
  return json({ id: data.id });
}

async function paypalCaptureOrder(request, env, saleId) {
  if (paypalMode(env) !== "rest") return json({ error: "Checkout REST non configurato" }, 400);
  const user = await requireUser(request, env);
  const sale = await loadSaleForPaypal(env, saleId);
  if (!sale) return json({ error: "Vendita non trovata" }, 404);
  if (user.id !== sale.buyer_id) return json({ error: "Solo l’acquirente può pagare" }, 403);
  const body = await readJson(request).catch(() => ({}));
  const orderId = String(body.orderID || sale.paypal_order_id || "");
  if (!orderId) return json({ error: "Ordine PayPal mancante" }, 400);
  const token = await paypalAccessToken(env);
  const capRes = await fetch(paypalApiBase(env) + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" }
  });
  const order = await capRes.json().catch(() => ({}));
  if (!capRes.ok) return json({ error: order.message || "Capture PayPal non riuscita" }, 502);
  const extracted = extractCaptureFromOrder(order);
  const check = validateRestCapture(sale, extracted);
  if (!check.ok) return json({ error: check.reason }, 400);
  const marked = await markSalePaid(env, sale, extracted.captureId, orderId, { source: "rest-capture" }, null, request);
  if (!marked.ok) return json({ error: marked.reason }, 409);
  if (marked && marked.ok && !marked.idempotent) {
    await notifySalePaid(env, request, sale, "Pagamento PayPal ricevuto.");
  }
  return json({ ok: true, status: "paid", captureId: extracted.captureId, idempotent: !!marked.idempotent });
}

async function paypalIpn(request, env) {
  const raw = await request.text();
  const verifyBody = "cmd=_notify-validate&" + raw;
  const verify = await fetch(ipnVerifyUrl(env), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Gemint-IPN" },
    body: verifyBody
  });
  const verdict = (await verify.text()).trim();
  if (verdict !== "VERIFIED") return new Response("INVALID", { status: 400 });
  const ipn = parseFormBody(raw);
  const saleId = ipn.invoice || ipn.custom || ipn.item_number;
  if (!saleId) return new Response("OK", { status: 200 });
  const sale = await loadSaleForPaypal(env, saleId);
  const check = validateIpnPayment(sale, ipn);
  if (!check.ok) return new Response("OK", { status: 200 });
  const marked = await markSalePaid(env, sale, ipn.txn_id || "", "", { source: "ipn" }, null, request);
  if (marked && marked.ok && !marked.idempotent) {
    await notifySalePaid(env, request, sale, "Pagamento PayPal ricevuto (IPN).");
  }
  return new Response("OK", { status: 200 });
}

async function paypalWebhook(request, env) {
  if (paypalMode(env) !== "rest") return json({ error: "Webhook REST non configurato" }, 400);
  // SECURITY (A1): without PAYPAL_WEBHOOK_ID the signature cannot be verified -> refuse.
  if (!env.PAYPAL_WEBHOOK_ID) return json({ error: "Webhook non verificabile (PAYPAL_WEBHOOK_ID mancante)" }, 400);
  const raw = await request.text();
  let event = {};
  try { event = JSON.parse(raw); } catch (e) { return json({ error: "JSON non valido" }, 400); }
  const h = (k) => request.headers.get(k) || "";
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig") || !h("paypal-cert-url") || !h("paypal-auth-algo") || !h("paypal-transmission-time")) {
    return json({ error: "Firma webhook mancante" }, 400);
  }
  const token = await paypalAccessToken(env);
  const verify = await fetch(paypalApiBase(env) + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event
    })
  });
  const v = await verify.json().catch(() => ({}));
  if (!verify.ok || v.verification_status !== "SUCCESS") return json({ error: "Firma webhook non valida" }, 400);
  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") return json({ ok: true, ignored: true });
  const captureId = String((event.resource && event.resource.id) || "");
  if (!captureId) return json({ ok: true, ignored: "capture mancante" });
  // Re-read the capture from PayPal instead of trusting the event body.
  const capRes = await fetch(paypalApiBase(env) + "/v2/payments/captures/" + encodeURIComponent(captureId), {
    headers: { authorization: "Bearer " + token }
  });
  const resource = await capRes.json().catch(() => ({}));
  if (!capRes.ok) return json({ ok: true, ignored: "capture non leggibile" });
  const saleId = String(resource.custom_id || resource.invoice_id || "").trim();
  if (!saleId) return json({ ok: true, ignored: true });
  const sale = await loadSaleForPaypal(env, saleId);
  const extracted = {
    status: resource.status || "",
    captureId: resource.id || "",
    amount: resource.amount && resource.amount.value,
    currency: resource.amount && resource.amount.currency_code,
    payeeEmail: (resource.payee && resource.payee.email_address) || "",
    customId: resource.custom_id,
    invoiceId: resource.invoice_id
  };
  const check = validateRestCaptureStrict(sale, extracted);
  if (!check.ok) return json({ ok: true, ignored: check.reason });
  const marked = await markSalePaid(env, sale, extracted.captureId, "", { source: "webhook" }, null, request);
  if (marked && marked.ok && !marked.idempotent) {
    await notifySalePaid(env, request, sale, "Pagamento PayPal ricevuto.");
  }
  return json({ ok: true, status: marked.ok ? "paid" : "conflict" });
}
