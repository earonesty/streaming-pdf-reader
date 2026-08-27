import { Encodings, Font, type IFontNames } from "@pdf-lib/standard-fonts";
import type { PdfObjectReader } from "../syntax/document.js";
import { isDict, isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import { findBytes } from "./bytes.js";
import { embeddedCidUnicodeDecoder, loadCidMetrics } from "./cid.js";
import { parseTrueTypeMetrics } from "./truetype.js";
import { parseType1Metrics, unwrapType1Program } from "./type1.js";

export interface FontDecoder {
  decode(bytes: Uint8Array): string;
  codeUnitBytes?: 1 | 2;
  fontFamily?: string;
  fontAssetId?: string;
  advance?(bytes: Uint8Array): number;
  verticalAdvance?(bytes: Uint8Array): number;
  verticalOrigin?(bytes: Uint8Array): { x: number; y: number };
  writingMode?: "vertical";
}

const glyphNames: Record<string, string> = {
  space: " ",
  acute: "´",
  asteriskmath: "∗",
  ampersand: "&",
  bullet: "•",
  copyright: "©",
  circlecopyrt: "©",
  dieresis: "¨",
  comma: ",",
  period: ".",
  quotedblleft: "“",
  quotedblright: "”",
  quoteleft: "‘",
  quoteright: "’",
  hyphen: "-",
  slash: "/",
  parenleft: "(",
  parenright: ")",
  numbersign: "#",
  dollar: "$",
  percent: "%",
  plus: "+",
  colon: ":",
  semicolon: ";",
  less: "<",
  bracketleft: "[",
  bracketright: "]",
  braceleft: "{",
  braceright: "}",
  ae: "æ",
  AE: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  oe: "œ",
  OE: "Œ",
  ff: "ff",
  fi: "fi",
  fl: "fl",
  ffi: "ffi",
  ffl: "ffl",
  germandbls: "ß",
  dotlessi: "ı",
  uacute: "ú",
  Uacute: "Ú",
  aacute: "á",
  Aacute: "Á",
  iacute: "í",
  Iacute: "Í",
  yacute: "ý",
  Yacute: "Ý",
  ccaron: "č",
  Ccaron: "Č",
  rcaron: "ř",
  Rcaron: "Ř",
  scaron: "š",
  Scaron: "Š",
  zcaron: "ž",
  Zcaron: "Ž",
  ecaron: "ě",
  Ecaron: "Ě",
  uring: "ů",
  Uring: "Ů",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

export async function loadFontEncoding(
  reader: PdfObjectReader,
  font: PdfDict,
  recoverCidUnicode = true,
): Promise<FontDecoder> {
  const fontFamily = baseFontName(font);
  const encodingValue = font.get("Encoding");
  const encoding = encodingValue === undefined ? undefined : await reader.resolve(encodingValue);
  const baseEncoding = isDict(encoding) ? encoding.get("BaseEncoding") : undefined;
  const embeddedEncoding =
    encoding === undefined ? await embeddedFontEncoding(reader, font) : undefined;
  const baseName = isName(encoding)
    ? encoding.value
    : isName(baseEncoding)
      ? baseEncoding.value
      : typeof embeddedEncoding === "string"
        ? embeddedEncoding
        : "StandardEncoding";
  const table = Array.isArray(embeddedEncoding) ? embeddedEncoding : baseTable(baseName);
  const glyphTable = table.map((character) => glyphNameForCharacter(character, baseName));
  if (isDict(encoding)) {
    applyDifferences(
      table,
      encoding.get("Differences"),
      !isName(font.get("Subtype"), "Type3"),
      glyphTable,
    );
  }
  const cidMetrics = await loadCidMetrics(reader, font, encoding);
  const cidUnicode = recoverCidUnicode ? await embeddedCidUnicodeDecoder(reader, font) : undefined;
  const widths = cidMetrics?.advance ?? (await loadFontWidths(reader, font, table, glyphTable));
  return {
    decode: cidUnicode ?? ((bytes) => [...bytes].map((byte) => table[byte] as string).join("")),
    ...(fontFamily ? { fontFamily } : {}),
    ...(widths ? { advance: (bytes: Uint8Array) => widths(bytes) } : {}),
    ...(cidMetrics?.verticalAdvance
      ? {
          verticalAdvance: cidMetrics.verticalAdvance,
          verticalOrigin: cidMetrics.verticalOrigin,
          writingMode: "vertical" as const,
        }
      : {}),
  };
}

function baseFontName(font: PdfDict): string | undefined {
  const value = font.get("BaseFont");
  return isName(value) ? value.value.replace(/^[A-Z]{6}\+/, "") : undefined;
}

async function loadFontWidths(
  reader: PdfObjectReader,
  font: PdfDict,
  characterTable: string[],
  glyphTable: Array<string | undefined>,
): Promise<((bytes: Uint8Array) => number) | undefined> {
  const missingWidth = await loadMissingWidth(reader, font);
  const standardWidths = standardFontWidths(font, glyphTable);
  const value = font.get("Widths");
  if (value === undefined) {
    const embeddedWidths = await embeddedFontWidths(reader, font, characterTable, glyphTable);
    return embeddedWidths ?? standardWidths ?? constantWidth(missingWidth);
  }
  const resolved = await reader.resolve(value);
  if (!Array.isArray(resolved)) {
    const embeddedWidths = await embeddedFontWidths(reader, font, characterTable, glyphTable);
    return embeddedWidths ?? standardWidths ?? constantWidth(missingWidth);
  }
  const first = typeof font.get("FirstChar") === "number" ? (font.get("FirstChar") as number) : 0;
  const widths = resolved.map((width) => (typeof width === "number" ? width / 1000 : undefined));
  return (bytes) => {
    let total = 0;
    for (const byte of bytes) {
      total +=
        widths[byte - first] ?? widthFromStandardFont(standardWidths, byte) ?? missingWidth ?? 0.5;
    }
    return total;
  };
}

async function embeddedFontWidths(
  reader: PdfObjectReader,
  font: PdfDict,
  characterTable: string[],
  glyphTable: Array<string | undefined>,
): Promise<((bytes: Uint8Array) => number) | undefined> {
  const isTrueType = isName(font.get("Subtype"), "TrueType");
  const isType1 = isName(font.get("Subtype"), "Type1") || isName(font.get("Subtype"), "MMType1");
  if (!isTrueType && !isType1) return undefined;
  const descriptor = await reader.resolveDict(font.get("FontDescriptor"));
  const value = descriptor?.get(isTrueType ? "FontFile2" : "FontFile");
  if (value === undefined) return undefined;
  const stream = await reader.resolve(value);
  if (!isStream(stream)) return undefined;
  const bytes = await reader.decodeStream(stream);
  if (isTrueType) {
    const metrics = parseTrueTypeMetrics(bytes);
    if (!metrics) return undefined;
    return (encoded) => {
      let total = 0;
      for (const byte of encoded) {
        const character = characterTable[byte] ?? "";
        for (const value of character) {
          total += metrics.widthOfCodePoint(value.codePointAt(0) ?? 0) ?? 0.5;
        }
      }
      return total;
    };
  }
  const metrics = parseType1Metrics(bytes);
  if (!metrics) return undefined;
  return (encoded) => {
    let total = 0;
    for (const byte of encoded) total += metrics.widthOfGlyph(glyphTable[byte] ?? ".notdef") ?? 0.5;
    return total;
  };
}

async function loadMissingWidth(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<number | undefined> {
  const value = font.get("FontDescriptor");
  if (value === undefined) return undefined;
  const descriptor = await reader.resolveDict(value);
  const width = descriptor?.get("MissingWidth");
  return typeof width === "number" && Number.isFinite(width) ? width / 1000 : undefined;
}

function constantWidth(width: number | undefined): ((bytes: Uint8Array) => number) | undefined {
  return width === undefined ? undefined : (bytes) => bytes.length * width;
}

const standardFontNames = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Symbol",
  "ZapfDingbats",
]);

function standardFontWidths(
  font: PdfDict,
  glyphTable: Array<string | undefined>,
): ((bytes: Uint8Array) => number) | undefined {
  const baseFont = font.get("BaseFont");
  if (!isName(baseFont)) return undefined;
  const name = baseFont.value.replace(/^[A-Z]{6}\+/, "");
  if (!standardFontNames.has(name)) return undefined;
  const metrics = Font.load(name as IFontNames);
  return (bytes) => {
    let total = 0;
    for (const byte of bytes)
      total += (metrics.getWidthOfGlyph(glyphTable[byte] ?? ".notdef") ?? 0) / 1000;
    return total;
  };
}

function widthFromStandardFont(
  advance: ((bytes: Uint8Array) => number) | undefined,
  byte: number,
): number | undefined {
  return advance?.(Uint8Array.of(byte));
}

function glyphNameForCharacter(character: string, encodingName: string): string | undefined {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return undefined;
  const encoding =
    encodingName === "Symbol"
      ? Encodings.Symbol
      : encodingName === "ZapfDingbats"
        ? Encodings.ZapfDingbats
        : Encodings.WinAnsi;
  return encoding.canEncodeUnicodeCodePoint(codePoint)
    ? encoding.encodeUnicodeCodePoint(codePoint).name
    : undefined;
}

async function embeddedFontEncoding(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<string | string[] | undefined> {
  const descriptorValue = font.get("FontDescriptor");
  if (descriptorValue === undefined) return undefined;
  const descriptor = await reader.resolveDict(descriptorValue);
  const isTrueType = isName(font.get("Subtype"), "TrueType");
  const fontFileValue = descriptor?.get(isTrueType ? "FontFile2" : "FontFile");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  const bytes = await reader.decodeStream(fontFile);
  return isTrueType ? detectTrueTypeBaseEncoding(bytes) : parseType1Encoding(bytes);
}

export function parseType1Encoding(bytes: Uint8Array): string[] | undefined {
  bytes = unwrapType1Program(bytes);
  const eexec = new TextEncoder().encode("currentfile eexec");
  const marker = findBytes(bytes, eexec);
  const clearLength = marker < 0 ? Math.min(bytes.length, 64 * 1024) : marker;
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, clearLength));
  if (!/\/Encoding\s+256\s+array/.test(text)) return undefined;
  const table = baseTable("StandardEncoding");
  let found = false;
  for (const match of text.matchAll(/dup\s+(\d+)\s+\/([^\s]+)\s+put/g)) {
    const code = Number(match[1]);
    const name = match[2];
    const unicode = name === undefined ? undefined : glyphNameToUnicode(name);
    if (code >= 0 && code <= 255 && unicode !== undefined) {
      table[code] = unicode;
      found = true;
    }
  }
  return found ? table : undefined;
}

