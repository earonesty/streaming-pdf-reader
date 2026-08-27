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
  const [encoding, toUnicode] = await Promise.all([
    reader.resolve(encodingValue),
    reader.resolve(toUnicodeValue),
  ]);
  if (!isStream(encoding) || !isStream(toUnicode)) return new Map();
  const [encodingBytes, unicodeBytes] = await Promise.all([
    reader.decodeStream(encoding),
    reader.decodeStream(toUnicode),
  ]);
  const cids = parseCidCharacters(encodingBytes);
  const unicode = parseToUnicode(unicodeBytes).mapping;
  const output = new Map<number, number>();
  for (const [source, cid] of cids) {
    const text = unicode.get(source);
    const codePoint = text?.codePointAt(0);
    if (codePoint !== undefined) output.set(codePoint, cid);
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
