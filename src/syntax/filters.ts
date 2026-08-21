import { Inflate } from "pako";
import { PdfError } from "../errors.js";
import type { PdfDict } from "./values.js";

const latin1 = new TextDecoder("latin1");

export async function decodeFlate(
  bytes: Uint8Array,
  parameters: PdfDict | undefined,
  limit: number,
): Promise<Uint8Array> {
  const inflated = await inflate(bytes, limit);
  return applyPredictor(inflated, parameters, limit);
}

export function decodeLzw(
  bytes: Uint8Array,
  parameters: PdfDict | undefined,
  limit: number,
): Uint8Array {
  const earlyChange = integerParameter(parameters, "EarlyChange", 1);
  if (earlyChange !== 0 && earlyChange !== 1) throw new Error("/EarlyChange must be 0 or 1");
  const dictionary: Uint8Array[] = Array.from({ length: 256 }, (_, value) => Uint8Array.of(value));
  let nextCode = 258;
  let width = 9;
  let bitOffset = 0;
  let previous: Uint8Array | undefined;
  const output: number[] = [];

  while (bitOffset + width <= bytes.length * 8) {
    const code = readBits(bytes, bitOffset, width);
    bitOffset += width;
    if (code === 256) {
      dictionary.length = 256;
      nextCode = 258;
      width = 9;
      previous = undefined;
      continue;
    }
    if (code === 257) break;
    const entry =
      dictionary[code] ??
      (code === nextCode && previous ? appendByte(previous, previous[0] ?? 0) : undefined);
    if (!entry) throw new Error(`invalid LZW code ${code}`);
    if (output.length + entry.length > limit) {
      throw new PdfError(
        "RESOURCE_LIMIT",
        `decoded stream exceeds configured limit of ${limit} bytes`,
      );
    }
    output.push(...entry);
    if (previous && nextCode < 4096) {
      dictionary[nextCode] = appendByte(previous, entry[0] ?? 0);
      nextCode += 1;
      if (width < 12 && nextCode + earlyChange === 1 << width) width += 1;
    }
    previous = entry;
  }
  return applyPredictor(Uint8Array.from(output), parameters, limit);
}

function applyPredictor(
  bytes: Uint8Array,
  parameters: PdfDict | undefined,
  limit: number,
): Uint8Array {
  const predictor = integerParameter(parameters, "Predictor", 1);
  if (predictor === 1) return bytes;

  const colors = positiveParameter(parameters, "Colors", 1);
  const bits = positiveParameter(parameters, "BitsPerComponent", 8);
  const columns = positiveParameter(parameters, "Columns", 1);
  const rowBytes = Math.ceil((colors * columns * bits) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bits) / 8));
  if (predictor === 2) return decodeTiff(bytes, rowBytes, bytesPerPixel);
  if (predictor >= 10 && predictor <= 15) {
    return decodePng(bytes, rowBytes, bytesPerPixel, limit);
  }
  throw new Error(`unsupported stream predictor ${predictor}`);
}

