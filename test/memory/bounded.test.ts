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

  it("jumps to page 10,000 with compact xref and bounded caches", async () => {
    const bytes = buildManyPagePdf(10_000);
    const source = measuredMemorySource(bytes);
    const reader = await openPdf(source, {
      chunkSize: CHUNK_BYTES,
      maxBytes: CACHE_BYTES,
      maxObjectCacheBytes: CACHE_BYTES,
      maxCachedObjects: 32,
      maxXrefBytes: 512 * 1024,
    });
    const page = await reader.getPage(9_999);
    expect(page.number).toBe(10_000);
    expect(page.spans.map((span) => span.text).join("")).toBe("Last page");
    expect(reader.stats.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(reader.stats.peakObjectCacheBytes).toBeLessThanOrEqual(CACHE_BYTES);
    expect(reader.stats.xrefEntries).toBe(10_103);
    expect(reader.stats.xrefResidentBytes).toBeLessThan(160 * 1024);
    expect(source.largestRead).toBeLessThanOrEqual(CHUNK_BYTES);
    reader.close();
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

function measuredMemorySource(bytes: Uint8Array): MeasuredSource {
  return {
    size: bytes.byteLength,
    largestRead: 0,
    async read(offset, length) {
      this.largestRead = Math.max(this.largestRead, length);
      return bytes.slice(offset, offset + length);
    },
  };
}

function buildManyPagePdf(pageCount: number): Uint8Array {
  const groupSize = 100;
  const groupCount = Math.ceil(pageCount / groupSize);
  const firstGroup = 3;
  const firstPage = firstGroup + groupCount;
  const contentObject = firstPage + pageCount;
  const objects = new Map<number, string>();
  const groupRefs = Array.from({ length: groupCount }, (_, index) => `${firstGroup + index} 0 R`);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${groupRefs.join(" ")}] /MediaBox [0 0 200 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`,
  );
  for (let group = 0; group < groupCount; group += 1) {
    const start = group * groupSize;
    const count = Math.min(groupSize, pageCount - start);
    const refs = Array.from({ length: count }, (_, index) => `${firstPage + start + index} 0 R`);
    objects.set(
      firstGroup + group,
      `<< /Type /Pages /Parent 2 0 R /Count ${count} /Kids [${refs.join(" ")}] >>`,
    );
  }
  for (let page = 0; page < pageCount; page += 1) {
    const parent = firstGroup + Math.floor(page / groupSize);
    objects.set(
      firstPage + page,
      `<< /Type /Page /Parent ${parent} 0 R /Contents ${contentObject} 0 R >>`,
    );
  }
  const content = "BT /F1 12 Tf 20 40 Td (Last page) Tj ET";
  objects.set(contentObject, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (let object = 1; object <= contentObject; object += 1) {
    offsets[object] = pdf.length;
    pdf += `${object} 0 obj\n${objects.get(object)}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${contentObject + 1}\n0000000000 65535 f \n`;
  for (let object = 1; object <= contentObject; object += 1) {
    pdf += `${String(offsets[object]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${contentObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
