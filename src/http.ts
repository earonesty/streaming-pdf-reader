import type { PdfSource } from "./source.js";

export interface HttpPdfSourceOptions {
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}

export async function httpSource(
  url: string | URL,
  options: HttpPdfSourceOptions = {},
): Promise<PdfSource> {
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const headers = new Headers(options.headers);
  headers.set("range", "bytes=0-0");
  const probe = await fetcher(url, { headers });
  const contentRange = probe.headers.get("content-range");
  const match = /^bytes\s+0-0\/(\d+)$/.exec(contentRange ?? "");
  if (probe.status !== 206 || !match?.[1]) {
    await probe.body?.cancel();
    throw new Error("HTTP source must support byte ranges and return a valid Content-Range");
  }
  const size = Number(match[1]);
  const etag = probe.headers.get("etag");
  await probe.arrayBuffer();

  return {
    size,
    async read(offset, length) {
      validateRange(size, offset, length);
      if (length === 0) return new Uint8Array();
      const requestHeaders = new Headers(options.headers);
      requestHeaders.set("range", `bytes=${offset}-${offset + length - 1}`);
      if (etag) requestHeaders.set("if-range", etag);
      const response = await fetcher(url, { headers: requestHeaders });
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`range request returned HTTP ${response.status}; expected 206`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== length) {
        throw new Error(`range request returned ${bytes.byteLength} bytes; expected ${length}`);
      }
      return bytes;
    },
  };
}

function validateRange(size: number, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset > size ||
    length > size - offset
  ) {
    throw new RangeError(
      `invalid HTTP byte range [${offset}, ${offset + length}) for size ${size}`,
    );
  }
}
