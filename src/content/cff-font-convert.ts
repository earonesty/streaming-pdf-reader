import opentype from "opentype.js";
import type { EmbeddedOpenTypeFont } from "../types.js";
import { wrapCffAsOpenType } from "./font-cmap.js";

export function convertCffFont(
  bytes: Uint8Array,
  id: string,
  family: string | undefined,
  characters: string[],
  glyphNames: Array<string | undefined>,
  unicodeToCid: ReadonlyMap<number, number>,
  widthsByName: ReadonlyMap<string | number, number>,
  defaultWidth: number,
): EmbeddedOpenTypeFont | undefined {
  const glyphCount = cffGlyphCount(bytes);
  if (!glyphCount) return undefined;
  try {
    const bootstrapMappings = new Map<number, number>();
    for (let glyph = 0; glyph < glyphCount && glyph < 0x1900; glyph += 1)
      bootstrapMappings.set(0xe000 + glyph, glyph);
    const bootstrap = wrapCffAsOpenType(bytes, glyphCount, bootstrapMappings);
    if (!bootstrap) return undefined;
    const parsed = opentype.parse(bootstrap.slice().buffer as ArrayBuffer);
    const glyphsByName = new Map<string | number, number>();
    for (let glyph = 0; glyph < glyphCount; glyph += 1) {
      const name = parsed.glyphs.get(glyph).name;
      if (name) glyphsByName.set(name, glyph);
    }
    const visualCodeMapping = unicodeToCid.size === 0;
    const mappings =
      unicodeToCid.size > 0
        ? cidMappings(unicodeToCid, glyphsByName)
        : namedMappings(characters, glyphNames, glyphsByName);
    if (mappings.size === 0) return undefined;
    const widths = new Map<number, number>();
    for (const [name, width] of widthsByName) {
      const glyph = glyphsByName.get(name);
      if (glyph !== undefined) widths.set(glyph, width);
    }
    const data = wrapCffAsOpenType(bytes, glyphCount, mappings, widths, defaultWidth);
    if (!data) return undefined;
    opentype.parse(data.slice().buffer as ArrayBuffer);
    return {
      id,
      ...(family ? { family } : {}),
      format: "opentype",
      data,
      ...(visualCodeMapping ? { visualGlyphMapping: true } : {}),
    };
  } catch {
    return undefined;
  }
}

function namedMappings(
  characters: string[],
  glyphNames: Array<string | undefined>,
  glyphsByName: ReadonlyMap<string | number, number>,
): Map<number, number> {
  const output = new Map<number, number>();
  for (let code = 0; code < glyphNames.length; code += 1) {
    const character = characters[code];
    const glyphName = glyphNames[code];
    const codePoint = character?.codePointAt(0);
    const glyph = glyphName ? glyphsByName.get(glyphName) : undefined;
    if (glyph === undefined) continue;
    output.set(visualCodePoint(code), glyph);
    if (character && codePoint !== undefined && [...character].length === 1)
      output.set(codePoint, glyph);
  }
  return output;
}

function visualCodePoint(code: number): number {
  return 0xf0000 + code;
}

function cidMappings(
  unicodeToCid: ReadonlyMap<number, number>,
  glyphsByName: ReadonlyMap<string | number, number>,
): Map<number, number> {
  const output = new Map<number, number>();
  for (const [codePoint, cid] of unicodeToCid) {
    const glyph =
      glyphsByName.get(cid) ?? glyphsByName.get(`cid${cid.toString().padStart(5, "0")}`);
    if (glyph !== undefined) output.set(codePoint, glyph);
  }
  return output;
}

function cffGlyphCount(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4 || bytes[0] !== 1) return undefined;
  const headerSize = bytes[2] ?? 0;
  const names = cffIndex(bytes, headerSize);
  const topDicts = names ? cffIndex(bytes, names.end) : undefined;
  const topDict = topDicts?.objects[0];
  if (!topDict) return undefined;
  const charStringsOffset = dictNumber(topDict, 17);
  if (charStringsOffset === undefined) return undefined;
  return cffIndex(bytes, charStringsOffset)?.objects.length;
}

function cffIndex(
  bytes: Uint8Array,
  offset: number,
): { objects: Uint8Array[]; end: number } | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined;
  const count = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
  if (count === 0) return { objects: [], end: offset + 2 };
  const offsetSize = bytes[offset + 2] ?? 0;
  if (offsetSize < 1 || offsetSize > 4) return undefined;
  const offsetsStart = offset + 3;
  const dataStart = offsetsStart + (count + 1) * offsetSize;
  if (dataStart > bytes.length) return undefined;
  const offsets: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    let value = 0;
    for (let byte = 0; byte < offsetSize; byte += 1)
      value = value * 256 + (bytes[offsetsStart + index * offsetSize + byte] ?? 0);
    offsets.push(value);
  }
  const end = dataStart + (offsets[count] ?? 0) - 1;
  if (offsets[0] !== 1 || end > bytes.length) return undefined;
  const objects: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = dataStart + (offsets[index] ?? 1) - 1;
    const finish = dataStart + (offsets[index + 1] ?? 1) - 1;
    if (start > finish || finish > bytes.length) return undefined;
    objects.push(bytes.subarray(start, finish));
  }
  return { objects, end };
}

function dictNumber(bytes: Uint8Array, wantedOperator: number): number | undefined {
  const operands: number[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const first = bytes[offset] ?? 0;
    const number = dictOperand(bytes, offset);
    if (number) {
      operands.push(number.value);
      offset = number.end;
      continue;
    }
    const operator = first === 12 ? 1200 + (bytes[offset + 1] ?? 0) : first;
    if (operator === wantedOperator) return operands.at(-1);
    operands.length = 0;
    offset += first === 12 ? 2 : 1;
  }
  return undefined;
}

function dictOperand(
  bytes: Uint8Array,
  offset: number,
): { value: number; end: number } | undefined {
  const first = bytes[offset] ?? 0;
  if (first >= 32 && first <= 246) return { value: first - 139, end: offset + 1 };
  if (first >= 247 && first <= 250)
    return { value: (first - 247) * 256 + (bytes[offset + 1] ?? 0) + 108, end: offset + 2 };
  if (first >= 251 && first <= 254)
    return { value: -(first - 251) * 256 - (bytes[offset + 1] ?? 0) - 108, end: offset + 2 };
  if (first === 28 && offset + 2 < bytes.length) {
    const value = ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
    return { value: value > 0x7fff ? value - 0x10000 : value, end: offset + 3 };
  }
  if (first === 29 && offset + 4 < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4);
    return { value: view.getInt32(0), end: offset + 5 };
  }
  return undefined;
}
