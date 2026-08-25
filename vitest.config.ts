import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["packages/**"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 90,
        branches: 80,
      },
    },
  },
});
