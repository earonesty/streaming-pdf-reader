import type { FontDecoder } from "./encoding.js";

export interface UnicodeMap {
  mapping: Map<number, string>;
  codeBytes?: number | undefined;
  codeSpaceRanges: Array<{ width: number; start: number; end: number }>;
}

export function decodeUtf16Bytes(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }
  return output;
}

export function parseToUnicode(bytes: Uint8Array): UnicodeMap {
  const text = new TextDecoder("latin1").decode(bytes);
  const mapping = new Map<number, string>();
  const sourceWidths: number[] = [];
  const codeSpaceRanges: UnicodeMap["codeSpaceRanges"] = [];
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const match of (block[1] ?? "").matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const startHex = match[1];
      const endHex = match[2];
      if (startHex === undefined || endHex === undefined || startHex.length !== endHex.length) {
        continue;
      }
      codeSpaceRanges.push({
        width: Math.ceil(startHex.length / 2),
        start: Number.parseInt(startHex, 16),
        end: Number.parseInt(endHex, 16),
      });
    }
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of (block[1] ?? "").matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const source = match[1];
      const destination = match[2];
      if (source !== undefined && destination !== undefined) {
        sourceWidths.push(Math.ceil(source.length / 2));
        mapping.set(Number.parseInt(source, 16), decodeUtf16Hex(destination));
      }
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of (block[1] ?? "").matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi,
    )) {
      const startHex = match[1];
      const endHex = match[2];
      const destinationHex = match[3];
      if (startHex === undefined || endHex === undefined || destinationHex === undefined) continue;
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      sourceWidths.push(Math.ceil(startHex.length / 2));
      for (let code = start; code <= end; code += 1) {
        mapping.set(code, decodeUtf16Hex(incrementHex(destinationHex, code - start)));
      }
    }
    for (const match of (block[1] ?? "").matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[((?:\s*<[0-9a-f]+>\s*)+)\]/gi,
    )) {
      const startHex = match[1];
      const endHex = match[2];
      const destinations = [...(match[3] ?? "").matchAll(/<([0-9a-f]+)>/gi)];
      if (startHex === undefined || endHex === undefined) continue;
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      sourceWidths.push(Math.ceil(startHex.length / 2));
      for (let code = start; code <= end; code += 1) {
        const destination = destinations[code - start]?.[1];
        if (destination !== undefined) mapping.set(code, decodeUtf16Hex(destination));
      }
    }
  }
  const widths = new Set(sourceWidths);
  return {
    mapping,
    codeBytes: widths.size === 1 ? sourceWidths[0] : undefined,
    codeSpaceRanges,
  };
}

export function decodeWithMap(
  bytes: Uint8Array,
  unicodeMap: UnicodeMap,
  defaultCodeBytes: number,
  fallback: FontDecoder,
): string {
  let output = "";
  for (let index = 0; index < bytes.length; ) {
    const codeBytes =
      unicodeMap.codeBytes ??
      codeWidthAt(bytes, index, unicodeMap.codeSpaceRanges) ??
      defaultCodeBytes;
    let code = 0;
    for (let byte = 0; byte < codeBytes; byte += 1) code = code * 256 + (bytes[index + byte] ?? 0);
    output +=
      unicodeMap.mapping.get(code) ??
      (codeBytes === 1
        ? fallback.decode(bytes.subarray(index, index + 1))
        : String.fromCodePoint(code));
    index += codeBytes;
  }
  return output;
}

function codeWidthAt(
  bytes: Uint8Array,
  index: number,
  ranges: UnicodeMap["codeSpaceRanges"],
): number | undefined {
  for (const range of ranges) {
    if (index + range.width > bytes.length) continue;
    let code = 0;
    for (let offset = 0; offset < range.width; offset += 1) {
      code = code * 256 + (bytes[index + offset] ?? 0);
    }
    if (code >= range.start && code <= range.end) return range.width;
  }
  return undefined;
}

function incrementHex(hex: string, amount: number): string {
  return (BigInt(`0x${hex}`) + BigInt(amount)).toString(16).padStart(hex.length, "0");
}

function decodeUtf16Hex(hex: string): string {
  const units = hex.match(/.{4}/g)?.map((unit) => Number.parseInt(unit, 16)) ?? [];
  return normalizeTextCompatibility(String.fromCharCode(...units));
}

export function normalizeTextCompatibility(text: string): string {
  return text
    .replaceAll("ﬀ", "ff")
    .replaceAll("ﬁ", "fi")
    .replaceAll("ﬂ", "fl")
    .replaceAll("ﬃ", "ffi")
    .replaceAll("ﬄ", "ffl")
    .replaceAll("ﳋ", "لخ");
}
