import type { LabTest } from "./types";

/**
 * In-memory search over tests. Built once (≈ 20 ms), then each query costs
 * O(query words × log vocabulary) plus postings:
 *   1. exact word / code hits       (inverted index, Map)
 *   2. prefix hits                  (sorted vocabulary + binary search)
 *   3. typo-tolerant fallback       (trigram index, Dice similarity)
 * Lab shorthand (LFT, KFT, SGPT, FBS, Vit D…) is expanded through SYNONYMS.
 */

export interface SearchOptions {
  /** Max results. Default 20. */
  limit?: number;
  /** Only tests from this department. */
  department?: string;
  /** Only tests with this sample type. */
  sampleType?: string;
  /** Allow typo matches. Default true. */
  fuzzy?: boolean;
}

export interface SearchHit {
  test: LabTest;
  score: number;
}

/**
 * Shorthand → alternatives separated by "|". Each alternative is a phrase whose words must all
 * match (so "b12" → "vitamin b12" does not match Vitamin C on the word "vitamin" alone).
 * Keys may be single words or whole queries ("vit d").
 */
export const SYNONYMS: Record<string, string> = {
  lft: "liver function",
  kft: "kidney profile|renal",
  rft: "kidney profile|renal",
  renal: "kidney",
  cbc: "complete blood count",
  hemogram: "complete blood count",
  tft: "thyroid profile",
  sgpt: "alt|alanine",
  sgot: "ast|aspartate",
  fbs: "glucose f|fasting glucose|sugar fasting",
  bsf: "glucose f|fasting glucose|sugar fasting",
  ppbs: "glucose pp|post prandial",
  bspp: "glucose pp|post prandial",
  rbs: "glucose r|random glucose|sugar random",
  sugar: "glucose",
  vitd: "vitamin d",
  "vit d": "vitamin d",
  vitb12: "vitamin b12|cobalamine",
  b12: "vitamin b12|cobalamine",
  "vit b12": "vitamin b12|cobalamine",
  crp: "c reactive protein|crp",
  hb: "hemoglobin",
  urm: "urine routine",
  "urine r m": "urine routine",
  lipid: "lipid profile",
  a1c: "hba1c",
  psa: "prostate specific antigen|psa",
  hcg: "beta hcg|hcg",
  upt: "pregnancy",
};

const FOLDS: [RegExp, string][] = [
  [/ae/g, "e"], // haemoglobin → hemoglobin
  [/oe/g, "e"], // oestradiol → estradiol
  [/leuc/g, "leuk"],
  [/sulph/g, "sulf"],
];

/** lower-case, strip accents, fold British/American spellings, keep letters/digits. */
export function normalize(s: string): string {
  let t = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [re, to] of FOLDS) t = t.replace(re, to);
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

const words = (s: string) => normalize(s).split(" ").filter(Boolean);
const synonymAlternatives = (key: string): string[][] =>
  (SYNONYMS[key] ?? "").split("|").map(words).filter((a) => a.length);

function trigrams(word: string): string[] {
  const w = `  ${word} `;
  const out: string[] = [];
  for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
  return out;
}

const W = { code: 10, name: 4, param: 1.5, dept: 1, sample: 1 } as const;

interface Posting {
  doc: number;
  weight: number;
}

export interface SearchIndex {
  search(query: string, options?: SearchOptions): SearchHit[];
  readonly size: number;
}

