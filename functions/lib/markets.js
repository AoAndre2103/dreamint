// Graded cards have two markets (migrate-v17.sql): «Full Set» (physical + digital) and «Solo digitale»,
// plus «Solo carta fisica» when the physical card and the digital copy have different owners.
// Legacy listings have kind NULL and are treated as 'fullset' (ungraded listings keep the old meaning:
// the whole card). Prices: fullset = slabs.asking_price_cents (the existing price), digital =
// slabs.price_digital_cents, physical = slabs.price_physical_cents.

export const KINDS = ["fullset", "digital", "physical"];
export const PRICE_COLUMN = { fullset: "asking_price_cents", digital: "price_digital_cents", physical: "price_physical_cents" };

export function effectiveKind(kind) {
  return kind === "digital" || kind === "physical" ? kind : "fullset";
}

// Parts each kind transfers: fullset = both, digital = digital copy, physical = the slab.
export function kindsConflict(a, b) {
  const x = effectiveKind(a), y = effectiveKind(b);
  return !((x === "digital" && y === "physical") || (x === "physical" && y === "digital"));
}

// Can `userId` sell `kind` of this slab right now (ownership only)?
export function canSellKind(slab, userId, kind) {
  if (!slab || !userId || slab.is_ungraded) return false;
  const po = slab.physical_owner_id, dOwn = slab.digital_owner_id;
  if (kind === "fullset") return po === userId && dOwn === userId;
  if (kind === "digital") return dOwn === userId;
  if (kind === "physical") return po === userId && dOwn !== userId;
  return false;
}

// SQL: the listing row `a` is still sellable by its seller (ownership + not archived).
export function listingValidSql(a) {
  return `EXISTS (SELECT 1 FROM slabs vs WHERE vs.id = ${a}.slab_id AND vs.archived_at IS NULL AND (
      (COALESCE(${a}.kind,'fullset') = 'fullset' AND vs.physical_owner_id = ${a}.seller_id AND (vs.is_ungraded = 1 OR vs.digital_owner_id = ${a}.seller_id))
      OR (${a}.kind = 'digital' AND vs.is_ungraded = 0 AND vs.digital_owner_id = ${a}.seller_id)
      OR (${a}.kind = 'physical' AND vs.is_ungraded = 0 AND vs.physical_owner_id = ${a}.seller_id AND vs.digital_owner_id <> ${a}.seller_id)))`;
}

// SQL: listings `a` and `b` would transfer the same part (only digital vs physical do not conflict).
export function conflictSql(a, b) {
  return `NOT ((COALESCE(${a}.kind,'fullset') = 'digital' AND COALESCE(${b}.kind,'fullset') = 'physical')
            OR (COALESCE(${a}.kind,'fullset') = 'physical' AND COALESCE(${b}.kind,'fullset') = 'digital'))`;
}

// Price input: <kind>_cents (integer) or <kind>_euros (string like the existing prices). null/"" = remove.
export function parseMarketPrice(body, kind, parsePriceEuros) {
  const kc = "price_" + kind + "_cents", ke = "price_" + kind + "_euros";
  const has = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);
  if (!has(kc) && !has(ke)) return { present: false };
  const v = has(kc) ? body[kc] : body[ke];
  if (v === null || v === "") return { present: true, ok: true, cents: null };
  if (has(kc)) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100000000) return { present: true, ok: false, error: "Indica un prezzo di vendita in euro maggiore di zero" };
    return { present: true, ok: true, cents: n };
  }
  const p = parsePriceEuros(v);
  return p.ok ? { present: true, ok: true, cents: p.cents } : { present: true, ok: false, error: p.error };
}

// Certificate search: upper-case, spaces / dashes / dots removed; 4..40 chars.
// Known grader prefixes (PSA, BGS, CGC, …) are stripped so «PSA 12345678» matches
// certificate_no «12345678». Longer names first so «AIGRADING» wins over «AP».
export const CERT_GRADER_PREFIXES = ["AIGRADING", "VERTEX", "GRAAD", "PSA", "BGS", "CGC", "PCC", "AP"];

function compactCertQuery(q) {
  const s = String(q == null ? "" : q).toUpperCase().replace(/[\s\-.\/]+/g, "");
  if (!s || !/^[A-Z0-9]+$/.test(s) || s.length > 40) return null;
  return s;
}

export function stripGraderPrefix(compact) {
  const s = String(compact || "");
  for (const p of CERT_GRADER_PREFIXES) {
    if (s.startsWith(p) && s.length > p.length) {
      const rest = s.slice(p.length);
      if (/^[A-Z0-9]+$/.test(rest) && rest.length >= 4 && rest.length <= 40) return rest;
    }
  }
  return s;
}

// Preferred form for a single lookup: prefix stripped when the remainder is a valid cert.
export function normalizeCertQuery(q) {
  const s = compactCertQuery(q);
  if (!s) return null;
  const stripped = stripGraderPrefix(s);
  if (stripped.length < 4 || stripped.length > 40) return null;
  return stripped;
}

// Search both the raw compacted query and the prefix-stripped form, so a stored
// value that still includes the grader (e.g. «PSA 1234-xx») keeps matching.
export function certSearchValues(q) {
  const s = compactCertQuery(q);
  if (!s) return [];
  const out = [];
  const add = (v) => { if (v && v.length >= 4 && v.length <= 40 && !out.includes(v)) out.push(v); };
  add(s);
  add(stripGraderPrefix(s));
  return out;
}
export const CERT_NORM_SQL = "upper(replace(replace(replace(replace(COALESCE(s.certificate_no,''),' ',''),'-',''),'.',''),'/',''))";
