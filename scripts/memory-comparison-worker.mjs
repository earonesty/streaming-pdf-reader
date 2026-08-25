import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const engine = process.argv[2];
const virtualSize = Number(process.argv[3]);
if (!["reader", "pdfjs", "unpdf"].includes(engine)) throw new Error(`unknown engine: ${engine}`);
if (!Number.isSafeInteger(virtualSize) || virtualSize < 1024 * 1024) {
  throw new Error("memory comparison requires a PDF size of at least 1 MiB");
}

const original = new Uint8Array(
  await readFile(resolve(import.meta.dirname, "../fixtures/qpdf/minimal.pdf")),
);
const startXref = /startxref\s+(\d+)/.exec(new TextDecoder("latin1").decode(original))?.[1];
if (!startXref) throw new Error("fixture has no startxref");
const suffix = new TextEncoder().encode(`\nstartxref\n${startXref}\n%%EOF\n`);
let largestRead = 0;
let sourceBytesRead = 0;
let peak = process.memoryUsage();

function sample() {
  const usage = process.memoryUsage();
  peak = {
    rss: Math.max(peak.rss, usage.rss),
    heapTotal: Math.max(peak.heapTotal, usage.heapTotal),
    heapUsed: Math.max(peak.heapUsed, usage.heapUsed),
    external: Math.max(peak.external, usage.external),
    arrayBuffers: Math.max(peak.arrayBuffers, usage.arrayBuffers),
  };
}

const sampler = setInterval(sample, 2);
let text;
let readerStats;
try {
  if (engine === "reader") {
    const { openPdf } = await import("../dist/index.js");
    const source = {
      size: virtualSize,
      async read(offset, length) {
        largestRead = Math.max(largestRead, length);
        sourceBytesRead += length;
        const output = new Uint8Array(length);
        output.fill(0x0a);
        copyIntersection(original, 0, output, offset);
        copyIntersection(suffix, virtualSize - suffix.byteLength, output, offset);
        return output;
      },
    };
    const reader = await openPdf(source, {
      chunkSize: 4 * 1024,
      maxBytes: 64 * 1024,
      maxXrefBytes: 64 * 1024,
    });
    const page = await reader.getPage(0);
    text = page.spans.map((span) => span.text).join("");
    readerStats = reader.stats;
    sample();
    reader.close();
  } else {
    const bytes = materializePdf();
    sample();
    if (engine === "pdfjs") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document = await getDocument({ data: bytes }).promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      text = content.items
        .filter((item) => "str" in item)
        .map((item) => item.str)
        .join("");
      sample();
      await document.destroy();
    } else {
      const { extractText } = await import("unpdf");
      const result = await extractText(bytes, { mergePages: true });
      text = result.text;
      sample();
    }
  }
} finally {
  clearInterval(sampler);
}

if (text !== "Potato") throw new Error(`${engine} extracted unexpected text: ${text}`);
sample();
process.stdout.write(
  `${JSON.stringify({
    engine,
    virtualSize,
    peakRss: peak.rss,
    peakHeapUsed: peak.heapUsed,
    peakArrayBuffers: peak.arrayBuffers,
    largestRead: largestRead || null,
    sourceBytesRead: sourceBytesRead || null,
    reader: readerStats,
  })}\n`,
);

function materializePdf() {
  const bytes = new Uint8Array(virtualSize);
  bytes.fill(0x0a);
  bytes.set(original);
  bytes.set(suffix, virtualSize - suffix.byteLength);
  return bytes;
}

function copyIntersection(source, sourceOffset, target, targetOffset) {
  const start = Math.max(sourceOffset, targetOffset);
  const end = Math.min(sourceOffset + source.byteLength, targetOffset + target.byteLength);
  if (end <= start) return;
  target.set(source.subarray(start - sourceOffset, end - sourceOffset), start - targetOffset);
}
