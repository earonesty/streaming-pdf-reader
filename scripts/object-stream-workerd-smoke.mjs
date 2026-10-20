import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the native runtime optional; ordinary offline tests do not need it.
const modulePath = process.env.MINIFLARE_MODULE;
if (!modulePath) throw new Error("Set MINIFLARE_MODULE to a local miniflare/dist/src/index.js");
const { Miniflare } = await import(pathToFileURL(resolve(modulePath)).href);
const filePath = process.argv[2];
const pages = (process.argv[3] ?? "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
if (!filePath || pages.some((n) => !Number.isSafeInteger(n) || n < 1))
  throw new Error("Usage: node scripts/object-stream-workerd-smoke.mjs <pdf> [1,2,...]");
const file = await open(filePath, "r");
let runtime;
let rangeRequests = 0;
try {
  const size = (await file.stat()).size;
  runtime = new Miniflare({
    modules: true,
    script: await readFile(
      new URL("../artifacts/object-stream-worker/object-stream-worker.js", import.meta.url),
      "utf8",
    ),
    compatibilityDate: "2026-04-01",
    serviceBindings: {
      RANGES: async (request) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset"));
        const length = Number(url.searchParams.get("length"));
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 1 ||
          length > 16 * 1024 * 1024 ||
          offset + length > size
        )
          return new Response("invalid range", { status: 400 });
        rangeRequests++;
        const bytes = new Uint8Array(length);
        let read = 0;
        while (read < length) {
          const result = await file.read(bytes, read, length - read, offset + read);
          if (!result.bytesRead) throw new Error("unexpected source EOF");
          read += result.bytesRead;
        }
        return new Response(bytes);
      },
    },
  });
  const response = await runtime.dispatchFetch("http://worker.test/", {
    method: "POST",
    body: JSON.stringify({ size, pages }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Worker failed HTTP ${response.status}: ${text}`);
  console.log(JSON.stringify({ ...JSON.parse(text), rangeRequests }));
} finally {
  try {
    await runtime?.dispose();
  } finally {
    await file.close();
  }
}
