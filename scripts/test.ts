// npm test — data integrity, lookups, ranges, search quality and search speed.
import {
  DEPARTMENTS, SAMPLE_TYPES, TESTS, createSearchIndex, flagResult, formatRange, getTest, getTestByCode,
  isProfile, search, totalPrice,
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

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
