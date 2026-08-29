import { memorySource, openPdf } from "../dist/index.js";
import { writeHtmlDocument } from "../packages/html-writer/dist/index.js";

const PAGE_COUNT = 1_000;
const CACHE_BYTES = 64 * 1024;
const SAMPLE_EVERY_PAGES = 50;

if (typeof globalThis.gc !== "function") {
  throw new Error("html-writer-memory-worker requires node --expose-gc");
}

const bytes = buildManyPagePdf(PAGE_COUNT, "Streaming page");
const reader = await openPdf(memorySource(bytes), {
  chunkSize: 4 * 1024,
  maxBytes: CACHE_BYTES,
  maxObjectCacheBytes: CACHE_BYTES,
  maxCachedObjects: 32,
  maxXrefCacheBytes: 64 * 1024,
});
let outputBytes = 0;
let largestChunk = 0;
let pageSections = 0;

globalThis.gc();
const startingHeap = process.memoryUsage().heapUsed;
let peakLiveHeap = startingHeap;

try {
  await writeHtmlDocument(reader.pages(), async (chunk) => {
    const chunkBytes = Buffer.byteLength(chunk);
    outputBytes += chunkBytes;
    largestChunk = Math.max(largestChunk, chunkBytes);
    if (chunk.startsWith('<section class="pdf-page ')) pageSections += 1;
    if (pageSections > 0 && pageSections % SAMPLE_EVERY_PAGES === 0) {
      globalThis.gc();
      peakLiveHeap = Math.max(peakLiveHeap, process.memoryUsage().heapUsed);
    }
    await Promise.resolve();
  });
  globalThis.gc();
  peakLiveHeap = Math.max(peakLiveHeap, process.memoryUsage().heapUsed);
  process.stdout.write(
    JSON.stringify({
      outputBytes,
      largestChunk,
      pageSections,
      liveHeapGrowth: Math.max(0, peakLiveHeap - startingHeap),
      reader: reader.stats,
    }),
  );
} finally {
  reader.close();
}

function buildManyPagePdf(pageCount, pageText) {
  const groupSize = 100;
  const groupCount = Math.ceil(pageCount / groupSize);
  const firstGroup = 3;
  const firstPage = firstGroup + groupCount;
  const contentObject = firstPage + pageCount;
  const objects = new Map();
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
  const content = `BT /F1 12 Tf 20 40 Td (${pageText}) Tj ET`;
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