export function decodeAsciiHex(bytes: Uint8Array, limit: number): Uint8Array {
  let hex = latin1.decode(bytes).replace(/\s/g, "");
  const end = hex.indexOf(">");
  if (end >= 0) hex = hex.slice(0, end);
  if (hex.length % 2 === 1) hex += "0";
  if (hex.length / 2 > limit)
    throw new PdfError(
      "RESOURCE_LIMIT",
      `decoded stream exceeds configured limit of ${limit} bytes`,
    );
  return Uint8Array.from(hex.match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const attempts: Array<{ bytes: Uint8Array; raw: boolean }> = [
    { bytes, raw: false },
    { bytes, raw: true },
  ];
  if (bytes.length > 6 && looksLikeZlib(bytes)) {
    attempts.push({ bytes: bytes.subarray(2, bytes.length - 4), raw: true });
  }
  let failure: Error | undefined;
  for (const attempt of attempts) {
    try {
      return inflateOnce(attempt.bytes, limit, attempt.raw);
    } catch (error) {
      if (error instanceof PdfError) throw error;
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`FlateDecode failed: ${failure?.message ?? "invalid compressed data"}`);
}

function inflateOnce(bytes: Uint8Array, limit: number, raw: boolean): Uint8Array {
  const inflater = new Inflate({ chunkSize: Math.min(64 * 1024, limit + 1), raw });
  const chunks: Uint8Array[] = [];
  let size = 0;
  inflater.onData = (chunk) => {
    const decoded = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += decoded.byteLength;
    if (size > limit)
      throw new PdfError(
        "RESOURCE_LIMIT",
        `decoded stream exceeds configured limit of ${limit} bytes`,
      );
    chunks.push(decoded);
  };
  inflater.push(bytes, true);
  if (inflater.err) throw new Error(inflater.msg || "invalid compressed data");
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function looksLikeZlib(bytes: Uint8Array): boolean {
  const header = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  return (bytes[0] ?? 0) % 16 === 8 && header % 31 === 0;
}

function readBits(bytes: Uint8Array, bitOffset: number, width: number): number {
  let value = 0;
  for (let bit = 0; bit < width; bit += 1) {
    const offset = bitOffset + bit;
    value = (value << 1) | (((bytes[offset >> 3] ?? 0) >> (7 - (offset & 7))) & 1);
  }
  return value;
}

function appendByte(bytes: Uint8Array, byte: number): Uint8Array {
  const output = new Uint8Array(bytes.length + 1);
  output.set(bytes);
  output[bytes.length] = byte;
  return output;
}

function decodeTiff(bytes: Uint8Array, rowBytes: number, bytesPerPixel: number): Uint8Array {
  if (bytes.length % rowBytes !== 0) throw new Error("TIFF predictor data has a partial row");
  const output = bytes.slice();
  for (let row = 0; row < output.length; row += rowBytes) {
    for (let column = bytesPerPixel; column < rowBytes; column += 1) {
      output[row + column] =
        (output[row + column] ?? 0) + (output[row + column - bytesPerPixel] ?? 0);
    }
  }
  return output;
}

function decodePng(
  bytes: Uint8Array,
  rowBytes: number,
  bytesPerPixel: number,
  limit: number,
): Uint8Array {
  const encodedRowBytes = rowBytes + 1;
  if (bytes.length % encodedRowBytes !== 0) throw new Error("PNG predictor data has a partial row");
  const rows = bytes.length / encodedRowBytes;
  const outputSize = rows * rowBytes;
  if (outputSize > limit)
    throw new Error(`decoded stream exceeds configured limit of ${limit} bytes`);
  const output = new Uint8Array(outputSize);
  for (let row = 0; row < rows; row += 1) {
    const filter = bytes[row * encodedRowBytes];
    if (filter === undefined || filter > 4)
      throw new Error(`unsupported PNG predictor filter ${filter}`);
    const inputOffset = row * encodedRowBytes + 1;
    const outputOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = bytes[inputOffset + column] ?? 0;
      const left =
        column >= bytesPerPixel ? (output[outputOffset + column - bytesPerPixel] ?? 0) : 0;
      const up = row > 0 ? (output[outputOffset + column - rowBytes] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? (output[outputOffset + column - rowBytes - bytesPerPixel] ?? 0)
          : 0;
      output[outputOffset + column] = applyPngFilter(filter, raw, left, up, upperLeft);
    }
  }
  return output;
}

function applyPngFilter(
  filter: number,
  raw: number,
  left: number,
  up: number,
  upperLeft: number,
): number {
  if (filter === 0) return raw;
  if (filter === 1) return raw + left;
  if (filter === 2) return raw + up;
  if (filter === 3) return raw + Math.floor((left + up) / 2);
  return raw + paeth(left, up, upperLeft);
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function integerParameter(parameters: PdfDict | undefined, name: string, fallback: number): number {
  const value = parameters?.get(name) ?? fallback;
  if (!Number.isSafeInteger(value)) throw new Error(`/${name} must be an integer`);
  return value as number;
}

function positiveParameter(
  parameters: PdfDict | undefined,
  name: string,
  fallback: number,
): number {
  const value = integerParameter(parameters, name, fallback);
  if (value <= 0) throw new Error(`/${name} must be positive`);
  return value;
}
