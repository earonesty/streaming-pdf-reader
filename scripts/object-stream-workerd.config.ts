import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["scripts/object-stream-worker.ts"],
  outDir: "artifacts/object-stream-worker",
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  noExternal: [/.*/],
  dts: false,
  splitting: false,
});
