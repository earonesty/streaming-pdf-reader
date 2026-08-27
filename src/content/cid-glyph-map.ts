import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import { parseToUnicode } from "./cmap.js";

export async function loadCidUnicodeGlyphMap(
  reader: PdfObjectReader,
  font: PdfDict,
  toUnicodeValue: PdfValue | undefined,
): Promise<Map<number, number>> {
  if (!isName(font.get("Subtype"), "Type0") || toUnicodeValue === undefined) return new Map();
  const encodingValue = font.get("Encoding");
  if (encodingValue === undefined) return new Map();
  const toUnicode = await reader.resolve(toUnicodeValue);
  if (!isStream(toUnicode)) return new Map();
  const unicodeBytes = await reader.decodeStream(toUnicode);
  const unicode = parseToUnicode(unicodeBytes).mapping;
  if (isName(encodingValue) && /^Identity-[HV]$/.test(encodingValue.value)) {
    return unicodeGlyphMap(unicode, (source) => source);
  }
  const encoding = await reader.resolve(encodingValue);
  if (!isStream(encoding)) return new Map();
  const cids = parseCidCharacters(await reader.decodeStream(encoding));
  return unicodeGlyphMap(unicode, (source) => cids.get(source));
}

function unicodeGlyphMap(
  unicode: ReadonlyMap<number, string>,
  glyphForSource: (source: number) => number | undefined,
): Map<number, number> {
  const output = new Map<number, number>();
  for (const [source, text] of unicode) {
    const codePoint = text?.codePointAt(0);
    const glyph = glyphForSource(source);
    if (codePoint !== undefined && glyph !== undefined) output.set(codePoint, glyph);
  }
  return output;
}

function parseCidCharacters(bytes: Uint8Array): Map<number, number> {
  const text = new TextDecoder("latin1").decode(bytes);
  const output = new Map<number, number>();
  for (const match of text.matchAll(/<([\da-f]+)>\s+(\d+)/gi)) {
    const source = Number.parseInt(match[1] ?? "", 16);
    const cid = Number(match[2]);
    if (Number.isSafeInteger(source) && Number.isSafeInteger(cid)) output.set(source, cid);
  }
  return output;
}
