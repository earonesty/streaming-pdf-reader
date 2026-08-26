export function buildTrueTypeFont(): Uint8Array {
  const bytes = new Uint8Array(320);
  const view = new DataView(bytes.buffer);
  const tables = [
    ["head", 100, 20],
    ["hhea", 120, 36],
    ["maxp", 160, 6],
    ["hmtx", 180, 12],
    ["cmap", 220, 40],
  ] as const;
  view.setUint16(4, tables.length);
  tables.forEach(([tag, offset, length], index) => {
    const record = 12 + index * 16;
    bytes.set(new TextEncoder().encode(tag), record);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, length);
  });
  view.setUint16(100 + 18, 1000);
  view.setUint16(120 + 34, 3);
  view.setUint16(160 + 4, 3);
  view.setUint16(180, 500);
  view.setUint16(184, 600);
  view.setUint16(188, 700);
  view.setUint16(220 + 2, 1);
  view.setUint16(224, 3);
  view.setUint16(226, 10);
  view.setUint32(228, 12);
  view.setUint16(232, 12);
  view.setUint32(236, 28);
  view.setUint32(244, 1);
  view.setUint32(248, 65);
  view.setUint32(252, 66);
  view.setUint32(256, 1);
  return bytes;
}

export function buildFormat4TrueTypeFont(): Uint8Array {
  const bytes = buildTrueTypeFont();
  const view = new DataView(bytes.buffer);
  view.setUint32(88, 44);
  view.setUint16(226, 1);
  view.setUint16(232, 4);
  view.setUint16(234, 32);
  view.setUint16(238, 4);
  view.setUint16(246, 66);
  view.setUint16(248, 0xffff);
  view.setUint16(252, 65);
  view.setUint16(254, 0xffff);
  view.setInt16(256, -64);
  view.setInt16(258, 1);
  view.setUint16(260, 0);
  view.setUint16(262, 0);
  view.setUint16(120 + 34, 2);
  return bytes;
}
