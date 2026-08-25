import { describe, expect, it } from "vitest";
import { parseTrueTypeMetrics } from "../../src/content/truetype.js";

describe("embedded TrueType metrics", () => {
  it("reads Unicode cmap format 12 and horizontal advances", () => {
    const bytes = buildFont();
    const metrics = parseTrueTypeMetrics(bytes);
    expect(metrics?.widthOfCodePoint(65)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(66)).toBeCloseTo(0.7);
    expect(metrics?.widthOfCodePoint(67)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(64)).toBeUndefined();
  });

  it("reads BMP cmap format 4 and reuses the last full horizontal metric", () => {
    const metrics = parseTrueTypeMetrics(buildFormat4Font());
    expect(metrics?.widthOfCodePoint(65)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(66)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(64)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(67)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(0x1_0000)).toBeUndefined();
  });

  it("rejects missing, truncated, and inconsistent metric tables", () => {
    expect(parseTrueTypeMetrics(new Uint8Array(4))).toBeUndefined();
    const missing = buildFont();
    missing.set(new TextEncoder().encode("none"), 12);
    expect(parseTrueTypeMetrics(missing)).toBeUndefined();
    const inconsistent = buildFont();
    new DataView(inconsistent.buffer).setUint16(120 + 34, 4);
    expect(parseTrueTypeMetrics(inconsistent)).toBeUndefined();

    const zeroUnits = buildFont();
    new DataView(zeroUnits.buffer).setUint16(100 + 18, 0);
    expect(parseTrueTypeMetrics(zeroUnits)).toBeUndefined();

    const badCmap = buildFont();
    new DataView(badCmap.buffer).setUint32(228, 1000);
    expect(parseTrueTypeMetrics(badCmap)).toBeUndefined();

    const unsupportedCmap = buildFont();
    new DataView(unsupportedCmap.buffer).setUint16(232, 6);
    expect(parseTrueTypeMetrics(unsupportedCmap)).toBeUndefined();

    const shortCmap = buildFont();
    new DataView(shortCmap.buffer).setUint32(236, 12);
    expect(parseTrueTypeMetrics(shortCmap)).toBeUndefined();

    const outOfRangeGlyph = buildFont();
    new DataView(outOfRangeGlyph.buffer).setUint16(160 + 4, 2);
    new DataView(outOfRangeGlyph.buffer).setUint16(120 + 34, 2);
    expect(parseTrueTypeMetrics(outOfRangeGlyph)?.widthOfCodePoint(66)).toBeUndefined();
  });
});

function buildFormat4Font(): Uint8Array {
  const bytes = buildFont();
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
  new DataView(bytes.buffer).setUint16(120 + 34, 2);
  return bytes;
}

function buildFont(): Uint8Array {
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
