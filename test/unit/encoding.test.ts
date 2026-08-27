import { describe, expect, it } from "vitest";
import {
  detectTrueTypeBaseEncoding,
  glyphNameToUnicode,
  loadFontEncoding,
  parseType1Encoding,
} from "../../src/content/encoding.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import type { PdfDict, PdfValue } from "../../src/syntax/values.js";
import { buildTrueTypeFont } from "../support/truetype-font.js";

describe("simple font encodings", () => {
  it("applies Differences names and ligatures over the base encoding", async () => {
    const encoding: PdfDict = new Map([
      ["BaseEncoding", { type: "name", value: "WinAnsiEncoding" }],
      [
        "Differences",
        [
          31,
          { type: "name", value: "f_f" },
          { type: "name", value: "asteriskmath" },
          { type: "name", value: ".notdef" },
        ],
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
    expect(decoder.decode(Uint8Array.of(33))).toBe("");
    expect(decoder.decode(Uint8Array.of(0x96, 0x97))).toBe("–—");
  });

  it("decodes Unicode and suffix-bearing glyph names", () => {
    expect(glyphNameToUnicode("uni00660069")).toBe("fi");
    expect(glyphNameToUnicode("uni1EC7")).toBe("ệ");
    expect(glyphNameToUnicode("f.sc")).toBe("f");
    expect(glyphNameToUnicode("GED")).toBe("í");
    expect(glyphNameToUnicode("GFA")).toBe("ú");
    expect(glyphNameToUnicode("C121")).toBe("y");
    expect(glyphNameToUnicode("five")).toBe("5");
    expect(glyphNameToUnicode("ampersand")).toBe("&");
  });

  it("reads bounded clear-text Type 1 encoding programs", () => {
    const bytes = new TextEncoder().encode(
      "/Encoding 256 array\ndup 11 /ff put\ndup 14 /ffi put\nreadonly def\ncurrentfile eexec",
    );
    const table = parseType1Encoding(bytes);
    expect(table?.[11]).toBe("ff");
    expect(table?.[14]).toBe("ffi");
  });

  it("ignores Type 1 programs without an explicit array encoding", () => {
    const bytes = new TextEncoder().encode("/Encoding StandardEncoding def");
    expect(parseType1Encoding(bytes)).toBeUndefined();
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

  it("uses explicit simple-font widths with defaults for missing entries", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["FirstChar", 65],
        ["Widths", [250, 750, true]],
      ]),
    );
    expect(decoder.advance?.(Uint8Array.of(65, 66, 67, 68))).toBe(2);
  });

  it("uses Standard 14 metrics when a font omits its width array", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([["BaseFont", { type: "name", value: "Helvetica" }]]),
    );
    expect(decoder.advance?.(Uint8Array.of(65, 32, 66))).toBeCloseTo(1.612);
  });

  it("removes malformed mixed-case subset prefixes from known Adobe families", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([["BaseFont", { type: "name", value: "TtkvjyMinionPro-Regular" }]]),
    );
    expect(decoder.fontFamily).toBe("MinionPro-Regular");
  });

  it("uses FontDescriptor MissingWidth for absent character widths", async () => {
    const descriptor: PdfDict = new Map([["MissingWidth", 321]]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["FirstChar", 65],
        ["Widths", [500]],
        ["FontDescriptor", descriptor],
      ]),
    );
    expect(decoder.advance?.(Uint8Array.of(65, 66))).toBeCloseTo(0.821);
  });

  it("uses CID width arrays, ranges, and the descendant default", async () => {
    const descendant: PdfDict = new Map<string, PdfValue>([
      ["DW", 900],
      ["W", [1, [200, 300], 4, 5, 400]],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["Subtype", { type: "name", value: "Type0" }],
        ["DescendantFonts", [descendant]],
      ]),
    );
    expect(decoder.advance?.(Uint8Array.of(0, 1, 0, 2, 0, 4, 0, 5, 0, 9))).toBeCloseTo(2.2);
  });

  it("uses vertical CID advances, origins, ranges, and defaults", async () => {
    const descendant: PdfDict = new Map<string, PdfValue>([
      ["DW", 800],
      ["W", [65, [600]]],
      ["DW2", [880, -1000]],
      ["W2", [65, [-900, 300, 850], 66, 67, -1100, 350, 870]],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["Subtype", { type: "name", value: "Type0" }],
        ["Encoding", { type: "name", value: "Identity-V" }],
        ["DescendantFonts", [descendant]],
      ]),
    );
    const codes = Uint8Array.of(0, 65, 0, 66, 0, 68);
    expect(decoder.writingMode).toBe("vertical");
    expect(decoder.advance?.(codes)).toBeCloseTo(2.2);
    expect(decoder.verticalAdvance?.(codes)).toBeCloseTo(3);
    expect(decoder.verticalOrigin?.(Uint8Array.of(0, 65))).toEqual({ x: 0.3, y: 0.85 });
    expect(decoder.verticalOrigin?.(Uint8Array.of(0, 66))).toEqual({ x: 0.35, y: 0.87 });
    expect(decoder.verticalOrigin?.(Uint8Array.of(0, 68))).toEqual({ x: 0.4, y: 0.88 });
  });

  it("detects WMode 1 in a CMap stream and tolerates missing vertical arrays", async () => {
    const encoding = {
      type: "stream",
      dict: new Map(),
      bytes: new TextEncoder().encode("/WMode 1 def"),
    } as const;
    const descendant: PdfDict = new Map();
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
      async decodeStream(stream: { bytes: Uint8Array }) {
        return stream.bytes;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["Subtype", { type: "name", value: "Type0" }],
        ["Encoding", encoding],
        ["DescendantFonts", [descendant]],
      ]),
    );
    expect(decoder.writingMode).toBe("vertical");
    expect(decoder.verticalAdvance?.(Uint8Array.of(0, 1))).toBe(1);
    expect(decoder.verticalOrigin?.(Uint8Array.of(0, 1))).toEqual({ x: 0.5, y: 0.88 });
  });

  it("recovers CID Unicode text from an embedded TrueType cmap", async () => {
    const fontFile = { type: "stream", dict: new Map(), bytes: buildTrueTypeFont() } as const;
    const descriptor: PdfDict = new Map([["FontFile2", fontFile]]);
    const descendant: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "CIDFontType2" }],
      ["FontDescriptor", descriptor],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
      async decodeStream(stream: { bytes: Uint8Array }) {
        return stream.bytes;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["Subtype", { type: "name", value: "Type0" }],
        ["Encoding", { type: "name", value: "Identity-H" }],
        ["DescendantFonts", [descendant]],
      ]),
    );
    expect(decoder.decode(Uint8Array.of(0, 1, 0, 2, 0, 9))).toBe("AB�");
    descendant.set("CIDToGIDMap", {
      type: "stream",
      dict: new Map(),
      bytes: Uint8Array.of(0, 0, 0, 2, 0, 1),
    });
    const remapped = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["Subtype", { type: "name", value: "Type0" }],
        ["Encoding", { type: "name", value: "Identity-H" }],
        ["DescendantFonts", [descendant]],
      ]),
    );
    expect(remapped.decode(Uint8Array.of(0, 1, 0, 2))).toBe("BA");
  });

  it("omits advances for missing or malformed width structures", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
    } as PdfObjectReader;
    const malformedSimple = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([["Widths", true]]),
    );
    expect(malformedSimple.advance).toBeUndefined();
    const missingDescendant = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([["Subtype", { type: "name", value: "Type0" }]]),
    );
    expect(missingDescendant.advance).toBeUndefined();
  });

  it("uses named base encodings and ignores malformed Differences entries", async () => {
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const named = await loadFontEncoding(
      reader,
      new Map([["Encoding", { type: "name", value: "MacRomanEncoding" }]]),
    );
    expect(named.decode(Uint8Array.of(0x88))).toBe("à");
    const encoding: PdfDict = new Map([
      [
        "Differences",
        [
          -1,
          { type: "name", value: "unknownGlyph" },
          300,
          { type: "name", value: "A" },
          65,
          { type: "name", value: "unknownGlyph" },
          true,
        ],
      ],
    ]);
    const malformed = await loadFontEncoding(reader, new Map([["Encoding", encoding]]));
    expect(malformed.decode(Uint8Array.of(65))).toBe("A");
    const noDifferences = await loadFontEncoding(
      reader,
      new Map([["Encoding", new Map([["Differences", true]])]]),
    );
    expect(noDifferences.decode(Uint8Array.of(65))).toBe("A");
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

  it("rejects truncated or missing TrueType cmap structures", () => {
    expect(detectTrueTypeBaseEncoding(new Uint8Array(4))).toBeUndefined();
    const truncatedRecord = new Uint8Array(16);
    new DataView(truncatedRecord.buffer).setUint16(4, 1);
    expect(detectTrueTypeBaseEncoding(truncatedRecord)).toBeUndefined();
    const noCmap = new Uint8Array(28);
    const noCmapView = new DataView(noCmap.buffer);
    noCmapView.setUint16(4, 1);
    noCmap.set(new TextEncoder().encode("name"), 12);
    expect(detectTrueTypeBaseEncoding(noCmap)).toBeUndefined();
    noCmap.set(new TextEncoder().encode("cmap"), 12);
    noCmapView.setUint32(20, 27);
    expect(detectTrueTypeBaseEncoding(noCmap)).toBeUndefined();
    const truncatedSubtable = new Uint8Array(36);
    const truncatedView = new DataView(truncatedSubtable.buffer);
    truncatedView.setUint16(4, 1);
    truncatedSubtable.set(new TextEncoder().encode("cmap"), 12);
    truncatedView.setUint32(20, 28);
    truncatedView.setUint16(30, 1);
    expect(detectTrueTypeBaseEncoding(truncatedSubtable)).toBeUndefined();
  });

  it("handles missing and malformed embedded TrueType font files", async () => {
    const trueType: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "TrueType" }],
      ["FontDescriptor", new Map()],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
    } as PdfObjectReader;
    await expect(loadFontEncoding(reader, trueType)).resolves.toBeDefined();
    (trueType.get("FontDescriptor") as PdfDict).set("FontFile2", null);
    await expect(loadFontEncoding(reader, trueType)).resolves.toBeDefined();
  });

  it("uses a valid embedded Macintosh TrueType cmap", async () => {
    const bytes = new Uint8Array(44);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1);
    bytes.set(new TextEncoder().encode("cmap"), 12);
    view.setUint32(20, 28);
    view.setUint16(30, 1);
    view.setUint16(32, 1);
    const descriptor: PdfDict = new Map([
      ["FontFile2", { type: "stream", dict: new Map(), bytes }],
    ]);
    const font: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "TrueType" }],
      ["FontDescriptor", descriptor],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
      async resolveDict(value: PdfValue | undefined) {
        return value instanceof Map ? value : undefined;
      },
      async decodeStream(value: { bytes: Uint8Array }) {
        return value.bytes;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(reader, font);
    expect(decoder.decode(Uint8Array.of(0x88))).toBe("à");
  });

  it("decodes the short Unicode glyph-name form and leaves unknown names unmapped", () => {
    expect(glyphNameToUnicode("u1F600")).toBe("😀");
    expect(glyphNameToUnicode("not-a-glyph")).toBeUndefined();
  });
});