export function detectTrueTypeBaseEncoding(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableCount = view.getUint16(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) return undefined;
    const tag = new TextDecoder("latin1").decode(bytes.subarray(record, record + 4));
    if (tag !== "cmap") continue;
    const offset = view.getUint32(record + 8);
    if (offset + 4 > bytes.length) return undefined;
    const subtableCount = view.getUint16(offset + 2);
    let hasMacintosh = false;
    let hasWindows = false;
    for (let subtable = 0; subtable < subtableCount; subtable += 1) {
      const subtableRecord = offset + 4 + subtable * 8;
      if (subtableRecord + 8 > bytes.length) return undefined;
      const platform = view.getUint16(subtableRecord);
      if (platform === 1) hasMacintosh = true;
      if (platform === 3 && view.getUint16(subtableRecord + 2) !== 0) hasWindows = true;
    }
    return hasMacintosh && !hasWindows ? "MacRomanEncoding" : undefined;
  }
  return undefined;
}

function baseTable(name: string): string[] {
  const label = name === "MacRomanEncoding" ? "macintosh" : "windows-1252";
  const decoder = new TextDecoder(label);
  const table = Array.from({ length: 256 }, (_, byte) => decoder.decode(Uint8Array.of(byte)));
  if (label === "windows-1252") {
    // Older Node/ICU builds can expose these as C1 controls instead of CP1252 punctuation.
    table[0x96] = "–";
    table[0x97] = "—";
  }
  if (name === "StandardEncoding") applyStandardEncoding(table);
  return table;
}

