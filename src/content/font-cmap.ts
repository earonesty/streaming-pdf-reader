const checksumMagic = 0xb1b0afba;

interface TableRecord {
  tag: string;
  data: Uint8Array;
}

export function remapTrueTypeCmap(
  font: Uint8Array,
  mappings: ReadonlyMap<number, number>,
): Uint8Array | undefined {
  const tables = readTables(font);
  if (!tables?.some((table) => table.tag === "head")) {
    return undefined;
  }
  const glyphCount = maxGlyphCount(tables);
  const validMappings = new Map(
    [...mappings].filter(([, glyph]) => glyph >= 0 && glyph < glyphCount),
  );
  const cmap = validMappings.size > 0 ? format12Cmap(validMappings) : undefined;
  const records = tables.map((table) =>
    table.tag === "cmap" && cmap ? { tag: "cmap", data: cmap } : table,
  );
  repairHorizontalMetrics(records);
  if (cmap && !records.some((table) => table.tag === "cmap")) {
    records.push({ tag: "cmap", data: cmap });
  }
  if (!records.some((table) => table.tag === "OS/2")) {
    records.push({ tag: "OS/2", data: minimalOs2(records, validMappings) });
  }
  if (!records.some((table) => table.tag === "name")) {
    records.push({ tag: "name", data: minimalName() });
  }
  if (!records.some((table) => table.tag === "post")) {
    records.push({ tag: "post", data: minimalPost() });
  }
  records.sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0));
  return buildFont(font, records);
}

export async function symbolicTrueTypeGlyphMap(
  reader: PdfObjectReader,
  font: PdfDict,
  data: Uint8Array,
  encoding: FontDecoder,
): Promise<Map<number, number>> {
  if (!isName(font.get("Subtype"), "TrueType")) return new Map();
  const descriptor = await reader.resolveDict(font.get("FontDescriptor"));
  const flags = descriptor?.get("Flags");
  if (typeof flags !== "number" || (flags & 4) === 0) return new Map();
  const cmap = parseTrueTypeCmap(data);
  if (!cmap) return new Map();
  const mappings = new Map<number, number>();
  for (let code = 0; code <= 0xff; code += 1) {
    const decoded = encoding.decode(Uint8Array.of(code));
    const codePoint = decoded.codePointAt(0);
    if (codePoint === undefined || [...decoded].length !== 1) continue;
    const glyph = cmap.glyphOfCodePoint(0xf000 + code) ?? cmap.glyphOfCodePoint(code);
    if (glyph !== undefined) mappings.set(codePoint, glyph);
  }
  return mappings;
}

function repairHorizontalMetrics(tables: TableRecord[]): void {
  const hhea = tables.find((table) => table.tag === "hhea")?.data;
  const maxp = tables.find((table) => table.tag === "maxp")?.data;
  const hmtx = tables.find((table) => table.tag === "hmtx");
  if (!hhea || hhea.length < 36 || !maxp || maxp.length < 6 || !hmtx) return;
  const glyphCount = u16(maxp, 4);
  const metricCount = u16(hhea, 34);
  if (metricCount === 0 || metricCount > glyphCount) return;
  const expected = metricCount * 4 + (glyphCount - metricCount) * 2;
  if (hmtx.data.length >= expected || hmtx.data.length < metricCount * 4) return;
  const repaired = new Uint8Array(expected);
  repaired.set(hmtx.data);
  hmtx.data = repaired;
}

function maxGlyphCount(tables: TableRecord[]): number {
  const maxp = tables.find((table) => table.tag === "maxp")?.data;
  return maxp && maxp.length >= 6 ? u16(maxp, 4) : 0;
}

function minimalOs2(tables: TableRecord[], mappings: ReadonlyMap<number, number>): Uint8Array {
  const output = new Uint8Array(96);
  const hhea = tables.find((table) => table.tag === "hhea")?.data;
  const ascender = hhea && hhea.length >= 8 ? i16(hhea, 4) : 800;
  const descender = hhea && hhea.length >= 8 ? i16(hhea, 6) : -200;
  const bmp = [...mappings.keys()].filter((codePoint) => codePoint <= 0xffff);
  setU16(output, 0, 3);
  setI16(output, 2, 500);
  setU16(output, 4, 400);
  setU16(output, 6, 5);
  output.set(new TextEncoder().encode("BOXP"), 58);
  setU16(output, 62, 0x40);
  setU16(output, 64, bmp.length > 0 ? Math.min(...bmp) : 0);
  setU16(output, 66, bmp.length > 0 ? Math.max(...bmp) : 0xffff);
  setI16(output, 68, ascender);
  setI16(output, 70, descender);
  setU16(output, 74, Math.max(0, ascender));
  setU16(output, 76, Math.max(0, -descender));
  setU32(output, 78, 1);
  setI16(output, 86, Math.round(ascender / 2));
  setI16(output, 88, ascender);
  setU16(output, 92, 32);
  setU16(output, 94, 2);
  return output;
}

