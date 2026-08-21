import type { PdfObjectReader } from "../syntax/document.js";
import { isDict, isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";

export interface FontDecoder {
  decode(bytes: Uint8Array): string;
}

const glyphNames: Record<string, string> = {
  space: " ",
  acute: "´",
  asteriskmath: "∗",
  bullet: "•",
  comma: ",",
  period: ".",
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
};

export async function loadFontEncoding(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<FontDecoder> {
  const encodingValue = font.get("Encoding");
  const encoding = encodingValue === undefined ? undefined : await reader.resolve(encodingValue);
  const baseEncoding = isDict(encoding) ? encoding.get("BaseEncoding") : undefined;
  const embeddedEncoding =
    encoding === undefined ? await embeddedTrueTypeEncoding(reader, font) : undefined;
  const baseName = isName(encoding)
    ? encoding.value
    : isName(baseEncoding)
      ? baseEncoding.value
      : (embeddedEncoding ?? "StandardEncoding");
  const table = baseTable(baseName);
  if (isDict(encoding)) applyDifferences(table, encoding.get("Differences"));
  return { decode: (bytes) => [...bytes].map((byte) => table[byte] as string).join("") };
}

async function embeddedTrueTypeEncoding(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<string | undefined> {
  if (!isName(font.get("Subtype"), "TrueType")) return undefined;
  const descriptor = await reader.resolveDict(font.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile2");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  return detectTrueTypeBaseEncoding(await reader.decodeStream(fontFile));
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

function applyDifferences(table: string[], value: PdfValue | undefined): void {
  if (!Array.isArray(value)) return;
  let code = 0;
  for (const item of value) {
    if (typeof item === "number") {
      code = item;
    } else if (isName(item) && code >= 0 && code <= 255) {
      const unicode = glyphNameToUnicode(item.value);
      if (unicode !== undefined) table[code] = unicode;
      code += 1;
    }
  }
}

export function glyphNameToUnicode(name: string): string | undefined {
  const known = glyphNames[name];
  if (known !== undefined) return known;
  const plainName = name.split(".")[0] as string;
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