function applyStandardEncoding(table: string[]): void {
  const values: Record<number, string> = {
    161: "¡",
    162: "¢",
    163: "£",
    164: "⁄",
    165: "¥",
    166: "ƒ",
    167: "§",
    168: "¤",
    169: "'",
    170: "“",
    171: "«",
    172: "‹",
    173: "›",
    174: "fi",
    175: "fl",
    177: "–",
    178: "†",
    179: "‡",
    180: "·",
    182: "¶",
    183: "•",
    184: "‚",
    185: "„",
    186: "”",
    187: "»",
    188: "…",
    189: "‰",
    191: "¿",
    193: "`",
    194: "´",
    195: "ˆ",
    196: "˜",
    197: "¯",
    198: "˘",
    199: "˙",
    200: "¨",
    202: "˚",
    203: "¸",
    205: "˝",
    206: "˛",
    207: "ˇ",
    208: "—",
    225: "Æ",
    227: "ª",
    232: "Ł",
    233: "Ø",
    234: "Œ",
    235: "º",
    241: "æ",
    245: "ı",
    248: "ł",
    249: "ø",
    250: "œ",
    251: "ß",
  };
  for (const [code, value] of Object.entries(values)) table[Number(code)] = value;
}

function applyDifferences(
  table: string[],
  value: PdfValue | undefined,
  allowSyntheticHex = true,
  glyphTable?: Array<string | undefined>,
): void {
  if (!Array.isArray(value)) return;
  let code = 0;
  for (const item of value) {
    if (typeof item === "number") {
      code = item;
    } else if (isName(item) && code >= 0 && code <= 255) {
      const unicode =
        !allowSyntheticHex && /^(?:G[0-9a-f]{2,6}|C\d{1,7})$/i.test(item.value)
          ? undefined
          : glyphNameToUnicode(item.value);
      if (unicode !== undefined) table[code] = unicode;
      if (unicode !== undefined && glyphTable) glyphTable[code] = item.value;
      code += 1;
    }
  }
}

