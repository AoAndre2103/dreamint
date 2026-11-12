const CANONICAL_HOST = "dreamint.it";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = (url.hostname || "").toLowerCase();
  const method = context.request.method || "GET";
  const isSafe = method === "GET" || method === "HEAD";
  const isApi = url.pathname.startsWith("/api/");

  if (isSafe && host === "www.dreamint.it") {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  // Production pages.dev host only — leave preview subdomains alone, and keep /api working.
  if (isSafe && !isApi && host === "gemint-beta.pages.dev") {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  const res = await context.next();
  return withSecurityHeaders(res, url, method);
}

// Cache policy (B4). _headers cannot match the query string, so it is decided here:
// - static file requested with ?v=<version> -> immutable for a year (the URL changes on every release);
// - same file without ?v= -> unchanged (Pages default / _headers: max-age=0, must-revalidate);
// - static HTML -> no-cache (always revalidated). Functions that set their own policy keep it.
const VERSIONED_EXT = /\.(?:js|mjs|css|webp|png|jpe?g|gif|svg|ico|avif|woff2?|ttf|webmanifest)$/i;
const PAGES_DEFAULT_CC = /^public, max-age=0, must-revalidate$/i;
export function cachePolicyFor(url, method, status, contentType, existing) {
  if (method !== "GET" && method !== "HEAD") return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/c/") || status !== 200) return null;
  const ct = String(contentType || "").toLowerCase();
  const v = url.searchParams.get("v");
  if (v && /^[A-Za-z0-9._-]{1,40}$/.test(v) && VERSIONED_EXT.test(url.pathname) && !ct.startsWith("text/html")) {
    return "public, max-age=31536000, immutable";
  }
  if (ct.startsWith("text/html") && (!existing || PAGES_DEFAULT_CC.test(existing))) return "no-cache";
  return null;
}

// SECURITY (M3 / headers): applied to every response (static assets and Functions).
// Responses that already set a stricter CSP (e.g. photos) keep their own.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.tcgdex.net",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com",
  "frame-ancestors 'none'"
].join("; ");

function withSecurityHeaders(res, url, method) {
  let out;
  try {
    out = new Response(res.body, res);
  } catch (e) {
    return res;
  }
  const h = out.headers;
  const setIfMissing = (k, v) => { if (!h.has(k)) h.set(k, v); };
  const cc = cachePolicyFor(url, String(method || "GET").toUpperCase(), out.status, h.get("content-type"), h.get("cache-control"));
  if (cc) h.set("cache-control", cc);
  // HTML pages never need cross-origin reads (Pages adds ACAO * to static files).
  if (String(h.get("content-type") || "").toLowerCase().startsWith("text/html") && !url.pathname.startsWith("/api/")) h.delete("access-control-allow-origin");
  setIfMissing("content-security-policy", SITE_CSP + (url.protocol === "https:" ? "; upgrade-insecure-requests" : ""));
  setIfMissing("x-frame-options", "DENY");
  setIfMissing("x-content-type-options", "nosniff");
  setIfMissing("referrer-policy", "strict-origin-when-cross-origin");
  setIfMissing("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  setIfMissing("cross-origin-opener-policy", "same-origin");
  if (url.protocol === "https:") setIfMissing("strict-transport-security", "max-age=31536000; includeSubDomains");
  return out;
}
