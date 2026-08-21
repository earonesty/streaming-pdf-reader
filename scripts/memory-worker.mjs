import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPdf } from "../dist/index.js";

const virtualSize = Number(process.argv[2]);
if (!Number.isSafeInteger(virtualSize) || virtualSize < 1024 * 1024) {
  throw new Error("memory worker requires a virtual PDF size in bytes");
}

const original = new Uint8Array(
  await readFile(resolve(import.meta.dirname, "../fixtures/qpdf/minimal.pdf")),
);
const startXref = /startxref\s+(\d+)/.exec(new TextDecoder("latin1").decode(original))?.[1];
if (!startXref) throw new Error("fixture has no startxref");
const suffix = new TextEncoder().encode(`\nstartxref\n${startXref}\n%%EOF\n`);
let largestRead = 0;
const source = {
  size: virtualSize,
  async read(offset, length) {
    largestRead = Math.max(largestRead, length);
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
if (page.spans.map((span) => span.text).join("") !== "Potato") {
  throw new Error("memory worker extracted unexpected text");
}
globalThis.gc?.();
const usage = process.memoryUsage();
process.stdout.write(
  `${JSON.stringify({
    virtualSize,
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    arrayBuffers: usage.arrayBuffers,
    largestRead,
    reader: reader.stats,
  })}\n`,
);
reader.close();

function copyIntersection(sourceBytes, sourceOffset, target, targetOffset) {
  const start = Math.max(sourceOffset, targetOffset);
  const end = Math.min(sourceOffset + sourceBytes.byteLength, targetOffset + target.byteLength);
  if (end <= start) return;
  target.set(sourceBytes.subarray(start - sourceOffset, end - sourceOffset), start - targetOffset);
}
