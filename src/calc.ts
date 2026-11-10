/**
 * Calculated parameters: resolve each formula to the test's own parameters, and evaluate it safely.
 *
 * The lab software stores a formula twice: `formula` with references as `pr_<id>` (ids we don't have) and
 * `formulaText` with the parameter names in the same places ("BILIRUBIN - TOTAL-BILIRUBIN -DIRECT").
 * Names contain dashes, spaces and brackets, so the two are aligned token by token against the names of the
 * test's parameters, longest name first, with backtracking. A formula that does not align stays manual.
 *
 * The evaluator is a small recursive-descent parser (no eval, no Function): numbers, + - * / ^ (right
 * associative), unary minus, parentheses, min(…), max(…), `age` (years) and sex-specific constants
 * written `m_0.9 f_0.7` (as in the CKD-EPI eGFR formula).
 */
import type { LabTest, Parameter, Sex } from "./types";

export interface CalcContext {
  sex?: Sex;
  /** patient age in years (decimals allowed) */
  ageYears?: number;
}

/** A calculated parameter whose formula resolved to other parameters of the same test. */
export interface ResolvedFormula {
  /** the calculated parameter */
  param: Parameter & { name: string };
  /** the parameters it reads, by name, in the order of the formula's references */
  inputs: string[];
  /** formula with references replaced by `#0`, `#1`, … (indexes into `inputs`) */
  expression: string;
  /** needs the patient's sex (m_ / f_ constants) */
  needsSex: boolean;
  /** needs the patient's age */
  needsAge: boolean;
}

const cache = new WeakMap<LabTest, ResolvedFormula[]>();
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Align `formula` (pr_<id> refs) with `formulaText` (names) using the test's parameter names. */
function align(formula: string, text: string, names: string[]): string[] | null {
  const parts = formula.split(/(pr_\d+)/).filter((p) => p !== "");
  const byLength = [...new Set(names)].sort((a, b) => b.length - a.length);
  const ids = new Map<string, string>();
  const t = text;
  const go = (pi: number, ti: number): boolean => {
    // skip insignificant whitespace differences
    while (ti < t.length && t[ti] === " " && !(parts[pi] ?? "").startsWith(" ")) ti++;
    if (pi === parts.length) return t.slice(ti).trim() === "";
    const part = parts[pi]!;
    if (!/^pr_\d+$/.test(part)) {
      const lit = part.replace(/\s+/g, "");
      let j = ti, k = 0;
      while (k < lit.length && j < t.length) {
        if (t[j] === " ") { j++; continue; }
        if (t[j] !== lit[k]) return false;
        j++; k++;
      }
      return k === lit.length && go(pi + 1, j);
    }
    const known = ids.get(part);
    const candidates = known ? [known] : byLength;
    for (const name of candidates) {
      if (norm(t.slice(ti, ti + name.length)) !== norm(name)) continue;
      const had = ids.has(part);
      ids.set(part, name);
      if (go(pi + 1, ti + name.length)) return true;
      if (!had) ids.delete(part);
    }
    return false;
  };
  if (!go(0, 0)) return null;
  return parts.filter((p) => /^pr_\d+$/.test(p)).map((p) => ids.get(p)!);
}

/** The test's calculated parameters whose formulas resolve (cached per test). */
export function resolvedFormulas(test: LabTest): ResolvedFormula[] {
  const hit = cache.get(test);
  if (hit) return hit;
  const names = test.parameters.map((p) => p.name).filter((n): n is string => !!n);
  const out: ResolvedFormula[] = [];
  for (const param of test.parameters) {
    if (!param.name || !param.calculated || !param.formula || !param.formulaText) continue;
    const refs = align(param.formula, param.formulaText, names.filter((n) => n !== param.name));
    if (!refs) continue;
    const inputs: string[] = [];
    let n = 0;
    const expression = param.formula.replace(/pr_\d+/g, () => {
      const name = refs[n++]!;
      let idx = inputs.indexOf(name);
      if (idx < 0) idx = inputs.push(name) - 1;
      return `#${idx}`;
    });
    try {
      parse(expression); // reject what the evaluator cannot read
    } catch {
      continue;
    }
    out.push({ param: param as Parameter & { name: string }, inputs, expression, needsSex: /\b[mf]_/.test(expression), needsAge: /\bage\b/.test(expression) });
  }
  cache.set(test, out);
  return out;
}

/** The resolved formula of one parameter, or null when it is entered by hand (or from an analyzer). */
export function formulaFor(test: LabTest, paramName: string): ResolvedFormula | null {
  return resolvedFormulas(test).find((f) => f.param.name === paramName) ?? null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").trim();
  return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s) ? Number(s) : null;
};

/** Round for printing: 2 decimals, 3 significant digits for values below 1; no float noise. */
export function roundResult(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const decimals = Math.abs(x) >= 1 ? 2 : Math.min(6, 2 - Math.floor(Math.log10(Math.abs(x))));
  return Number(x.toFixed(decimals));
}

