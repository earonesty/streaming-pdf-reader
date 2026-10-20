import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { openPdf } from "../dist/index.js";

const path = process.argv[2];
const requestedPages = (process.argv[3] ?? "1").split(",").map(Number);
if (!path || requestedPages.some((n) => !Number.isSafeInteger(n) || n < 1))
  throw new Error("Usage: node scripts/object-stream-memory-worker.mjs <pdf> [1,2,...]");
const file = await open(path, "r");
let pdf;
try {
  const size = (await file.stat()).size;
  const baselineRssKiB = process.resourceUsage().maxRSS;
  const started = performance.now();
  pdf = await openPdf(
    {
      size,
      async read(offset, length) {
        const bytes = new Uint8Array(length);
        let read = 0;
        while (read < length) {
          const result = await file.read(bytes, read, length - read, offset + read);
          if (!result.bytesRead) throw new Error("unexpected source EOF");
          read += result.bytesRead;
        }
        return bytes;
      },
    },
    {
      maxBytes: 8 * 1024 * 1024,
      maxObjectCacheBytes: 8 * 1024 * 1024,
      maxXrefCacheBytes: 8 * 1024 * 1024,
    },
  );
  const count = await pdf.getPageCount();
  const pages = [];
  for (const number of requestedPages) {
    const page = await pdf.getPage(number - 1);
    const text = page.spans.map((s) => s.text).join("\n");
    pages.push({
      number,
      spans: page.spans.length,
      textSha256: createHash("sha256").update(text).digest("hex"),
    });
    pdf.releasePage();
  }
  console.log(
    JSON.stringify({
      size,
      count,
      pages,
      wallMs: performance.now() - started,
      baselineRssKiB,
      peakRssKiB: process.resourceUsage().maxRSS,
      memory: process.memoryUsage(),
      reader: pdf.stats,
    }),
  );
} finally {
  pdf?.close();
  await file.close();
}
