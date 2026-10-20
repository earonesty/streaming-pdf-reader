import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("extracts beyond 32 MiB without retaining the decoded object stream", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--max-old-space-size=64",
    new URL("../../scripts/object-stream-memory-worker.mjs", import.meta.url).pathname,
    new URL("../fixtures/large-object-stream.pdf", import.meta.url).pathname,
  ]);
  const result = JSON.parse(stdout);
  expect(result.count).toBe(1);
  expect(result.pages[0].spans).toBeGreaterThan(0);
  // Node runtime RSS is not an isolate limit; gate incremental process growth.
  expect(result.peakRssKiB - result.baselineRssKiB).toBeLessThan(64 * 1024);
  expect(result.reader.peakObjectStreamBufferBytes).toBeLessThan(128 * 1024);
  expect(result.reader.objectStreamDecodedBytes).toBeGreaterThan(80 * 1024 * 1024);
}, 30000);
