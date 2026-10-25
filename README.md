<div align="center">

# catalog-kit

**Every MGPL Diagnostics test, in one typed package.**
Tests and profiles with their parameters, units, methods, reference ranges, sample types and prices,
plus fast fuzzy search. Zero dependencies. Works in Node, browsers, workers and edge runtimes.

![tests](https://img.shields.io/badge/tests-614-14264A) ![parameters](https://img.shields.io/badge/parameters-1911-14264A) ![search](https://img.shields.io/badge/search-~30%C2%B5s-C2410C) ![deps](https://img.shields.io/badge/dependencies-0-E9A23B)

</div>

## What's inside

| | |
| --- | --- |
| **614 entries** (584 tests, 30 profiles) across 9 departments | Clinical Biochemistry, Clinical Pathology, Cytopathology, Hematology, Histopathology, Immunology, Microbiology, Molecular, Serology |
| **1,911 parameters** | unit, method, male / female reference interval, options, narrative reference |
| **29 sample types** | SERUM, EDTA, URINE, SODIUM FLUORIDE, SODIUM CITRATE, STOOL, SEMEN, CSF… |
| **83 calculated parameters** | each with its formula, in readable form (`(28.7*HBA1C)-46.7`) |
| **Prices** | in rupees, for 612 tests |

Every entry has an **MGPL id**: `MGPLT0001`… for tests, `MGPLP0001`… for profiles and `MGPLK0001`…
for packages (none yet). Each kind has its own gap-free sequence, and the catalog lists tests first,
then profiles, then packages. The lab software's old numeric id is kept as `legacyId`.

Units and methods are normalised (`mg/dl` → `mg/dL`, `CALCULATED` → `Calculated`), and narrative
references are plain text, with no HTML.

## Install

```bash
npm install @mgpl-diagnostics/catalog-kit
```

Published on GitHub Packages. Add `@mgpl-diagnostics:registry=https://npm.pkg.github.com` to `.npmrc`.

## Use

```ts
import { search, getTestByCode, formatRange, flagResult, totalPrice } from "@mgpl-diagnostics/catalog-kit";

search("lft")[0].test.name;            // "LIVER FUNCTION TESTS"
search("vit d").map((h) => h.test.name); // ["VITAMIN D PROFILE (D2,D3,TOTAL D)", "Vitamin D3", …]
search("thyriod");                     // typo-tolerant → Thyroid tests

const cbc = getTestByCode("CBC")!;      // also short / search codes, case-insensitive
cbc.id;                                 // "MGPLT0196"
getTest("MGPLT0196") === cbc;           // by MGPL id (or by the old numeric id, cbc.legacyId)
cbc.sampleType;                         // "EDTA"
cbc.mrp;                                // price in rupees

const hb = cbc.parameters.find((p) => p.name === "Hemoglobin")!;
hb.unit;                                // "g/dL"
hb.method;                              // "SLS-Hemoglobin"
formatRange(hb, "female");              // "11 - 16"
flagResult(hb, 10.2, "female");         // "L"

totalPrice(["CBC", "HBA1C", "MGPLP0014"]); // { total, tests, unknown: [] }
```

## Search

`search(query, { limit, department, sampleType, fuzzy })` ranks tests by:

1. **Exact code or id**: `CBC`, `LIFT`, `HBA1C`, `T3T4TSH`, `MGPLP0014`.
2. **Exact words** in the name, then parameters, department and sample type.
3. **Prefixes**: `creatinin` → Creatinine.
4. **Typos**: `cholestrol`, `thyriod` (trigram similarity).
5. **Lab shorthand**: `lft`, `kft`, `rft`, `sgpt`, `fbs`, `ppbs`, `vit d`, `b12`, `hemogram`… (see `SYNONYMS`).

British and American spellings fold together (`haemoglobin` = `hemoglobin`), and joined forms match
split names (`b12` finds "VITAMIN B-12").

The index builds in about 20–30 ms on first use. Each query then takes about 30 µs. `npm test`
measures both.

## API

| Export | |
| --- | --- |
| `TESTS`, `CATALOG` | the data |
| `DEPARTMENTS`, `SAMPLE_TYPES` | sorted lists |
| `getTest(id)`, `getTestByCode(code)` | lookups (MGPL id, or the old numeric `legacyId`) |
| `testsByKind(k)`, `testsByDepartment(d)`, `testsBySampleType(s)` | filters |
| `isProfile(test)`, `isPackage(test)` | `kind` is `profile` (LFT, Kidney Profile, TORCH…) or `package` |
| `ID_PREFIX`, `ID_PATTERN` | `MGPLT` / `MGPLP` / `MGPLK`, and `/^MGPL[TPK]\d{4}$/` |
| `search(q, opts)`, `createSearchIndex(tests)` | search, or build your own index over a subset |
| `rangeFor(param, sex)`, `formatRange(param, sex)`, `flagResult(param, value, sex)` | reference intervals |
| `totalPrice(idsOrCodes)` | sum prices, reporting unknown entries |
| `normalize(text)`, `SYNONYMS` | the search's text folding and shorthand table |

Types: `LabTest`, `CatalogId`, `CatalogKind` (`test` · `profile` · `package`), `Parameter`, `ParameterType` (`numeric` · `text` · `options` · `image` · `title`),
`Interval`, `Bound`, `Department`, `Sex`.

## Data

`data/catalog.json` is the source of truth. `npm run data` turns it into `src/data.generated.ts`,
which holds the JSON as a string parsed at load time. That is faster than a large object literal,
and cheap for TypeScript to check. Builds and tests regenerate it automatically.

To add an entry, give it a `kind` and `"id": null` in the JSON and run `npm run ids`: it assigns the
next id of that kind and re-orders the catalog (tests, profiles, packages). Ids are never renumbered
or reused, so references stay valid; `npm test` checks the sequences.

> **Medical note.** Reference ranges come from the lab's configured test master. They must be
> checked by a qualified pathologist before clinical use.

## The family

| Repo | Role |
| --- | --- |
| [report-kit](https://github.com/mgpl-diagnostics/report-kit) | A4 report PDF + HTML |
| [invoice-kit](https://github.com/mgpl-diagnostics/invoice-kit) | patient invoices |
| **catalog-kit** | tests, ranges, prices, search |
| [client](https://github.com/mgpl-diagnostics/client) | headless browser SDK |
| [report-studio](https://github.com/mgpl-diagnostics/report-studio) | reference Next.js app |

## Licence

All rights reserved. See [LICENSE](LICENSE).
