import test from "node:test";
import assert from "node:assert/strict";
import { cachePolicyFor } from "../functions/_middleware.js";
const U = (p) => new URL("https://dreamint.it" + p);
const IMM = "public, max-age=31536000, immutable";
test("versioned static assets are immutable", () => {
  assert.equal(cachePolicyFor(U("/app.js?v=20261112v4"), "GET", 200, "application/javascript", "public, max-age=0, must-revalidate"), IMM);
  assert.equal(cachePolicyFor(U("/v2-home.css?v=x1"), "HEAD", 200, "text/css", null), IMM);
  assert.equal(cachePolicyFor(U("/img/a.webp?v=3"), "GET", 200, "image/webp", null), IMM);
});
test("unversioned, errors, API, functions and HTML are never immutable", () => {
  assert.equal(cachePolicyFor(U("/app.js"), "GET", 200, "application/javascript", "public, max-age=0, must-revalidate"), null);
  assert.equal(cachePolicyFor(U("/missing.js?v=1"), "GET", 404, "text/html", null), null);
  assert.equal(cachePolicyFor(U("/api/config?v=1"), "GET", 200, "application/json", "no-store"), null);
  assert.equal(cachePolicyFor(U("/c/abc?v=1"), "GET", 200, "text/html", "public, max-age=300"), null);
  assert.equal(cachePolicyFor(U("/app.js?v=<bad>"), "GET", 200, "application/javascript", null), null);
  assert.equal(cachePolicyFor(U("/?v=1"), "GET", 200, "text/html; charset=utf-8", "no-cache"), null); // keeps its no-cache
  assert.equal(cachePolicyFor(U("/app.js?v=1"), "POST", 200, "application/javascript", null), null);
});
test("static HTML gets no-cache; a function's own policy is kept", () => {
  assert.equal(cachePolicyFor(U("/legal/faq"), "GET", 200, "text/html; charset=utf-8", "public, max-age=0, must-revalidate"), "no-cache");
  assert.equal(cachePolicyFor(U("/"), "GET", 200, "text/html", null), "no-cache");
  assert.equal(cachePolicyFor(U("/x"), "GET", 200, "text/html", "public, max-age=300"), null);
});
