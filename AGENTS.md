# AGENTS.md — @mgpl-diagnostics/catalog-kit

The test catalog for MGPL Diagnostics: every test with parameters, units, methods, reference
ranges, sample types and prices, plus search. A pure data + functions package: no dependencies,
no I/O, no UI. report-kit and invoice-kit consume it.

## Map

```
data/catalog.json        THE DATA — source of truth (edit here)
scripts/gen-data.mjs     data/catalog.json → src/data.generated.ts (git-ignored, generated on build/test)
scripts/ids.mjs          npm run ids: assigns MGPL ids to new entries, orders tests → profiles → packages
src/types.ts             LabTest, Parameter, Interval, ParameterType…
src/search.ts            inverted index + binary-search prefixes + trigram typo fallback + SYNONYMS
src/index.ts             TESTS, lookups, filters, rangeFor / formatRange / flagResult, totalPrice
scripts/test.ts          integrity, lookups, search-quality table, speed benchmark
```

## Rules

1. **Edit data in `data/catalog.json` only.** Never hand-edit `src/data.generated.ts`.
2. **Prices** are whole rupees in `mrp`; they all end in 9 (`npm test` checks it). Change prices in the JSON.
3. **Units and methods are canonical** (`mg/dL`, `g/dL`, `IU/mL`, `µmol/L`; `Calculated`, `CLIA`). Keep new
   entries in the same forms.
4. **No HTML** in `referenceText` (plain text, newlines for rows). `npm test` checks tags and entities.
5. **Calculated parameters** keep `formula` (lab-software form, `pr_<id>`) and `formulaText` (names).
6. **Search quality is tested.** When you add a shorthand to `SYNONYMS`, add a row to the `expect`
   table in `scripts/test.ts`. Synonym values are `|`-separated phrases whose words must all match.
7. **Don't invent reference ranges.** They come from the lab's test master and need a pathologist's sign-off.
8. Never commit patient data, credentials, or cost prices.
9. **Ids are MGPL ids and never change.** `MGPLT####` tests, `MGPLP####` profiles, `MGPLK####` packages, one
   gap-free sequence per kind, catalog ordered tests → profiles → packages. Add an entry with its `kind` and
   `"id": null`, then `npm run ids`. Never renumber or reuse an id; `legacyId` keeps the lab software's old id.

## Commands

```bash
npm test          # regenerates data, runs all checks + benchmark
npm run typecheck
npm run build     # dist/index.js (data inlined) + index.d.ts
```

## Licence

All rights reserved (see LICENSE).
