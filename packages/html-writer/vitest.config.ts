import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@boxpdf/reader/structure": fileURLToPath(
        new URL("../../src/structure/index.ts", import.meta.url),
      ),
      "@boxpdf/reader/node": fileURLToPath(new URL("../../src/node.ts", import.meta.url)),
      "@boxpdf/reader": fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text"],
      thresholds: { lines: 90, branches: 80 },
    },
  },
});