function minimalName(): Uint8Array {
  const family = utf16be("BoxPDF Subset");
  const postscript = utf16be("BoxPDFSubset");
  const output = new Uint8Array(30 + family.length + postscript.length);
  setU16(output, 2, 2);
  setU16(output, 4, 30);
  nameRecord(output, 6, 1, family.length, 0);
  nameRecord(output, 18, 6, postscript.length, family.length);
  output.set(family, 30);
  output.set(postscript, 30 + family.length);
  return output;
}

function nameRecord(
  output: Uint8Array,
  offset: number,
  nameId: number,
  length: number,
  stringOffset: number,
): void {
  setU16(output, offset, 3);
  setU16(output, offset + 2, 1);
  setU16(output, offset + 4, 0x409);
  setU16(output, offset + 6, nameId);
  setU16(output, offset + 8, length);
  setU16(output, offset + 10, stringOffset);
}

function minimalPost(): Uint8Array {
  const output = new Uint8Array(32);
  setU32(output, 0, 0x00030000);
  return output;
}

function utf16be(value: string): Uint8Array {
  const output = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    setU16(output, index * 2, value.charCodeAt(index));
  }
  return output;
}

function readTables(font: Uint8Array): TableRecord[] | undefined {
  if (font.length < 12) return undefined;
  const count = u16(font, 4);
  if (count <= 0 || 12 + count * 16 > font.length) return undefined;
  const output: TableRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const offset = u32(font, record + 8);
    const length = u32(font, record + 12);
    if (offset + length > font.length) return undefined;
    output.push({
      tag: String.fromCharCode(...font.subarray(record, record + 4)),
      data: font.slice(offset, offset + length),
    });
  }
  return output;
}

function format12Cmap(mappings: ReadonlyMap<number, number>): Uint8Array {
  const entries = [...mappings]
    .filter(
      ([codePoint, glyph]) =>
        Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        Number.isInteger(glyph) &&
        glyph >= 0 &&
        glyph <= 0xffff,
    )
    .sort((left, right) => left[0] - right[0]);
  const groups: Array<[number, number, number]> = [];
  for (const [codePoint, glyph] of entries) {
    const previous = groups.at(-1);
    if (
      previous &&
      codePoint === previous[1] + 1 &&
      glyph === previous[2] + codePoint - previous[0]
    ) {
      previous[1] = codePoint;
    } else {
      groups.push([codePoint, codePoint, glyph]);
    }
  }
  const output = new Uint8Array(12 + 16 + groups.length * 12);
  setU16(output, 2, 1);
  setU16(output, 4, 3);
  setU16(output, 6, 10);
  setU32(output, 8, 12);
  setU16(output, 12, 12);
  setU32(output, 16, 16 + groups.length * 12);
  setU32(output, 24, groups.length);
  groups.forEach(([start, end, glyph], index) => {
    const offset = 28 + index * 12;
    setU32(output, offset, start);
    setU32(output, offset + 4, end);
    setU32(output, offset + 8, glyph);
  });
  return output;
}

function buildFont(original: Uint8Array, tables: TableRecord[]): Uint8Array {
  const count = tables.length;
  const directoryLength = 12 + count * 16;
  const totalLength = tables.reduce(
    (length, table) => align4(length + table.data.length),
    directoryLength,
  );
  const output = new Uint8Array(totalLength);
  output.set(original.subarray(0, 4));
  setU16(output, 4, count);
  const maximumPower = 2 ** Math.floor(Math.log2(count));
  setU16(output, 6, maximumPower * 16);
  setU16(output, 8, Math.log2(maximumPower));
  setU16(output, 10, count * 16 - maximumPower * 16);
  let dataOffset = directoryLength;
  let headOffset = -1;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let tagIndex = 0; tagIndex < 4; tagIndex += 1) {
      output[record + tagIndex] = table.tag.charCodeAt(tagIndex) || 32;
    }
    output.set(table.data, dataOffset);
    if (table.tag === "head") {
      headOffset = dataOffset;
      if (table.data.length >= 12) setU32(output, dataOffset + 8, 0);
    }
    setU32(
      output,
      record + 4,
      checksum(output.subarray(dataOffset, dataOffset + table.data.length)),
    );
    setU32(output, record + 8, dataOffset);
    setU32(output, record + 12, table.data.length);
    dataOffset = align4(dataOffset + table.data.length);
  });
  if (headOffset >= 0) setU32(output, headOffset + 8, (checksumMagic - checksum(output)) >>> 0);
  return output;
}

function checksum(bytes: Uint8Array): number {
  let total = 0;
  for (let offset = 0; offset < bytes.length; offset += 4)
    total = (total + u32(bytes, offset)) >>> 0;
  return total;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function i16(bytes: Uint8Array, offset: number): number {
  const value = u16(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function setU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function setI16(bytes: Uint8Array, offset: number, value: number): void {
  setU16(bytes, offset, value & 0xffff);
}

function setU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

import type { PdfObjectReader } from "../syntax/document.js";
import { isName, type PdfDict } from "../syntax/values.js";
import type { FontDecoder } from "./encoding.js";
import { parseTrueTypeCmap } from "./truetype.js";