/**
 * Values of the test's calculated parameters, from the values entered (by parameter name).
 * Returns only what can be computed: every input present and numeric, the result finite, and sex / age
 * known when the formula needs them. Chains (A/G ratio from a calculated globulin) are followed.
 * Values already present in `values` are never replaced.
 */
export function computeCalculated(test: LabTest, values: Record<string, unknown>, ctx: CalcContext = {}): Record<string, number> {
  const known = new Map<string, number>();
  for (const [k, v] of Object.entries(values)) {
    const n = num(v);
    if (n !== null) known.set(k, n);
  }
  const out: Record<string, number> = {};
  const formulas = resolvedFormulas(test).filter((f) => !(f.param.name in values) || num(values[f.param.name]) === null);
  for (let pass = 0, progress = true; progress && pass < 8; pass++) {
    progress = false;
    for (const f of formulas) {
      if (f.param.name in out) continue;
      if ((f.needsSex && !ctx.sex) || (f.needsAge && ctx.ageYears == null)) continue;
      const args = f.inputs.map((n) => known.get(n));
      if (args.some((a) => a === undefined)) continue;
      let r: number;
      try {
        r = evaluate(f.expression, args as number[], ctx);
      } catch {
        continue;
      }
      if (!Number.isFinite(r)) continue;
      out[f.param.name] = roundResult(r);
      known.set(f.param.name, out[f.param.name]!);
      progress = true;
    }
  }
  return out;
}

// ---- the evaluator ------------------------------------------------------------------------------------

type Node =
  | { k: "n"; v: number }
  | { k: "ref"; i: number }
  | { k: "age" }
  | { k: "sex"; m: number; f: number }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "fn"; name: "min" | "max"; args: Node[] };

const parsed = new Map<string, Node>();

function parse(src: string): Node {
  const hit = parsed.get(src);
  if (hit) return hit;
  let i = 0;
  const ws = () => { while (src[i] === " ") i++; };
  const peek = () => (ws(), src[i]);
  const eat = (c: string) => { if (peek() !== c) throw new Error(`expected ${c} at ${i} in ${src}`); i++; };
  const number = (): number => {
    ws();
    const m = /^\d*\.?\d+/.exec(src.slice(i));
    if (!m) throw new Error(`number expected at ${i} in ${src}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const primary = (): Node => {
    ws();
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (src[i] === "(") { i++; const e = expr(); eat(")"); return e; }
    if ((m = /^#(\d+)/.exec(rest))) { i += m[0].length; return { k: "ref", i: Number(m[1]) }; }
    if ((m = /^m_(\d*\.?\d+)\s*f_(\d*\.?\d+)/.exec(rest))) { i += m[0].length; return { k: "sex", m: Number(m[1]), f: Number(m[2]) }; }
    if ((m = /^(min|max)\s*\(/.exec(rest))) {
      i += m[0].length;
      const args = [expr()];
      while (peek() === ",") { i++; args.push(expr()); }
      eat(")");
      return { k: "fn", name: m[1] as "min" | "max", args };
    }
    if (/^age\b/.test(rest)) { i += 3; return { k: "age" }; }
    return { k: "n", v: number() };
  };
  const unary = (): Node => (peek() === "-" ? (i++, { k: "neg", a: unary() }) : peek() === "+" ? (i++, unary()) : primary());
  const power = (): Node => {
    const a = unary();
    if (peek() === "^") { i++; return { k: "bin", op: "^", a, b: power() }; }
    return a;
  };
  const term = (): Node => {
    let a = power();
    for (let c = peek(); c === "*" || c === "/"; c = peek()) { i++; a = { k: "bin", op: c, a, b: power() }; }
    return a;
  };
  const expr = (): Node => {
    let a = term();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) { i++; a = { k: "bin", op: c, a, b: term() }; }
    return a;
  };
  const node = expr();
  ws();
  if (i !== src.length) throw new Error(`unexpected "${src.slice(i)}" in ${src}`);
  parsed.set(src, node);
  return node;
}

/** Evaluate a resolved expression with its input values (`#i` = args[i]). */
export function evaluate(expression: string, args: number[], ctx: CalcContext = {}): number {
  const run = (n: Node): number => {
    switch (n.k) {
      case "n": return n.v;
      case "ref": { const v = args[n.i]; if (v === undefined) throw new Error(`missing input #${n.i}`); return v; }
      case "age": if (ctx.ageYears == null) throw new Error("age needed"); return ctx.ageYears;
      case "sex": if (!ctx.sex) throw new Error("sex needed"); return ctx.sex === "female" ? n.f : n.m;
      case "neg": return -run(n.a);
      case "fn": { const v = n.args.map(run); return n.name === "min" ? Math.min(...v) : Math.max(...v); }
      case "bin": {
        const a = run(n.a), b = run(n.b);
        return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : a ** b;
      }
    }
  };
  return run(parse(expression));
}
