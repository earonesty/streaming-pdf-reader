import { describe, expect, it } from "vitest";
import {
  detectTrueTypeBaseEncoding,
  glyphNameToUnicode,
  loadFontEncoding,
} from "../../src/content/encoding.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import type { PdfDict, PdfValue } from "../../src/syntax/values.js";

describe("simple font encodings", () => {
  it("applies Differences names and ligatures over the base encoding", async () => {
    const encoding: PdfDict = new Map([
      ["BaseEncoding", { type: "name", value: "WinAnsiEncoding" }],
      [
        "Differences",
        [31, { type: "name", value: "f_f" }, { type: "name", value: "asteriskmath" }],
      ],
    ]);
    const font: PdfDict = new Map([["Encoding", encoding]]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(reader, font);
    expect(decoder.decode(Uint8Array.of(31, 32, 65))).toBe("ff∗A");
  });

  it("decodes Unicode and suffix-bearing glyph names", () => {
    expect(glyphNameToUnicode("uni00660069")).toBe("fi");
    expect(glyphNameToUnicode("uni1EC7")).toBe("ệ");
    expect(glyphNameToUnicode("f.sc")).toBe("f");
  });

  it("uses Adobe StandardEncoding when a simple font omits /Encoding", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(reader, new Map());
    expect(decoder.decode(Uint8Array.of(194, 241, 249, 250))).toBe("´æøœ");
  });

  it("detects a Macintosh cmap in an embedded TrueType font", () => {
    const bytes = new Uint8Array(52);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1);
    bytes.set(new TextEncoder().encode("cmap"), 12);
    view.setUint32(20, 28);
    view.setUint16(30, 1);
    view.setUint16(32, 1);
    expect(detectTrueTypeBaseEncoding(bytes)).toBe("MacRomanEncoding");
    view.setUint16(30, 2);
    view.setUint16(40, 3);
    view.setUint16(42, 1);
    expect(detectTrueTypeBaseEncoding(bytes)).toBeUndefined();
  });
});
