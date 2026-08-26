import { describe, expect, it } from "vitest";
import { parseTrueTypeMetrics } from "../../src/content/truetype.js";
import { buildFormat4TrueTypeFont, buildTrueTypeFont } from "../support/truetype-font.js";

describe("embedded TrueType metrics", () => {
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
