export interface Type1Metrics {
  widthOfGlyph(glyph: string): number | undefined;
}

const encoder = new TextEncoder();
const eexecMarker = encoder.encode("currentfile eexec");

export function parseType1Metrics(bytes: Uint8Array): Type1Metrics | undefined {
  const program = unwrapType1Program(bytes);
  const marker = findBytes(program, eexecMarker);
  if (marker < 0) return undefined;
  const clear = new TextDecoder("latin1").decode(program.subarray(0, marker));
  const encrypted = eexecBytes(program, marker + eexecMarker.length);
  if (!encrypted) return undefined;
  const privateProgram = decrypt(encrypted, 55_665, 4);
  const privateText = new TextDecoder("latin1").decode(privateProgram);
  const lenIV = Number(/\/lenIV\s+(-?\d+)/.exec(privateText)?.[1] ?? 4);
  if (!Number.isInteger(lenIV) || lenIV < -1 || lenIV > 32) return undefined;
  const matrix = /\/FontMatrix\s*\[\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(clear);
  const scale = Math.abs(Number(matrix?.[1] ?? 0.001));
  if (!Number.isFinite(scale) || scale === 0 || scale > 1) return undefined;
  const subroutines = readBinaryEntries(
    privateProgram,
    privateText,
    /dup\s+(\d+)\s+(\d+)\s+(?:RD|-\|)\s/g,
    lenIV,
  );
  const widths = readCharStrings(privateProgram, privateText, lenIV, scale, subroutines);
  if (widths.size === 0) return undefined;
  return { widthOfGlyph: (glyph) => widths.get(glyph) };
}

function readCharStrings(
  bytes: Uint8Array,
  text: string,
  lenIV: number,
  scale: number,
  subroutines: Map<number, Uint8Array>,
): Map<string, number> {
  const widths = new Map<string, number>();
  const pattern = /\/([^\s/]+)\s+(\d+)\s+(?:RD|-\|)\s/g;
  for (const match of text.matchAll(pattern)) {
    const glyph = match[1];
    const length = Number(match[2]);
    const start = match.index + match[0].length;
    if (!glyph || !Number.isSafeInteger(length) || length < 0 || start + length > bytes.length)
      continue;
    const encoded = bytes.subarray(start, start + length);
    const charString = lenIV < 0 ? encoded : decrypt(encoded, 4_330, lenIV);
    const width = readCharStringWidth(charString, subroutines);
    if (width !== undefined) widths.set(glyph, width * scale);
  }
  return widths;
}

function readBinaryEntries(
  bytes: Uint8Array,
  text: string,
  pattern: RegExp,
  lenIV: number,
): Map<number, Uint8Array> {
  const output = new Map<number, Uint8Array>();
  for (const match of text.matchAll(pattern)) {
    const key = Number(match[1]);
    const length = Number(match[2]);
    const start = match.index + match[0].length;
    if (!Number.isSafeInteger(key) || !Number.isSafeInteger(length) || length < 0) continue;
    if (start + length > bytes.length) continue;
    const encoded = bytes.subarray(start, start + length);
    output.set(key, lenIV < 0 ? encoded : decrypt(encoded, 4_330, lenIV));
  }
  return output;
}

function readCharStringWidth(
  bytes: Uint8Array,
  subroutines: Map<number, Uint8Array>,
): number | undefined {
  return interpretCharString(bytes, subroutines, [], 0, { operations: 0 });
}

function interpretCharString(
  bytes: Uint8Array,
  subroutines: Map<number, Uint8Array>,
  stack: number[],
  depth: number,
  work: { operations: number },
): number | undefined {
  if (depth > 16) return undefined;
  for (let index = 0; index < bytes.length; ) {
    work.operations += 1;
    if (work.operations > 100_000) return undefined;
    const value = bytes[index] as number;
    index += 1;
    if (value >= 32) {
      const decoded = decodeNumber(bytes, value, index);
      if (!decoded) return undefined;
      stack.push(decoded.value);
      index = decoded.next;
      if (stack.length > 48) return undefined;
      continue;
    }
    if (value === 13) return stack.length >= 2 ? stack.at(-1) : undefined;
    if (value === 10) {
      const subroutine = subroutines.get(stack.pop() ?? -1);
      if (!subroutine) return undefined;
      const width = interpretCharString(subroutine, subroutines, stack, depth + 1, work);
      if (width !== undefined) return width;
      continue;
    }
    if (value === 11) return undefined;
    if (value === 12) {
      const escaped = bytes[index];
      index += 1;
      if (escaped === 7) return stack.length >= 4 ? stack.at(-2) : undefined;
      if (escaped === 12 && stack.length >= 2) {
        const divisor = stack.pop() as number;
        const dividend = stack.pop() as number;
        if (divisor === 0) return undefined;
        stack.push(dividend / divisor);
        continue;
      }
    }
    stack.length = 0;
  }
  return undefined;
}

function decodeNumber(
  bytes: Uint8Array,
  first: number,
  index: number,
): { value: number; next: number } | undefined {
  if (first <= 246) return { value: first - 139, next: index };
  if (first <= 250 && index < bytes.length)
    return { value: (first - 247) * 256 + (bytes[index] as number) + 108, next: index + 1 };
  if (first <= 254 && index < bytes.length)
    return { value: -(first - 251) * 256 - (bytes[index] as number) - 108, next: index + 1 };
  if (first === 255 && index + 4 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + index, 4);
    return { value: view.getInt32(0), next: index + 4 };
  }
  return undefined;
}

function eexecBytes(bytes: Uint8Array, offset: number): Uint8Array | undefined {
  while (offset < bytes.length && isSpace(bytes[offset] as number)) offset += 1;
  const sample = bytes.subarray(offset, Math.min(bytes.length, offset + 8));
  const isHex = sample.length >= 8 && [...sample].every(isHexDigit);
  if (!isHex) return bytes.subarray(offset);
  const output: number[] = [];
  let high: number | undefined;
  for (let index = offset; index < bytes.length; index += 1) {
    const byte = bytes[index] as number;
    if (isSpace(byte)) continue;
    const nibble = hexValue(byte);
    if (nibble < 0) break;
    if (high === undefined) high = nibble;
    else {
      output.push((high << 4) | nibble);
      high = undefined;
    }
  }
  return output.length > 0 ? Uint8Array.from(output) : undefined;
}

function decrypt(bytes: Uint8Array, key: number, discard: number): Uint8Array {
  const output = new Uint8Array(Math.max(0, bytes.length - discard));
  for (let index = 0; index < bytes.length; index += 1) {
    const cipher = bytes[index] as number;
    const plain = cipher ^ (key >> 8);
    key = ((cipher + key) * 52_845 + 22_719) & 0xffff;
    if (index >= discard) output[index - discard] = plain;
  }
  return output;
}

export function unwrapType1Program(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x80) return bytes;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let offset = 0; offset + 6 <= bytes.length; ) {
    if (bytes[offset] !== 0x80) break;
    const type = bytes[offset + 1];
    if (type === 3) break;
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 2, 4).getUint32(0, true);
    offset += 6;
    if ((type !== 1 && type !== 2) || size > bytes.length - offset) break;
    chunks.push(bytes.subarray(offset, offset + size));
    length += size;
    offset += size;
  }
  if (chunks.length === 0) return bytes;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function isSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isHexDigit(byte: number): boolean {
  return hexValue(byte) >= 0;
}

function hexValue(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

import { findBytes } from "./bytes.js";
