import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { openPdf, type PdfSource } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const CACHE_BYTES = 64 * 1024;
const CHUNK_BYTES = 4 * 1024;

describe("memory-bound gate", () => {
  it.each([10 * 1024 * 1024, 1024 * 1024 * 1024])(
    "extracts from a virtual %i-byte PDF within a fixed byte budget",
    async (virtualSize) => {
      const original = new Uint8Array(await readFile(resolve(root, "fixtures/qpdf/minimal.pdf")));
      const source = virtualPdfSource(original, virtualSize);
      const reader = await openPdf(source, {
        chunkSize: CHUNK_BYTES,
        maxBytes: CACHE_BYTES,
        maxXrefBytes: CACHE_BYTES,
      });

      const page = await reader.getPage(0);
      expect(page.spans.map((span) => span.text).join("")).toBe("Potato");
      expect(reader.stats.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
      expect(reader.stats.peakObjectCacheBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(reader.stats.largestSourceRead).toBeLessThanOrEqual(CHUNK_BYTES);
      expect(reader.stats.sourceBytesRead).toBeLessThan(256 * 1024);
      expect(source.largestRead).toBeLessThanOrEqual(CHUNK_BYTES);
      reader.close();
    },
  );

  it("keeps process memory independent of virtual source size", async () => {
    const run = promisify(execFile);
    const worker = resolve(root, "scripts/memory-worker.mjs");
    const measurements = await Promise.all(
      [10 * 1024 * 1024, 1024 * 1024 * 1024].map(async (size) => {
        const { stdout } = await run(process.execPath, ["--expose-gc", worker, String(size)]);
        return JSON.parse(stdout) as {
          rss: number;
          arrayBuffers: number;
          largestRead: number;
          reader: { peakResidentBytes: number; peakObjectCacheBytes: number };
        };
      }),
    );
    const [small, large] = measurements;
    if (!small || !large) throw new Error("memory workers returned no measurements");
    expect(small.reader.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(large.reader.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(large.reader.peakObjectCacheBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(large.largestRead).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(large.rss).toBeLessThan(96 * 1024 * 1024);
    expect(Math.abs(large.rss - small.rss)).toBeLessThan(16 * 1024 * 1024);
    expect(Math.abs(large.arrayBuffers - small.arrayBuffers)).toBeLessThan(1024 * 1024);
  });
});

interface MeasuredSource extends PdfSource {
  largestRead: number;
}

function virtualPdfSource(original: Uint8Array, size: number): MeasuredSource {
  const text = new TextDecoder("latin1").decode(original);
  const startXref = /startxref\s+(\d+)/.exec(text)?.[1];
  if (!startXref) throw new Error("fixture has no startxref");
  const suffix = new TextEncoder().encode(`\nstartxref\n${startXref}\n%%EOF\n`);
  if (size < original.byteLength + suffix.byteLength)
    throw new RangeError("virtual size is too small");

  return {
    size,
    largestRead: 0,
    async read(offset, length) {
      this.largestRead = Math.max(this.largestRead, length);
      const output = new Uint8Array(length);
      output.fill(0x0a);
      copyIntersection(original, 0, output, offset);
      copyIntersection(suffix, size - suffix.byteLength, output, offset);
      return output;
    },
  };
}

function copyIntersection(
  source: Uint8Array,
  sourceOffset: number,
  target: Uint8Array,
  targetOffset: number,
): void {
  const start = Math.max(sourceOffset, targetOffset);
  const end = Math.min(sourceOffset + source.byteLength, targetOffset + target.byteLength);
  if (end <= start) return;
  target.set(source.subarray(start - sourceOffset, end - sourceOffset), start - targetOffset);
}