export function glyphNameToUnicode(name: string): string | undefined {
  const known = glyphNames[name];
  if (known !== undefined) return known;
  const plainName = name.split(".")[0] as string;
  const syntheticHex = /^G([0-9a-f]{2,6})$/i.exec(plainName)?.[1];
  if (syntheticHex !== undefined) return String.fromCodePoint(Number.parseInt(syntheticHex, 16));
  const syntheticDecimal = /^C(\d{1,7})$/.exec(plainName)?.[1];
  if (syntheticDecimal !== undefined) {
    const codePoint = Number(syntheticDecimal);
    if (codePoint <= 0x10ffff) return String.fromCodePoint(codePoint);
  }
  if (/^[A-Za-z]$/.test(plainName)) return plainName;
  if (/^[A-Za-z](?:_[A-Za-z])+$/.test(plainName)) return plainName.replaceAll("_", "");
  const unicode = /^(?:uni([0-9a-f]{4}(?:[0-9a-f]{4})*)|u([0-9a-f]{4,6}))$/i.exec(plainName);
  const unicodeUnits = unicode?.[1];
  if (unicodeUnits) {
    const units = unicodeUnits.match(/.{4}/g) as RegExpMatchArray;
    return units.map((unit) => String.fromCodePoint(Number.parseInt(unit, 16))).join("");
  }
  const codePoint = unicode?.[2];
  if (codePoint) return String.fromCodePoint(Number.parseInt(codePoint, 16));
  return undefined;
}
