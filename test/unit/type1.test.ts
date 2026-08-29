import { describe, expect, it } from "vitest";
import {
  parseType1GlyphPaths,
  parseType1Metrics,
  unwrapType1Program,
} from "../../src/content/type1.js";
import { encodeType2CharString } from "../../src/content/type2-charstring.js";
import { buildType1Font } from "../support/type1-font.js";

describe("embedded Type 1 metrics", () => {
  it("decrypts eexec and CharStrings hsbw widths", () => {
    const metrics = parseType1Metrics(buildType1Font(600));
    expect(metrics?.widthOfGlyph("A")).toBeCloseTo(0.6);
    expect(metrics?.widthOfGlyph("B")).toBeUndefined();
  });

  it.each([
    ["ASCII-hex PFA", { eexec: "hex" as const }],
    ["binary PFB", { container: "pfb" as const }],
    ["sbw", { widthOperator: "sbw" as const }],
    ["subroutine hsbw", { widthOperator: "subroutine" as const }],
    ["div-computed hsbw", { widthOperator: "div" as const }],
    ["unencrypted CharString", { lenIV: -1 }],
  ])("reads %s metrics", (_name, options) => {
    expect(parseType1Metrics(buildType1Font(720, options))?.widthOfGlyph("A")).toBeCloseTo(0.72);
  });

  it.each([50, 720, 2_000, -200])("decodes a %i CharString number", (width) => {
    expect(parseType1Metrics(buildType1Font(width))?.widthOfGlyph("A")).toBeCloseTo(width / 1000);
  });

  it("rejects missing and malformed programs", () => {
    expect(parseType1Metrics(new Uint8Array())).toBeUndefined();
    expect(parseType1Metrics(new TextEncoder().encode("%!PS-AdobeFont-1.0"))).toBeUndefined();
    const invalid = buildType1Font(600);
    expect(parseType1Metrics(invalid.subarray(0, invalid.length - 20))).toBeUndefined();
    expect(parseType1Metrics(buildType1Font(600, { lenIV: 33 }))).toBeUndefined();

    const zeroMatrix = buildType1Font(600);
    replaceAscii(zeroMatrix, "0.001", "0.000");
    expect(parseType1Metrics(zeroMatrix)).toBeUndefined();
  });

  it("rejects malformed PFB segment headers", () => {
    const invalidType = Uint8Array.of(0x80, 9, 0, 0, 0, 0);
    expect(unwrapType1Program(invalidType)).toBe(invalidType);
    const oversized = Uint8Array.of(0x80, 1, 20, 0, 0, 0, 1, 2);
    expect(unwrapType1Program(oversized)).toBe(oversized);
  });

  it("translates dynamic Type 1 hint replacement into Type 2 hint masks", () => {
    const glyph = parseType1GlyphPaths(buildType1Font(600, { dynamicHints: true }))?.glyphs[0];
    expect([...(glyph?.type2CharString ?? [])].filter((byte) => byte === 19)).toHaveLength(2);
  });

  it("preserves a subroutine-provided width alongside dynamic hints", () => {
    const glyph = parseType1GlyphPaths(
      buildType1Font(600, { dynamicHints: true, widthOperator: "subroutine" }),
    )?.glyphs[0];
    expect(glyph?.width).toBe(0.6);
    expect([...(glyph?.type2CharString ?? [])].filter((byte) => byte === 19)).toHaveLength(2);
  });

  it("accepts uppercase hex eexec with PDF whitespace and the default font matrix", () => {
    const source = buildType1Font(600, { eexec: "hex" });
    replaceAscii(source, "FontMatrix", "OtherMatrix");
    const marker = new TextEncoder().encode("currentfile eexec\n");
    const split = findAscii(source, marker);
    const prefix = source.subarray(0, split + marker.length);
    const hex = new TextDecoder("latin1")
      .decode(source.subarray(split + marker.length))
      .toUpperCase();
    const spaced = new TextEncoder().encode(
      [...hex]
        .map((character, index) => (index % 8 === 0 ? `\u0000\t\f\r ${character}` : character))
        .join(""),
    );
    const program = new Uint8Array(prefix.length + spaced.length);
    program.set(prefix);
    program.set(spaced, prefix.length);
    expect(parseType1Metrics(program)?.widthOfGlyph("A")).toBeCloseTo(0.6);
  });
});

describe("Type 2 number encoding", () => {
  it.each([-32_768, 32_767, -32_767.5, 32_767.5])("encodes the boundary operand %s", (value) => {
    expect(() => encodeType2CharString(value, [], new Set(), [], 0.001)).not.toThrow();
  });

  it.each([-32_769, 32_768, -32_768.5, 32_767.999_999, 32_768.5])(
    "rejects the out-of-range operand %s",
    (value) => {
      expect(() => encodeType2CharString(value, [], new Set(), [], 0.001)).toThrow(RangeError);
    },
  );
});

function replaceAscii(bytes: Uint8Array, before: string, after: string): void {
  const source = new TextEncoder().encode(before);
  const replacement = new TextEncoder().encode(after);
  outer: for (let index = 0; index <= bytes.length - source.length; index += 1) {
    for (let offset = 0; offset < source.length; offset += 1) {
      if (bytes[index + offset] !== source[offset]) continue outer;
    }
    bytes.set(replacement, index);
    return;
  }
}

function findAscii(bytes: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}
