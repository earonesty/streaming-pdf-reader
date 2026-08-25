import { describe, expect, it } from "vitest";
import { writeHtmlDocument } from "../../packages/html-writer/dist/index.js";
import { memorySource, openPdf } from "../../src/index.js";
import { buildManyPagePdf } from "../support/many-page-pdf.js";

const PAGE_COUNT = 1_000;
const CACHE_BYTES = 64 * 1024;

describe("HTML writer memory bound", () => {
  it("streams 1,000 extracted pages without retaining the document output", async () => {
    const reader = await openPdf(memorySource(buildManyPagePdf(PAGE_COUNT, "Streaming page")), {
      chunkSize: 4 * 1024,
      maxBytes: CACHE_BYTES,
      maxObjectCacheBytes: CACHE_BYTES,
      maxCachedObjects: 32,
      maxXrefCacheBytes: 64 * 1024,
    });
    let outputBytes = 0;
    let largestChunk = 0;
    let pageSections = 0;
    const startingHeap = process.memoryUsage().heapUsed;
    let peakHeap = startingHeap;

    try {
      await writeHtmlDocument(reader.pages(), async (chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        largestChunk = Math.max(largestChunk, Buffer.byteLength(chunk));
        if (chunk.startsWith('<section class="pdf-page ')) pageSections += 1;
        peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
        await Promise.resolve();
      });

      expect(pageSections).toBe(PAGE_COUNT);
      expect(outputBytes).toBeGreaterThan(200_000);
      expect(largestChunk).toBeLessThan(2 * 1024);
      expect(reader.stats.peakResidentBytes).toBeLessThanOrEqual(CACHE_BYTES);
      expect(reader.stats.peakObjectCacheBytes).toBeLessThanOrEqual(CACHE_BYTES);
      expect(reader.stats.xrefResidentBytes).toBeLessThanOrEqual(64 * 1024);
      expect(peakHeap - startingHeap).toBeLessThan(64 * 1024 * 1024);
    } finally {
      reader.close();
    }
  }, 20_000);
});
