// npm test — data integrity, lookups, ranges, search quality and search speed.
import {
  DEPARTMENTS, ID_PATTERN, ID_PREFIX, SAMPLE_TYPES, TESTS, createSearchIndex, flagResult, formatRange, getTest,
  getTestByCode, isPackage, isProfile, rangeFor, search, testsByKind, totalPrice, type CatalogKind,
  computeCalculated, evaluate, formulaFor, resolvedFormulas, roundResult,
} from "../src/index";

let failed = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`ok    ${msg}`);
  else { failed++; console.log(`FAIL  ${msg}`); }
};

// ---- data
ok(TESTS.length >= 600, `${TESTS.length} tests`);
ok(new Set(TESTS.map((t) => t.id)).size === TESTS.length, "ids are unique");

// ---- MGPL ids: per-kind sequences, tests first, then profiles, then packages
const KINDS: CatalogKind[] = ["test", "profile", "package"];
ok(TESTS.every((t) => KINDS.includes(t.kind)), "every entry has a kind (test, profile or package)");
ok(TESTS.every((t) => ID_PATTERN.test(t.id) && t.id.startsWith(ID_PREFIX[t.kind])), "every id is MGPL + kind letter + 4 digits");
const ranks = TESTS.map((t) => KINDS.indexOf(t.kind));
ok(ranks.every((r, i) => i === 0 || ranks[i - 1]! <= r), "catalog order: tests, then profiles, then packages");
for (const kind of KINDS) {
  const ids = testsByKind(kind).map((t) => t.id);
  const seq = ids.every((id, i) => id === `${ID_PREFIX[kind]}${String(i + 1).padStart(4, "0")}`);
  ok(seq, `${kind} ids run ${ids[0] ?? "-"}…${ids[ids.length - 1] ?? "-"} with no gaps (${ids.length})`);
}
const legacy = TESTS.map((t) => t.legacyId).filter((n): n is number => n != null);
ok(new Set(legacy).size === legacy.length, `legacy ids are unique (${legacy.length})`);
const allCodes = TESTS.flatMap((t) => [t.code, t.shortCode, t.searchCode]).filter((c): c is string => !!c);
ok(allCodes.every((c) => !/^MGPL/i.test(c)), "no test code looks like an MGPL id");
ok(testsByKind("profile").length >= 25, `${testsByKind("profile").length} profiles`);
ok(TESTS.every((t) => t.name && t.department), "every test has a name and department");
ok(TESTS.every((t) => t.sampleType), "every test has a sample type");
const params = TESTS.flatMap((t) => t.parameters);
ok(params.length > 1800, `${params.length} parameters`);
ok(params.every((p) => !/<[a-z][^>]*>/i.test(p.referenceText ?? "")), "no HTML left in reference text");
ok(params.every((p) => !/&[a-z]+;/i.test(p.referenceText ?? "")), "no HTML entities left in reference text");
ok(params.every((p) => !p.unit || p.unit === p.unit.trim()), "units are trimmed");
ok(params.filter((p) => p.formula).every((p) => p.formulaText), "every formula has a readable formulaText");
const priced = TESTS.filter((t) => (t.mrp ?? 0) > 0);
ok(priced.length >= 600, `${priced.length} tests priced`);
ok(priced.every((t) => t.mrp! % 10 === 9), "prices end in 9");
ok(DEPARTMENTS.length === 9, `departments: ${DEPARTMENTS.join(", ")}`);
ok(SAMPLE_TYPES.includes("SERUM") && SAMPLE_TYPES.includes("EDTA") && SAMPLE_TYPES.includes("URINE"), `${SAMPLE_TYPES.length} sample types`);

