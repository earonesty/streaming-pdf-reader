import { describe, expect, it } from "vitest";
import { loadCidUnicodeGlyphMap } from "../../src/content/cid-glyph-map.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import type { PdfDict, PdfStream, PdfValue } from "../../src/syntax/values.js";

describe("CID browser glyph mapping", () => {
  it("joins Encoding CMap CIDs to supplementary ToUnicode code points", async () => {
    const stream = (text: string): PdfStream => ({
      type: "stream",
      dict: new Map(),
      bytes: new TextEncoder().encode(text),
    });
    const encoding = stream("1 begincidchar\n<f0a8a780> 39\nendcidchar");
    const unicode = stream("1 beginbfchar\n<f0a8a780> <d862ddc0>\nendbfchar");
    const font: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "Type0" }],
      ["Encoding", encoding],
    ]);
    const reader = {
      resolve: async (value: PdfValue) => value,
      decodeStream: async (value: PdfStream) => value.bytes,
    } as unknown as PdfObjectReader;

    await expect(loadCidUnicodeGlyphMap(reader, font, unicode)).resolves.toEqual(
      new Map([[0x289c0, 39]]),
    );
  });

  it("maps named Identity encodings directly from Unicode to glyph IDs", async () => {
    const unicode: PdfStream = {
      type: "stream",
      dict: new Map(),
      bytes: new TextEncoder().encode("2 beginbfchar\n<0001> <0054>\n<0010> <003a>\nendbfchar"),
    };
    const font: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "Type0" }],
      ["Encoding", { type: "name", value: "Identity-H" }],
    ]);
    const reader = {
      resolve: async (value: PdfValue) => value,
      decodeStream: async (value: PdfStream) => value.bytes,
    } as unknown as PdfObjectReader;

    await expect(loadCidUnicodeGlyphMap(reader, font, unicode)).resolves.toEqual(
      new Map([
        [0x54, 1],
        [0x3a, 16],
      ]),
    );
  });

  it("does not remap simple fonts without a ToUnicode stream", async () => {
    const reader = {} as PdfObjectReader;
    await expect(loadCidUnicodeGlyphMap(reader, new Map(), undefined)).resolves.toEqual(new Map());
  });
});
