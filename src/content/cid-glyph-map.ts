import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import { parseToUnicode } from "./cmap.js";

/** Join Type0 Encoding CIDs to ToUnicode code points for browser font assets. */
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

/** Convert source mappings to Unicode glyph IDs, ignoring missing glyphs. */
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

/** Resolve last-entry-wins mappings; over-budget CMaps fall back without partial results. */
function parseCidCharacters(
  bytes: Uint8Array,
  unicode: ReadonlyMap<number, string>,
): Map<number, number> {
  const text = new TextDecoder("latin1").decode(bytes);
  const output = new Map<number, number>();
  const sources = [...unicode.keys()].sort((left, right) => left - right);
  if (sources.length === 0) return output;
  // At most 65,536 valid records across all blocks, including duplicates.
  // Grow on demand so small maps do not allocate the 768 KiB maximum capacity.
  const maximumEntryWords = 65_536 * 3;
  let entries = new Uint32Array(0);
  let entryWords = 0;
  for (const block of cidBlocks(text)) {
    const range = block.kind === "cidrange";
    const pattern = range
      ? /<([\da-f]{1,8})>\s*<([\da-f]{1,8})>\s+(\d+)/gi
      : /<([\da-f]{1,8})>\s+(\d+)/gi;
    for (const match of block.text.matchAll(pattern)) {
      const start = Number.parseInt(match[1] ?? "", 16);
      const end = range ? Number.parseInt(match[2] ?? "", 16) : start;
      const cid = Number(match[range ? 3 : 2]);
      if (!Number.isSafeInteger(cid) || cid < 0 || end < start || cid + end - start > 0xffff)
        continue;
      if (entryWords === maximumEntryWords) return output;
      if (entryWords === entries.length) {
        const capacity = Math.min(maximumEntryWords, Math.max(48, entries.length * 2));
        const grown = new Uint32Array(capacity);
        grown.set(entries);
        entries = grown;
      }
      entries[entryWords++] = start;
      entries[entryWords++] = end;
      entries[entryWords++] = cid;
    }
  }
  // Last entry wins. Resolve backwards and remove assigned sources from future scans.
  // Each source is assigned at most once, even when every range overlaps every other range.
  const next = Int32Array.from({ length: sources.length + 1 }, (_, index) => index);
  for (let offset = entryWords - 3; offset >= 0; offset -= 3) {
    const start = entries[offset] ?? 0;
    const end = entries[offset + 1] ?? 0;
    const cid = entries[offset + 2] ?? 0;
    let index = unassignedSource(next, firstSource(sources, start));
    while (index < sources.length) {
      const source = sources[index];
      if (source === undefined || source > end) break;
      output.set(source, cid + source - start);
      const successor = unassignedSource(next, index + 1);
      next[index] = successor;
      index = successor;
    }
  }
  return output;
}

/** Find the next unassigned source, compressing paths to skip previously resolved intervals. */
function unassignedSource(next: Int32Array, index: number): number {
  let root = index;
  while ((next[root] ?? root) !== root) root = next[root] ?? root;
  while (index !== root) {
    const parent = next[index] ?? root;
    next[index] = root;
    index = parent;
  }
  return root;
}

/** Find the first source at or above a range start with binary search. */
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
