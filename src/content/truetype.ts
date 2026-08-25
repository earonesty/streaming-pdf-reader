export interface TrueTypeMetrics {
  widthOfCodePoint(codePoint: number): number | undefined;
}

interface TableRecord {
  offset: number;
  length: number;
}

export function parseTrueTypeMetrics(bytes: Uint8Array): TrueTypeMetrics | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTableDirectory(bytes, view);
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const maxp = tables.get("maxp");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !maxp || !hmtx || !cmap) return undefined;
  if (!contains(head, 20) || !contains(hhea, 36) || !contains(maxp, 6)) return undefined;
  const unitsPerEm = view.getUint16(head.offset + 18);
  const numberOfHMetrics = view.getUint16(hhea.offset + 34);
  const numberOfGlyphs = view.getUint16(maxp.offset + 4);
  if (unitsPerEm === 0 || numberOfHMetrics === 0 || numberOfGlyphs === 0) return undefined;
  if (numberOfHMetrics > numberOfGlyphs || !contains(hmtx, numberOfHMetrics * 4)) return undefined;
  const glyphForCodePoint = readCmap(view, cmap);
  if (!glyphForCodePoint) return undefined;
  return {
    widthOfCodePoint(codePoint) {
      const glyph = glyphForCodePoint(codePoint);
      if (glyph === undefined || glyph >= numberOfGlyphs) return undefined;
      const metric = Math.min(glyph, numberOfHMetrics - 1);
      return view.getUint16(hmtx.offset + metric * 4) / unitsPerEm;
    },
  };
}

function readTableDirectory(bytes: Uint8Array, view: DataView): Map<string, TableRecord> {
  const output = new Map<string, TableRecord>();
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) break;
    const tag = new TextDecoder("latin1").decode(bytes.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset <= bytes.length && length <= bytes.length - offset)
      output.set(tag, { offset, length });
  }
  return output;
}

function readCmap(
  view: DataView,
  table: TableRecord,
): ((codePoint: number) => number | undefined) | undefined {
  if (!contains(table, 4)) return undefined;
  const count = view.getUint16(table.offset + 2);
  const candidates: Array<{ format: number; offset: number; score: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 4 + index * 8;
    if (record + 8 > table.offset + table.length) break;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const offset = table.offset + view.getUint32(record + 4);
    if (offset + 2 > table.offset + table.length) continue;
    const format = view.getUint16(offset);
    const score =
      platform === 3 && encoding === 10 ? 3 : platform === 3 ? 2 : platform === 0 ? 1 : 0;
    if ((format === 4 || format === 12) && score > 0) candidates.push({ format, offset, score });
  }
  candidates.sort((left, right) => right.score - left.score || right.format - left.format);
  const selected = candidates[0];
  if (!selected) return undefined;
  return selected.format === 12
    ? readFormat12(view, table, selected.offset)
    : readFormat4(view, table, selected.offset);
}

function readFormat12(
  view: DataView,
  table: TableRecord,
  offset: number,
): ((codePoint: number) => number | undefined) | undefined {
  if (offset + 16 > table.offset + table.length) return undefined;
  const length = view.getUint32(offset + 4);
  const groups = view.getUint32(offset + 12);
  if (length < 16 || offset + length > table.offset + table.length || groups > 1_000_000)
    return undefined;
  if (16 + groups * 12 > length) return undefined;
  return (codePoint) => {
    let low = 0;
    let high = groups - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const record = offset + 16 + middle * 12;
      const start = view.getUint32(record);
      const end = view.getUint32(record + 4);
      if (codePoint < start) high = middle - 1;
      else if (codePoint > end) low = middle + 1;
      else return view.getUint32(record + 8) + codePoint - start;
    }
    return undefined;
  };
}

function readFormat4(
  view: DataView,
  table: TableRecord,
  offset: number,
): ((codePoint: number) => number | undefined) | undefined {
  if (offset + 14 > table.offset + table.length) return undefined;
  const length = view.getUint16(offset + 2);
  const segmentCount = view.getUint16(offset + 6) / 2;
  if (length < 16 || offset + length > table.offset + table.length || segmentCount > 8192)
    return undefined;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  if (rangeOffsets + segmentCount * 2 > offset + length) return undefined;
  return (codePoint) => {
    if (codePoint > 0xffff) return undefined;
    for (let index = 0; index < segmentCount; index += 1) {
      const end = view.getUint16(endCodes + index * 2);
      if (codePoint > end) continue;
      const start = view.getUint16(startCodes + index * 2);
      if (codePoint < start) return undefined;
      const delta = view.getInt16(deltas + index * 2);
      const rangeOffsetPosition = rangeOffsets + index * 2;
      const rangeOffset = view.getUint16(rangeOffsetPosition);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
      if (glyphPosition + 2 > offset + length) return undefined;
      const glyph = view.getUint16(glyphPosition);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return undefined;
  };
}

function contains(table: TableRecord, requiredLength: number): boolean {
  return table.length >= requiredLength;
}
