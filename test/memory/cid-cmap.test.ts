import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const worker = resolve(import.meta.dirname, "../../scripts/cid-cmap-memory-worker.mjs");

describe("CID CMap resource bound", () => {
  it.each(["cidchar", "cidrange"])(
    "extracts text from a 32 MiB repeated %s CMap within a fixed memory and time budget",
    async (kind) => {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [
        "--expose-gc",
        worker,
        kind,
      ]);
      if (!stdout)
        throw new Error(`worker ${process.execPath} ${worker} returned no output: ${stderr}`);
      const measurement = JSON.parse(stdout) as {
        decodedBytes: number;
        text: string;
        elapsedMs: number;
        peakRssGrowth: number;
      };
      expect(measurement.decodedBytes).toBe(32 * 1024 * 1024);
      expect(measurement.text).toBe("A");
      // Includes stream decoding, decoded strings, and the reader's other font parsers.
      // Allow Node 20 GC headroom while catching duplicate-record memory amplification.
      expect(measurement.peakRssGrowth).toBeLessThan(256 * 1024 * 1024);
      expect(measurement.elapsedMs).toBeLessThan(5000);
    },
    15_000,
  );

  it("avoids large per-font allocations when repeatedly reading a tiny composite-font CMap", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--expose-gc",
      worker,
      "small",
    ]);
    const measurement = JSON.parse(stdout) as {
      pageReads: number;
      text: string;
      peakArrayBufferGrowth: number;
    };
    expect(measurement.pageReads).toBe(2_000);
    expect(measurement.text).toBe("A");
    expect(measurement.peakArrayBufferGrowth).toBeLessThan(4 * 1024 * 1024);
  }, 15_000);
});
