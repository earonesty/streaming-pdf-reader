import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const PAGE_COUNT = 1_000;
const CACHE_BYTES = 64 * 1024;
const MAX_LIVE_HEAP_GROWTH = 48 * 1024 * 1024;
const root = resolve(import.meta.dirname, "../..");

describe("HTML writer memory bound", () => {
  it("streams 1,000 extracted pages without retaining the document output", async () => {
    const run = promisify(execFile);
    const worker = resolve(root, "scripts/html-writer-memory-worker.mjs");
    const { stdout } = await run(process.execPath, ["--expose-gc", worker]);
    const measurement = JSON.parse(stdout) as {
      outputBytes: number;
      largestChunk: number;
      pageSections: number;
      liveHeapGrowth: number;
      reader: {
        peakResidentBytes: number;
        peakObjectCacheBytes: number;
        xrefResidentBytes: number;
      };
    };

    expect(measurement.pageSections).toBe(PAGE_COUNT);
    expect(measurement.outputBytes).toBeGreaterThan(200_000);
    expect(measurement.largestChunk).toBeLessThan(2 * 1024);
    expect(measurement.reader.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(measurement.reader.peakObjectCacheBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(measurement.reader.xrefResidentBytes).toBeLessThanOrEqual(64 * 1024);
    expect(measurement.liveHeapGrowth).toBeLessThan(MAX_LIVE_HEAP_GROWTH);
  }, 30_000);
});
