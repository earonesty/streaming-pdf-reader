import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Include the browser-safe encoder patch in published builds, not just this workspace.
  noExternal: ["jpeg-js"],
});