// ---- lookups
const cbc = getTestByCode("cbc");
ok(cbc?.name === "Complete Blood Count (CBC)", `getTestByCode("cbc") → ${cbc?.name}`);
ok(cbc && getTest(cbc.id) === cbc, `getTest("${cbc?.id}")`);
ok(cbc && getTest(cbc.id.toLowerCase()) === cbc, "getTest(id) is case-insensitive");
ok(cbc && cbc.legacyId != null && getTest(cbc.legacyId) === cbc, `getTest(${cbc?.legacyId}) finds the legacy id`);
ok(cbc && !isProfile(cbc) && cbc.id.startsWith("MGPLT"), "CBC is a test");
const lipid = getTestByCode("LIPR");
ok(lipid && isProfile(lipid) && !isPackage(lipid) && lipid.id.startsWith("MGPLP"), `Lipid Profile is a profile (${lipid?.id})`);
ok(getTest("MGPLT9999") === undefined && getTest(1) === undefined, "unknown ids → undefined");
const hb = cbc?.parameters.find((p) => p.name === "Hemoglobin");
ok(hb?.unit === "g/dL", `Hemoglobin unit ${hb?.unit}`);
ok(hb && formatRange(hb, "male") === "13 - 17" && formatRange(hb, "female") === "11 - 16", `Hb range M ${hb && formatRange(hb, "male")} / F ${hb && formatRange(hb, "female")}`);
ok(hb && flagResult(hb, 10.2, "female") === "L" && flagResult(hb, 18, "male") === "H" && flagResult(hb, 14, "male") === "", "flagResult L / H / normal");
const t = totalPrice(["CBC", "HBA1C", "nope"]);
ok(t.tests.length === 2 && t.unknown[0] === "nope" && t.total === t.tests[0]!.mrp! + t.tests[1]!.mrp!, `totalPrice → Rs. ${t.total}, unknown ${t.unknown}`);

const byIds = totalPrice(["MGPLT0001", "mgplp0001", TESTS[1]!.legacyId!]);
ok(byIds.unknown.length === 0 && byIds.tests[0] === TESTS[0] && byIds.tests[1] === testsByKind("profile")[0] && byIds.tests[2] === TESTS[1],
  "totalPrice takes MGPL ids, lower case and legacy ids");

// ---- every entry in data/catalog.json works through the public API
const broken: string[] = [];
for (const e of TESTS) {
  const why: string[] = [];
  if (getTest(e.id) !== e) why.push("getTest(id)");
  if (e.legacyId != null && getTest(e.legacyId) !== e) why.push("getTest(legacyId)");
  const hit = e.code ? getTestByCode(e.code) : undefined;
  if (e.code && ![hit?.code, hit?.shortCode, hit?.searchCode].some((c) => c?.toUpperCase() === e.code!.toUpperCase())) why.push("getTestByCode(code)");
  if (!search(e.id, { limit: 1 }).some((h) => h.test === e)) why.push("search(id)");
  if (!search(e.name, { limit: 10 }).some((h) => h.test.name.toLowerCase() === e.name.toLowerCase())) why.push("search(name)");
  const one = totalPrice([e.id]);
  if (one.tests[0] !== e || one.total !== (e.mrp ?? 0)) why.push("totalPrice([id])");
  if (e.parameterCount !== e.parameters.length) why.push(`parameterCount ${e.parameterCount} ≠ ${e.parameters.length}`);
  for (const p of e.parameters) {
    if (typeof formatRange(p, "male") !== "string" || typeof formatRange(p, "female") !== "string") why.push(`formatRange(${p.name})`);
    const r = rangeFor(p, "male");
    if (p.type === "numeric" && r && typeof r.low === "number" && flagResult(p, r.low - 1, "male") !== "L") why.push(`flagResult(${p.name})`);
  }
  if (why.length) broken.push(`${e.id} ${e.name}: ${why.join(", ")}`);
}
// A code shared by two entries resolves to the first one; list them so the data can be cleaned up.
const shared = TESTS.filter((e) => e.code && getTestByCode(e.code) !== e).map((e) => `${e.code} (${e.id} ${e.name} → ${getTestByCode(e.code!)!.id})`);
if (shared.length) console.log(`note  codes shared by two entries: ${shared.join("; ")}`);
ok(broken.length === 0, `all ${TESTS.length} entries work by id, legacy id, code, search, price and ranges`);
for (const b of broken.slice(0, 20)) console.log(`      ${b}`);

// ---- search quality: the query → a test whose name matches, in the top 3
const expect: [string, RegExp][] = [
  ["lft", /liver function/i],
  ["kft", /kidney profile/i],
  ["rft", /kidney profile/i],
  ["cbc", /complete blood count/i],
  ["hemogram", /complete blood count/i],
  ["thyroid", /thyroid profile/i],
  ["tsh", /tsh/i],
  ["hba1c", /hba1c/i],
  ["sugar fasting", /glucose f/i],
  ["fbs", /glucose f/i],
  ["ppbs", /glucose pp/i],
  ["vit d", /vitamin d/i],
  ["vitamin b12", /b12/i],
  ["lipid", /lipid profile/i],
  ["haemoglobin", /h(a)?emoglobin|hb/i],
  ["urine routine", /urine/i],
  ["blood group", /blood group/i],
  ["widal", /widal/i],
  ["dengue", /dengue/i],
  ["thyriod", /thyroid/i], // typo
  ["cholestrol", /cholesterol|lipid/i], // typo
  ["creatinin", /creatinine/i], // prefix
];
for (const [q, re] of expect) {
  const top = search(q, { limit: 3 }).map((h) => h.test.name);
  ok(top.some((n) => re.test(n)), `search("${q}") → ${top.join(" | ") || "(nothing)"}`);
}
ok(search("serum", { sampleType: "URINE" }).every((h) => h.test.sampleType === "URINE"), "sampleType filter");
ok(search("", {}).length === 0, "empty query → no results");