export function createSearchIndex(tests: readonly LabTest[]): SearchIndex {
  const postings = new Map<string, Posting[]>();
  const codes = new Map<string, number[]>();
  const names = tests.map((t) => normalize(t.name));
  const compactNames = names.map((n) => n.replace(/ /g, ""));

  const add = (token: string, doc: number, weight: number) => {
    let list = postings.get(token);
    if (!list) postings.set(token, (list = []));
    const last = list[list.length - 1];
    if (last && last.doc === doc) last.weight = Math.max(last.weight, weight);
    else list.push({ doc, weight });
  };

  tests.forEach((t, doc) => {
    for (const c of [t.code, t.shortCode, t.searchCode]) {
      if (!c) continue;
      const k = normalize(c).replace(/ /g, "");
      if (!k) continue;
      const list = codes.get(k) ?? [];
      if (!list.includes(doc)) list.push(doc);
      codes.set(k, list);
      add(k, doc, W.code);
    }
    const nameWords = words(t.name);
    for (const w of nameWords) add(w, doc, W.name);
    // joined neighbours, so "VITAMIN B-12" also answers "b12" and "T 3" answers "t3"
    for (let i = 0; i + 1 < nameWords.length; i++) add(nameWords[i]! + nameWords[i + 1]!, doc, W.name * 0.9);
    for (const w of words(t.department)) add(w, doc, W.dept);
    if (t.sampleType) for (const w of words(t.sampleType)) add(w, doc, W.sample);
    for (const p of t.parameters) if (p.name) for (const w of words(p.name)) add(w, doc, W.param);
  });

  const vocab = [...postings.keys()].sort();
  const grams = new Map<string, number[]>(); // trigram → vocab indexes
  vocab.forEach((word, i) => {
    if (word.length < 3) return;
    for (const g of new Set(trigrams(word))) {
      const list = grams.get(g) ?? [];
      list.push(i);
      grams.set(g, list);
    }
  });

  /** first vocab index ≥ prefix */
  const lowerBound = (prefix: string) => {
    let lo = 0;
    let hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (vocab[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const wordCache = new Map<string, Map<number, number>>();
  /** score per doc for one word: exact > prefix > typo */
  function matchWord(w: string, fuzzy: boolean): Map<number, number> {
    const key = `${fuzzy ? 1 : 0}${w}`;
    const cached = wordCache.get(key);
    if (cached) return cached;
    const scores = new Map<number, number>();
    const bump = (word: string, factor: number) => {
      for (const p of postings.get(word) ?? []) scores.set(p.doc, Math.max(scores.get(p.doc) ?? 0, p.weight * factor));
    };
    if (postings.has(w)) bump(w, 3);
    for (let i = lowerBound(w); i < vocab.length && vocab[i]!.startsWith(w); i++)
      if (vocab[i] !== w) bump(vocab[i]!, w.length >= 3 ? 2 : 1.2);
    if (scores.size === 0 && fuzzy && w.length >= 4) {
      const q = trigrams(w);
      const counts = new Map<number, number>();
      for (const g of new Set(q)) for (const vi of grams.get(g) ?? []) counts.set(vi, (counts.get(vi) ?? 0) + 1);
      for (const [vi, shared] of counts) {
        const word = vocab[vi]!;
        const dice = (2 * shared) / (q.length + trigrams(word).length);
        if (dice >= 0.5) bump(word, dice);
      }
    }
    if (wordCache.size > 5000) wordCache.clear();
    wordCache.set(key, scores);
    return scores;
  }

  /** docs matching every word of a phrase; score = mean word score */
  function matchPhrase(phrase: string[], fuzzy: boolean): Map<number, number> {
    const maps = phrase.map((w) => matchWord(w, fuzzy));
    maps.sort((a, b) => a.size - b.size);
    const out = new Map<number, number>();
    for (const [doc, s] of maps[0] ?? []) {
      let sum = s;
      let all = true;
      for (let i = 1; i < maps.length; i++) {
        const v = maps[i]!.get(doc);
        if (v === undefined) { all = false; break; }
        sum += v;
      }
      if (all) out.set(doc, sum / phrase.length);
    }
    return out;
  }

  /** best score per doc over alternatives (synonym phrases slightly below the literal words) */
  function matchGroup(alternatives: string[][], fuzzy: boolean): Map<number, number> {
    const out = new Map<number, number>();
    alternatives.forEach((alt, i) => {
      for (const [doc, s] of matchPhrase(alt, fuzzy)) {
        const v = i === 0 ? s : s * 0.95;
        if (v > (out.get(doc) ?? 0)) out.set(doc, v);
      }
    });
    return out;
  }

  function search(query: string, options: SearchOptions = {}): SearchHit[] {
    const limit = options.limit ?? 20;
    const fuzzy = options.fuzzy ?? true;
    const raw = normalize(query);
    if (!raw) return [];
    const compact = raw.replace(/ /g, "");
    const rawWords = raw.split(" ");

    // a whole-query synonym ("vit d") makes one group; otherwise one group per word
    const whole = SYNONYMS[raw] ? raw : SYNONYMS[compact] ? compact : null;
    const groups: string[][][] = whole
      ? [[rawWords, ...synonymAlternatives(whole)]]
      : rawWords.map((w) => [[w], ...synonymAlternatives(w)]);
    const phrases = whole ? [raw, ...synonymAlternatives(whole).map((a) => a.join(" "))] : [raw];

    const total = new Map<number, number>();
    const hitCount = new Map<number, number>();
    for (const g of groups)
      for (const [doc, s] of matchGroup(g, fuzzy)) {
        total.set(doc, (total.get(doc) ?? 0) + s);
        hitCount.set(doc, (hitCount.get(doc) ?? 0) + 1);
      }
    for (const doc of codes.get(compact) ?? []) {
      total.set(doc, (total.get(doc) ?? 0) + 100);
      hitCount.set(doc, groups.length);
    }

    const hits: SearchHit[] = [];
    for (const [doc, s] of total) {
      const t = tests[doc]!;
      if (options.department && t.department !== options.department) continue;
      if (options.sampleType && t.sampleType !== options.sampleType) continue;
      let score = s * ((hitCount.get(doc) ?? 0) / groups.length) ** 2;
      const name = names[doc]!;
      let bonus = 0;
      for (const p of phrases) {
        const pc = p.replace(/ /g, "");
        if (name === p || compactNames[doc] === pc) bonus = Math.max(bonus, 50);
        else if (name.startsWith(p) || compactNames[doc]!.startsWith(pc)) bonus = Math.max(bonus, 20);
        else if (name.includes(p) || compactNames[doc]!.includes(pc)) bonus = Math.max(bonus, 8);
      }
      score += bonus - name.length / 200; // shorter, more specific names win ties
      hits.push({ test: t, score });
    }
    hits.sort((a, b) => b.score - a.score || a.test.name.localeCompare(b.test.name));
    return hits.slice(0, limit);
  }

  return { search, size: tests.length };
}
