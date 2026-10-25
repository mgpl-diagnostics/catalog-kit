// npm run ids — gives every catalog entry without an id the next MGPL id of its kind, then orders the
// catalog tests → profiles → packages (by id within each kind). Existing ids never change.
//   MGPLT0001… tests, MGPLP0001… profiles, MGPLK0001… packages
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ID_PREFIX = { test: "MGPLT", profile: "MGPLP", package: "MGPLK" };
const KINDS = Object.keys(ID_PREFIX);
const ID = /^MGPL([TPK])(\d{4})$/;

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json");
const data = JSON.parse(readFileSync(file, "utf8"));

const next = Object.fromEntries(KINDS.map((k) => [k, 0]));
for (const t of data.tests) {
  if (!KINDS.includes(t.kind)) throw new Error(`${t.name}: kind must be one of ${KINDS.join(", ")}`);
  if (t.id == null) continue;
  const m = ID.exec(t.id);
  if (!m || !t.id.startsWith(ID_PREFIX[t.kind])) throw new Error(`${t.name}: id ${t.id} does not match kind ${t.kind}`);
  next[t.kind] = Math.max(next[t.kind], Number(m[2]));
}
let added = 0;
data.tests = data.tests.map((t) => {
  if (t.id != null) return t;
  added++;
  const id = `${ID_PREFIX[t.kind]}${String(++next[t.kind]).padStart(4, "0")}`;
  const { id: _, kind, legacyId = null, ...rest } = t;
  return { id, kind, legacyId, ...rest };
});
data.tests.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
const counts = KINDS.map((k) => `${data.tests.filter((t) => t.kind === k).length} ${k}s`).join(", ");
console.log(`data/catalog.json  ${added} new ids; ${counts}`);
