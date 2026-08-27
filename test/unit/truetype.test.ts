import { describe, expect, it } from "vitest";
import { remapTrueTypeCmap } from "../../src/content/font-cmap.js";
import { parseTrueTypeMetrics } from "../../src/content/truetype.js";
import { buildFormat4TrueTypeFont, buildTrueTypeFont } from "../support/truetype-font.js";

describe("embedded TrueType metrics", () => {
  it("rebuilds browser-required sfnt metadata without cmap remapping", () => {
    const rebuilt = remapTrueTypeCmap(buildTrueTypeFont(), new Map());
    expect(rebuilt).toBeDefined();
    const bytes = rebuilt ?? new Uint8Array();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tableCount = view.getUint16(4);
    const maximumPower = 2 ** Math.floor(Math.log2(tableCount));
    expect(view.getUint16(6)).toBe(maximumPower * 16);
    expect(view.getUint16(8)).toBe(Math.log2(maximumPower));
    const tags = Array.from({ length: tableCount }, (_, index) =>
      new TextDecoder("latin1").decode(bytes.subarray(12 + index * 16, 16 + index * 16)),
    );
    expect(tags).toContain("OS/2");
  });

  it("pads omitted horizontal side bearings in malformed subsets", () => {
    const malformed = buildTrueTypeFont();
    const source = new DataView(malformed.buffer);
    source.setUint16(160 + 4, 4);
    const rebuilt = remapTrueTypeCmap(malformed, new Map()) ?? new Uint8Array();
    const view = new DataView(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength);
    const tableCount = view.getUint16(4);
    let hmtxLength = 0;
    for (let index = 0; index < tableCount; index += 1) {
      const record = 12 + index * 16;
      const tag = new TextDecoder("latin1").decode(rebuilt.subarray(record, record + 4));
      if (tag === "hmtx") hmtxLength = view.getUint32(record + 12);
    }
    expect(hmtxLength).toBe(14);
  });

  it("rebuilds a browser cmap with supplementary Unicode-to-glyph mappings", () => {
    const remapped = remapTrueTypeCmap(
      buildFormat4TrueTypeFont(),
      new Map([
        [0x41, 1],
        [0x289c0, 2],
      ]),
    );
    expect(remapped).toBeDefined();
    const metrics = parseTrueTypeMetrics(remapped ?? new Uint8Array());
    expect(metrics?.widthOfCodePoint(0x41)).toBeDefined();
    expect(metrics?.widthOfCodePoint(0x289c0)).toBeDefined();
  });
  it("reads Unicode cmap format 12 and horizontal advances", () => {
    const bytes = buildTrueTypeFont();
    const metrics = parseTrueTypeMetrics(bytes);
    expect(metrics?.widthOfCodePoint(65)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(66)).toBeCloseTo(0.7);
    expect(metrics?.widthOfCodePoint(67)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(64)).toBeUndefined();
    expect(metrics?.codePointOfGlyph(1)).toBe(65);
    expect(metrics?.codePointOfGlyph(2)).toBe(66);
    expect(metrics?.codePointOfGlyph(9)).toBeUndefined();
  });

  it("reads BMP cmap format 4 and reuses the last full horizontal metric", () => {
    const metrics = parseTrueTypeMetrics(buildFormat4TrueTypeFont());
    expect(metrics?.widthOfCodePoint(65)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(66)).toBeCloseTo(0.6);
    expect(metrics?.widthOfCodePoint(64)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(67)).toBeUndefined();
    expect(metrics?.widthOfCodePoint(0x1_0000)).toBeUndefined();
    expect(metrics?.codePointOfGlyph(1)).toBe(65);
    expect(metrics?.codePointOfGlyph(2)).toBe(66);
    expect(metrics?.codePointOfGlyph(9)).toBeUndefined();
  });

  it("rejects missing, truncated, and inconsistent metric tables", () => {
    expect(parseTrueTypeMetrics(new Uint8Array(4))).toBeUndefined();
    const missing = buildTrueTypeFont();
    missing.set(new TextEncoder().encode("none"), 12);
    expect(parseTrueTypeMetrics(missing)).toBeUndefined();
    const inconsistent = buildTrueTypeFont();
    new DataView(inconsistent.buffer).setUint16(120 + 34, 4);
    expect(parseTrueTypeMetrics(inconsistent)).toBeUndefined();

    const zeroUnits = buildTrueTypeFont();
    new DataView(zeroUnits.buffer).setUint16(100 + 18, 0);
    expect(parseTrueTypeMetrics(zeroUnits)).toBeUndefined();

    const badCmap = buildTrueTypeFont();
    new DataView(badCmap.buffer).setUint32(228, 1000);
    expect(parseTrueTypeMetrics(badCmap)).toBeUndefined();

    const unsupportedCmap = buildTrueTypeFont();
    new DataView(unsupportedCmap.buffer).setUint16(232, 6);
    expect(parseTrueTypeMetrics(unsupportedCmap)).toBeUndefined();

    const shortCmap = buildTrueTypeFont();
    new DataView(shortCmap.buffer).setUint32(236, 12);
    expect(parseTrueTypeMetrics(shortCmap)).toBeUndefined();

    const outOfRangeGlyph = buildTrueTypeFont();
    new DataView(outOfRangeGlyph.buffer).setUint16(160 + 4, 2);
    new DataView(outOfRangeGlyph.buffer).setUint16(120 + 34, 2);
    expect(parseTrueTypeMetrics(outOfRangeGlyph)?.widthOfCodePoint(66)).toBeUndefined();
  });
});
