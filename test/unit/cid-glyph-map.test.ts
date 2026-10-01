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

  it("maps CID range offsets and boundaries without treating the range end as a cidchar", async () => {
    const stream = (text: string): PdfStream => ({
      type: "stream",
      dict: new Map(),
      bytes: new TextEncoder().encode(text),
    });
    const encoding = stream("2 begincidrange <0020> <0022> 3 <0221> <0222> 545 endcidrange");
    const unicode = stream(
      "6 beginbfchar <001f> <001f> <0020> <0020> <0021> <0041> <0022> <0042> <0221> <201c> <0222> <201d> endbfchar",
    );
    const font: PdfDict = new Map<string, PdfValue>([
      ["Subtype", { type: "name", value: "Type0" }],
      ["Encoding", encoding],
    ]);
    const reader = {
      resolve: async (value: PdfValue) => value,
      decodeStream: async (value: PdfStream) => value.bytes,
    } as unknown as PdfObjectReader;
    await expect(loadCidUnicodeGlyphMap(reader, font, unicode)).resolves.toEqual(
      new Map([
        [32, 3],
        [65, 4],
        [66, 5],
        [0x201c, 545],
        [0x201d, 546],
      ]),
    );
  });

  it.each(["cidchar", "cidrange"])(
    "stops promptly at many unterminated %s markers while retaining earlier mappings",
    async (kind) => {
      const encoding = `1 begincidchar <0001> 7 endcidchar ${`begin${kind} `.repeat(100_000)}<0002> 8`;
      const start = performance.now();
      expect(await customCidMap(encoding)).toEqual(new Map([[65, 7]]));
      // A generous bound catches repeated scans (tens of seconds) without relying on exact timing.
      expect(performance.now() - start).toBeLessThan(2000);
    },
  );

  it("reads mixed blocks and ignores mappings outside blocks or after a missing terminator", async () => {
    expect(
      await customCidMap(
        "<0001> 99 1 begincidchar <0001> 7 endcidchar " +
          "1 begincidrange <0002> <0002> 8 endcidrange " +
          "1 begincidchar <0001> 9 endcidrange",
      ),
    ).toEqual(
      new Map([
        [65, 7],
        [66, 8],
      ]),
    );
  });

  it("does not remap simple fonts without a ToUnicode stream", async () => {
    const reader = {} as PdfObjectReader;
    await expect(loadCidUnicodeGlyphMap(reader, new Map(), undefined)).resolves.toEqual(new Map());
  });
});

async function customCidMap(encodingText: string): Promise<Map<number, number>> {
  const stream = (text: string): PdfStream => ({
    type: "stream",
    dict: new Map(),
    bytes: new TextEncoder().encode(text),
  });
  const font: PdfDict = new Map<string, PdfValue>([
    ["Subtype", { type: "name", value: "Type0" }],
    ["Encoding", stream(encodingText)],
  ]);
  const reader = {
    resolve: async (value: PdfValue) => value,
    decodeStream: async (value: PdfStream) => value.bytes,
  } as unknown as PdfObjectReader;
  return loadCidUnicodeGlyphMap(
    reader,
    font,
    stream("2 beginbfchar <0001> <0041> <0002> <0042> endbfchar"),
  );
}
