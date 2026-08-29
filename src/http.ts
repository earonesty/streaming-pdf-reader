import type { PdfSource } from "./source.js";

export interface HttpPdfSourceOptions {
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
  onWarning?: (message: string) => void;
}

export async function httpSource(
  url: string | URL,
  options: HttpPdfSourceOptions = {},
): Promise<PdfSource> {
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const warn = options.onWarning ?? ((message: string) => console.warn(message));
  let warnedAboutFullResponse = false;
  const warnAboutFullResponse = () => {
    if (warnedAboutFullResponse) return;
    warnedAboutFullResponse = true;
    warn(
      "HTTP server returned 200 instead of a byte range; reads remain memory-bounded but may transfer extra data",
    );
  };
  const headers = new Headers(options.headers);
  headers.set("range", "bytes=0-0");
  const probe = await fetcher(url, { headers });
  const contentRange = probe.headers.get("content-range");
  const match = /^bytes\s+0-0\/(\d+)$/.exec(contentRange ?? "");
  if (probe.status === 200) {
    warnAboutFullResponse();
    const contentLength = parseContentLength(probe.headers.get("content-length"));
    const size = contentLength ?? (await countResponseBytes(probe));
    if (contentLength !== undefined) await probe.body?.cancel();
    return fullResponseSource(url, size, fetcher, options.headers);
  }
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
      if (response.status === 200) {
        if (etag) {
          await response.body?.cancel();
          throw new Error("HTTP source changed while reading byte ranges");
        }
        warnAboutFullResponse();
        return readResponseSlice(response, offset, length);
      }
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`range request returned HTTP ${response.status}; expected 200 or 206`);
      }
      const expectedEnd = offset + length - 1;
      const returnedRange = parseContentRange(response.headers.get("content-range"));
      if (
        !returnedRange ||
        returnedRange.start !== offset ||
        returnedRange.end !== expectedEnd ||
        returnedRange.size !== size
      ) {
        await response.body?.cancel();
        throw new Error(
          `range request returned an invalid Content-Range; expected bytes ${offset}-${expectedEnd}/${size}`,
        );
      }
      const responseEtag = response.headers.get("etag");
      if (etag && responseEtag && responseEtag !== etag) {
        await response.body?.cancel();
        throw new Error("HTTP source changed while reading byte ranges");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== length) {
        throw new Error(`range request returned ${bytes.byteLength} bytes; expected ${length}`);
      }
      return bytes;
    },
  };
}

function parseContentRange(
  value: string | null,
): { start: number; end: number; size: number } | undefined {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const size = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(size)
    ? { start, end, size }
    : undefined;
}

function fullResponseSource(
  url: string | URL,
  size: number,
  fetcher: typeof globalThis.fetch,
  configuredHeaders?: HeadersInit,
): PdfSource {
  return {
    size,
    async read(offset, length) {
      validateRange(size, offset, length);
      if (length === 0) return new Uint8Array();
      const response = await fetcher(url, { headers: new Headers(configuredHeaders) });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`full request returned HTTP ${response.status}; expected 200`);
      }
      return readResponseSlice(response, offset, length);
    },
  };
}

async function readResponseSlice(
  response: Response,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("HTTP response has no readable body");
  const output = new Uint8Array(length);
  const reader = response.body.getReader();
  const end = offset + length;
  let position = 0;
  let written = 0;
  try {
    while (position < end) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkEnd = position + value.byteLength;
      const copyStart = Math.max(position, offset);
      const copyEnd = Math.min(chunkEnd, end);
      if (copyEnd > copyStart) {
        const sourceStart = copyStart - position;
        output.set(value.subarray(sourceStart, sourceStart + copyEnd - copyStart), written);
        written += copyEnd - copyStart;
      }
      position = chunkEnd;
    }
  } finally {
    await reader.cancel();
  }
  if (written !== length) {
    throw new Error(`full HTTP response ended after ${position} bytes; needed ${end}`);
  }
  return output;
}

async function countResponseBytes(response: Response): Promise<number> {
  if (!response.body) throw new Error("HTTP response has no readable body");
  const reader = response.body.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return size;
    size += value.byteLength;
    if (!Number.isSafeInteger(size)) throw new Error("HTTP response is too large");
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!/^\d+$/.test(value ?? "")) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
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
