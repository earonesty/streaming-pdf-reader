import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@boxpdf/reader/structure": fileURLToPath(
        new URL("./src/structure/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["packages/**"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 90,
        branches: 77.5,
      },
    },
  },
});
