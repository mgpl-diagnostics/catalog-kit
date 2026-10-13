import { CATALOG } from "./data.generated";
import { createSearchIndex, type SearchHit, type SearchIndex, type SearchOptions } from "./search";
import type { Interval, LabTest, Parameter, Sex } from "./types";

export * from "./types";
export { createSearchIndex, normalize, SYNONYMS } from "./search";
export type { SearchHit, SearchIndex, SearchOptions } from "./search";
export { CATALOG };

/** Every test, in catalog order. */
export const TESTS: readonly LabTest[] = CATALOG.tests;

const byId = new Map<number, LabTest>(TESTS.map((t) => [t.id, t]));
const byCode = new Map<string, LabTest>();
for (const t of TESTS)
  for (const c of [t.code, t.shortCode, t.searchCode]) if (c && !byCode.has(c.toUpperCase())) byCode.set(c.toUpperCase(), t);

/** Sorted list of departments. */
export const DEPARTMENTS: readonly string[] = [...new Set(TESTS.map((t) => t.department))].sort();
/** Sorted list of primary sample types. */
export const SAMPLE_TYPES: readonly string[] = [...new Set(TESTS.map((t) => t.sampleType).filter((s): s is string => !!s))].sort();

export function getTest(id: number): LabTest | undefined {
  return byId.get(id);
}

/** By test code, short code or search code (case-insensitive), e.g. "CBC", "LIFT", "HBA1C". */
export function getTestByCode(code: string): LabTest | undefined {
  return byCode.get(code.trim().toUpperCase());
}

export function testsByDepartment(department: string): LabTest[] {
  return TESTS.filter((t) => t.department === department);
}

export function testsBySampleType(sampleType: string): LabTest[] {
  return TESTS.filter((t) => t.sampleType === sampleType);
}

/** Tests with more than one parameter (CBC, LFT, Kidney Profile, Thyroid Profile…). */
export function isProfile(test: LabTest): boolean {
  return test.parameters.filter((p) => p.type !== "title" && p.name).length > 1;
}

let index: SearchIndex | undefined;
/** Fuzzy search over names, codes, parameters, departments and sample types. */
export function search(query: string, options?: SearchOptions): SearchHit[] {
  index ??= createSearchIndex(TESTS);
  return index.search(query, options);
}

/** Reference interval for a sex (falls back to the other sex when only one is set). */
export function rangeFor(param: Parameter, sex?: Sex): Interval | null {
  if (sex === "female") return param.female ?? param.male;
  return param.male ?? param.female;
}

/** "13 - 17", "< 5", "> 40", or the narrative reference when there is no interval. */
export function formatRange(param: Parameter, sex?: Sex): string {
  const r = rangeFor(param, sex);
  if (r) {
    const { low, high } = r;
    if (low != null && high != null && low !== "" && high !== "") return `${low} - ${high}`;
    if (high != null && high !== "") return `< ${high}`;
    if (low != null && low !== "") return `> ${low}`;
  }
  if (param.options?.length) return param.options.join(" / ");
  return param.referenceText ?? "";
}

/** Flag a numeric result: "L" below, "H" above, "" inside or not comparable. */
export function flagResult(param: Parameter, value: number, sex?: Sex): "L" | "H" | "" {
  const r = rangeFor(param, sex);
  if (!r) return "";
  const low = typeof r.low === "number" ? r.low : Number.NaN;
  const high = typeof r.high === "number" ? r.high : Number.NaN;
  if (!Number.isNaN(low) && value < low) return "L";
  if (!Number.isNaN(high) && value > high) return "H";
  return "";
}

/** Total price for a set of test ids or codes. Unknown entries are reported, not ignored. */
export function totalPrice(items: (number | string)[]): { total: number; tests: LabTest[]; unknown: (number | string)[] } {
  const tests: LabTest[] = [];
  const unknown: (number | string)[] = [];
  for (const it of items) {
    const t = typeof it === "number" ? getTest(it) : getTestByCode(it);
    if (t) tests.push(t);
    else unknown.push(it);
  }
  return { total: tests.reduce((s, t) => s + (t.mrp ?? 0), 0), tests, unknown };
}
