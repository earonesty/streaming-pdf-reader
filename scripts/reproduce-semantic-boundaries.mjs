import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
    "run",
    "test/semantic-boundaries",
  ],
  { stdio: "inherit", env: { ...process.env, BOXPDF_REPRODUCE_FLOW_DEFECTS: "1" } },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
