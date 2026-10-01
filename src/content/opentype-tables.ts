/** Read an OpenType sfnt directory without copying the embedded outline tables. */
export function readOpenTypeTables(bytes: Uint8Array): Map<string, Uint8Array> | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x4f54544f && signature !== 0x00010000) return undefined;
  const count = view.getUint16(4);
  const directoryEnd = 12 + count * 16;
  if (count === 0 || directoryEnd > bytes.length) return undefined;
  const tables = new Map<string, Uint8Array>();
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (tables.has(tag) || offset < directoryEnd || offset + length > bytes.length)
      return undefined;
    tables.set(tag, bytes.subarray(offset, offset + length));
    if (length > 0) ranges.push([offset, offset + length]);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < ranges.length; index += 1) {
    if ((ranges[index]?.[0] ?? 0) < (ranges[index - 1]?.[1] ?? 0)) return undefined;
  }
  // The sfnt flavor must agree with its outlines; CFF2/collections are unsupported.
  if (signature === 0x4f54544f ? !tables.has("CFF ") : !tables.has("glyf")) return undefined;
  return tables;
}
