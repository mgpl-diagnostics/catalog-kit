// npm test — data integrity, lookups, ranges, search quality and search speed.
import {
  DEPARTMENTS, SAMPLE_TYPES, TESTS, createSearchIndex, flagResult, formatRange, getTest, getTestByCode,
  isProfile, search, totalPrice,
  computeCalculated, evaluate, formulaFor, isNarrative, parseTitre, resolvedFormulas, roundResult,
} from "../src/index";

let failed = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`ok    ${msg}`);
  else { failed++; console.log(`FAIL  ${msg}`); }
};

// ---- data
ok(TESTS.length >= 600, `${TESTS.length} tests`);
ok(new Set(TESTS.map((t) => t.id)).size === TESTS.length, "test ids are unique");
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
ok(cbc && getTest(cbc.id) === cbc, "getTest(id)");
ok(cbc && isProfile(cbc), "CBC is a profile");
const hb = cbc?.parameters.find((p) => p.name === "Hemoglobin");
ok(hb?.unit === "g/dL", `Hemoglobin unit ${hb?.unit}`);
ok(hb && formatRange(hb, "male") === "13 - 17" && formatRange(hb, "female") === "11 - 16", `Hb range M ${hb && formatRange(hb, "male")} / F ${hb && formatRange(hb, "female")}`);
ok(hb && flagResult(hb, 10.2, "female") === "L" && flagResult(hb, 18, "male") === "H" && flagResult(hb, 14, "male") === "", "flagResult L / H / normal");
const t = totalPrice(["CBC", "HBA1C", "nope"]);
ok(t.tests.length === 2 && t.unknown[0] === "nope" && t.total === t.tests[0]!.mrp! + t.tests[1]!.mrp!, `totalPrice → Rs. ${t.total}, unknown ${t.unknown}`);

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
  ok(typeof e === "number" && Math.abs(e - 98.53) < 0.1, `eGFR (CKD-EPI) female 33 y, creatinine 0.8 → ${e}`);
  ok(Object.keys(computeCalculated(gfr, { CREATININE: "0.8" })).length === 0, "eGFR needs sex and age: none given, nothing computed");
  ok(evaluate("min(#0,1)^-2", [0.5]) === 4 && evaluate("2^3^2", []) === 512 && evaluate("-(#0+1)*2", [1]) === -4, "evaluator: min, right-assoc ^, unary minus");
  ok(roundResult(1.3800000001) === 1.38 && roundResult(0.012345) === 0.0123, "results are rounded for printing");
  let threw = false;
  try { evaluate("process.exit(1)", []); } catch { threw = true; }
  ok(threw, "anything but arithmetic is refused (no eval)");
}

// ---- options, narratives, titre rules
{
  const all = TESTS.flatMap((t) => t.parameters);
  ok(all.every((p) => !p.options?.some((o) => !o || o.trim() === "-")), "no \"-\" or empty placeholder among options");
  ok(all.every((p) => p.type !== "options" || (p.options?.length ?? 0) > 0), "every options parameter has choices");
  const opt = all.filter((p) => p.type === "options" && p.options!.length > 1 && !p.referenceText);
  ok(opt.every((p) => formatRange(p) === ""), `an options list is never printed as a range (${opt.length} parameters)`);
  const narratives = all.filter(isNarrative);
  ok(narratives.length > 500 && narratives.every((p) => formatRange(p) === ""), `${narratives.length} narrative blocks (interpretation, clinical significance…) are not results and print no range`);
  ok(!isNarrative(all.find((p) => p.name === "S.Typhi Antigen (O)")!) && !all.some((p) => p.type === "numeric" && isNarrative(p)), "results are never narratives");
  ok(parseTitre("1:80") === 80 && parseTitre("1 : 160") === 160 && parseTitre("<1:20") === 0 && parseTitre("Negative") === 0 && parseTitre("") === null, "parseTitre");
  const wids = TESTS.find((t) => t.code === "WIDS")!;
  ok(wids.parameters.filter((p) => /Antigen/.test(p.name ?? "")).every((p) => p.type === "options" && p.options!.includes("1:80")), "Widal slide titres are a choice of dilutions");
  const pos = computeCalculated(wids, { "S.Typhi Antigen (O)": "1:160", "S.Typhi Antigen (H)": "1:40" });
  const neg = computeCalculated(wids, { "S.Typhi Antigen (O)": "1:40", "S.Typhi Antigen (H)": "<1:20" });
  ok(pos.RESULT === "POSITIVE" && neg.RESULT === "NEGATIVE", "Widal slide: RESULT POSITIVE at 1:80 or more, else NEGATIVE");
  ok(!("RESULT" in computeCalculated(wids, {})) && !("RESULT" in computeCalculated(wids, { "S.Typhi Antigen (O)": "1:320", RESULT: "NEGATIVE" })), "no titres → no RESULT; an entered RESULT is kept");
  const widt = TESTS.find((t) => t.code === "WIDT")!;
  ok(computeCalculated(widt, { "Salmonella typhi O (TO)": "1:80", "Salmonella typhi H (TH)": "1:160" }).Result === "NEGATIVE"
    && computeCalculated(widt, { "Salmonella typhi O (TO)": "1:160" }).Result === "POSITIVE"
    && computeCalculated(widt, { "Salmonella typhi H (TH)": "1:320" }).Result === "POSITIVE", "Widal tube: O above 1:80 or H above 1:160 is POSITIVE");
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
