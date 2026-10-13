import { defineConfig } from "tsup";

// One self-contained ESM bundle: the dataset is inlined (src/data.generated.ts), so it works in
// Node, browsers, workers and edge runtimes with no file access.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  target: "es2020",
  platform: "neutral",
  clean: true,
});