// ---- speed
const t0 = performance.now();
const idx = createSearchIndex(TESTS);
const build = performance.now() - t0;
const queries = expect.map(([q]) => q);
const N = 20_000;
const t1 = performance.now();
for (let i = 0; i < N; i++) idx.search(queries[i % queries.length]!, { limit: 10 });
const per = ((performance.now() - t1) / N) * 1000;
console.log(`\nindex build ${build.toFixed(1)} ms · ${per.toFixed(1)} µs per query (${N} queries)`);
ok(per < 1000, "search under 1 ms per query");

// ---- calculated parameters
{
  let withFormula = 0, resolved = 0;
  for (const t of TESTS) {
    const r = resolvedFormulas(t);
    for (const p of t.parameters) if (p.calculated && p.formula) { withFormula++; if (r.some((f) => f.param === p)) resolved++; }
  }
  ok(resolved >= withFormula - 1, `formulas resolved to their test's parameters: ${resolved} of ${withFormula}`);
  const lft = TESTS.find((t) => t.code === "LIFT")!;
  const v = computeCalculated(lft, { "BILIRUBIN - TOTAL": "2.60", "BILIRUBIN -DIRECT": "1.10", "TOTAL-PROTEIN": "7.60", "ALBUMIN - SERUM": "4.40" });
  ok(v["BILIRUBIN (INDIRECT)"] === 1.5 && v["GLOBULIN"] === 3.2, "LFT: indirect bilirubin = total − direct, globulin = protein − albumin");
  ok(v["ALB/GLOBULIN RATIO"] === 1.38, "LFT: A/G ratio follows the calculated globulin (chain)");
  ok(formulaFor(lft, "GLOBULIN")?.inputs.join("|") === "TOTAL-PROTEIN|ALBUMIN - SERUM", "names with dashes align (longest name first)");
  ok(!("BILIRUBIN (INDIRECT)" in computeCalculated(lft, { "BILIRUBIN - TOTAL": "2.6" })), "a missing input computes nothing");
  ok(computeCalculated(lft, { "BILIRUBIN - TOTAL": "2.6", "BILIRUBIN -DIRECT": "1.1", "BILIRUBIN (INDIRECT)": "1.4" })["BILIRUBIN (INDIRECT)"] === undefined, "an entered value is never replaced");
  ok(!("ALB/GLOBULIN RATIO" in computeCalculated(lft, { "ALBUMIN - SERUM": "4", GLOBULIN: "0" })), "division by zero computes nothing");
  ok(!("BILIRUBIN (INDIRECT)" in computeCalculated(lft, { "BILIRUBIN - TOTAL": "high", "BILIRUBIN -DIRECT": "1" })), "a text value computes nothing");
  const gfr = TESTS.find((t) => t.code === "GFR")!;
  const e = computeCalculated(gfr, { CREATININE: "0.8" }, { sex: "female", ageYears: 33 })["GLOMERULAR FILTRATION RATE (GFR)"];
  ok(e !== undefined && Math.abs(e - 98.53) < 0.1, `eGFR (CKD-EPI) female 33 y, creatinine 0.8 → ${e}`);
  ok(Object.keys(computeCalculated(gfr, { CREATININE: "0.8" })).length === 0, "eGFR needs sex and age: none given, nothing computed");
  ok(evaluate("min(#0,1)^-2", [0.5]) === 4 && evaluate("2^3^2", []) === 512 && evaluate("-(#0+1)*2", [1]) === -4, "evaluator: min, right-assoc ^, unary minus");
  ok(roundResult(1.3800000001) === 1.38 && roundResult(0.012345) === 0.0123, "results are rounded for printing");
  let threw = false;
  try { evaluate("process.exit(1)", []); } catch { threw = true; }
  ok(threw, "anything but arithmetic is refused (no eval)");
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
