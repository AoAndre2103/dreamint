import test from "node:test";
import assert from "node:assert/strict";
import { generateTransferCode, normalizeTransferCode, makeTransferCode } from "../functions/lib/certificate.js";

test("transfer codes have the DM-xxxx-xxxx-xxxx shape and normalize to alphanumerics", () => {
  for (let i = 0; i < 20; i++) {
    const c = generateTransferCode();
    assert.match(c, /^DM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const n = normalizeTransferCode(c);
    assert.equal(n.length, 14);
    assert.match(n, /^DM[A-Z0-9]{12}$/);
  }
});

test("makeTransferCode returns a unique code and a sha-256 hash of the normalized form", async () => {
  const a = await makeTransferCode();
  const b = await makeTransferCode();
  assert.match(a.code, /^DM-/);
  assert.equal(a.hash.length, 64);
  assert.match(a.hash, /^[a-f0-9]+$/);
  assert.ok(a.at);
  assert.notEqual(a.code, b.code);
  assert.notEqual(a.hash, b.hash);
});
