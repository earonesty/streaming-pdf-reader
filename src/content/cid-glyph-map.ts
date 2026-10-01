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
  const cids = parseCidCharacters(await reader.decodeStream(encoding), unicode);
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

function parseCidCharacters(
  bytes: Uint8Array,
  unicode: ReadonlyMap<number, string>,
): Map<number, number> {
  const text = new TextDecoder("latin1").decode(bytes);
  const output = new Map<number, number>();
  const sources = [...unicode.keys()].sort((left, right) => left - right);
  for (const block of cidBlocks(text)) {
    const range = block.kind === "cidrange";
    const pattern = range
      ? /<([\da-f]{1,8})>\s*<([\da-f]{1,8})>\s+(\d+)/gi
      : /<([\da-f]{1,8})>\s+(\d+)/gi;
    for (const match of block.text.matchAll(pattern)) {
      const start = Number.parseInt(match[1] ?? "", 16);
      const end = range ? Number.parseInt(match[2] ?? "", 16) : start;
      const cid = Number(match[range ? 3 : 2]);
      if (!Number.isSafeInteger(cid) || cid < 0 || cid + end - start > 0xffff) continue;
      if (!range) {
        if (unicode.has(start)) output.set(start, cid);
        continue;
      }
      // Resolve only sources present in ToUnicode, rather than expanding potentially huge ranges.
      for (let index = firstSource(sources, start); index < sources.length; index += 1) {
        const source = sources[index];
        if (source === undefined || source > end) break;
        output.set(source, cid + source - start);
      }
    }
  }
  return output;
}

function firstSource(sources: number[], start: number): number {
  let low = 0;
  let high = sources.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sources[middle] ?? 0) < start) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Scan each block once; an unterminated block must not restart searches at later markers. */
function* cidBlocks(text: string): Generator<{ kind: string; text: string }> {
  const begin = /begin(cidchar|cidrange)/g;
  while (true) {
    const match = begin.exec(text);
    if (!match) return;
    const kind = match[1] ?? "";
    const endMarker = `end${kind}`;
    const end = text.indexOf(endMarker, begin.lastIndex);
    if (end === -1) return;
    yield { kind, text: text.slice(begin.lastIndex, end) };
    begin.lastIndex = end + endMarker.length;
  }
}
