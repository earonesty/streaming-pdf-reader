import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { readOpenTypeTables } from "../../src/content/opentype-tables.js";
import { parseTrueTypeCmap } from "../../src/content/truetype.js";
import { memorySource, openPdf } from "../../src/index.js";
import { buildPdfObjects, streamObject } from "../support/pdf-builder.js";
import { buildTrueTypeFont } from "../support/truetype-font.js";

/** Build an OpenType program containing synthetic CFF outlines. */
function cffOpenType(glyphName = "A"): Uint8Array {
  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(400, 0);
  path.lineTo(400, 700);
  path.closePath();
  return new Uint8Array(
    new opentype.Font({
      familyName: "Embedded OpenType",
      styleName: "Regular",
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs: [
        new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
        new opentype.Glyph({ name: glyphName, unicode: 65, advanceWidth: 600, path }),
      ],
    }).toArrayBuffer(),
  );
}

/** Build a synthetic TrueType-flavored OpenType program. */
function trueTypeOpenType(): Uint8Array {
  const original = buildTrueTypeFont();
  const view = new DataView(original.buffer);
  const records = Array.from({ length: view.getUint16(4) }, (_, index) => {
    const record = 12 + index * 16;
    const offset = view.getUint32(record + 8);
    return {
      tag: original.slice(record, record + 4),
      data: original.slice(offset, offset + view.getUint32(record + 12)),
    };
  });
  records.push({ tag: new TextEncoder().encode("glyf"), data: new Uint8Array(10) });
  records.push({ tag: new TextEncoder().encode("loca"), data: new Uint8Array(8) });
  const bytes = new Uint8Array(
    12 + records.length * 16 + records.reduce((sum, r) => sum + r.data.length, 0),
  );
  const output = new DataView(bytes.buffer);
  output.setUint32(0, 0x00010000);
  output.setUint16(4, records.length);
  let offset = 12 + records.length * 16;
  records.forEach((record, index) => {
    bytes.set(record.tag, 12 + index * 16);
    output.setUint32(20 + index * 16, offset);
    output.setUint32(24 + index * 16, record.data.length);
    bytes.set(record.data, offset);
    offset += record.data.length;
  });
  return bytes;
}

/** Build a PDF embedding the supplied OpenType font and character mappings. */
function fontPdf(
  program: Uint8Array,
  composite = false,
  trueType = false,
  customCmap = false,
  options: {
    cidToGid?: Uint8Array;
    cidToGidFilter?: string;
    fontFile2?: boolean;
    cid?: number;
  } = {},
): Uint8Array {
  return buildPdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    streamObject(
      new TextEncoder().encode(`BT /F1 12 Tf 100 100 Td ${composite ? "<0001>" : "(A)"} Tj ET`),
    ),
    composite
      ? `<< /Type /Font /Subtype /Type0 /BaseFont /EmbeddedOpenType /Encoding ${customCmap ? "10 0 R" : "/Identity-H"} /DescendantFonts [9 0 R] /ToUnicode 8 0 R >>`
      : `<< /Type /Font /Subtype /${trueType ? "TrueType" : "Type1"} /BaseFont /EmbeddedOpenType /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 65 /Widths [600] /FontDescriptor 6 0 R >>`,
    `<< /Type /FontDescriptor /FontName /EmbeddedOpenType /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /${options.fontFile2 ? "FontFile2" : "FontFile3"} 7 0 R >>`,
    streamObject(program, "/Subtype /OpenType"),
    streamObject(
      new TextEncoder().encode(
        "1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <0001> <0041> endbfchar",
      ),
    ),
    `<< /Type /Font /Subtype /${trueType ? "CIDFontType2" : "CIDFontType0"} /BaseFont /EmbeddedOpenType /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 /W [1 [600]] /CIDToGIDMap ${options.cidToGid ? "11 0 R" : "/Identity"} /FontDescriptor 6 0 R >>`,
    streamObject(
      new TextEncoder().encode(`1 begincidrange <0001> <0002> ${options.cid ?? 1} endcidrange`),
    ),
    streamObject(
      options.cidToGid ?? new Uint8Array(),
      options.cidToGidFilter ? `/Filter /${options.cidToGidFilter}` : "",
    ),
  ]);
}

describe("FontFile3 OpenType programs", () => {
  it.each([
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [true, false, true],
  ])(
    "extracts CFF outlines and maps PDF characters (composite=%s, customCmap=%s, namedCid=%s)",
    async (composite, customCmap, namedCid) => {
      const original = cffOpenType(namedCid ? "cid00001" : "A");
      const reader = await openPdf(memorySource(fontPdf(original, composite, false, customCmap)));
      try {
        const page = await reader.getPage(0);
        const asset = page.fonts?.[0];
        expect(asset?.format).toBe("opentype");
        if (asset?.format !== "opentype") throw new Error("missing CFF font");
        expect(readOpenTypeTables(asset.data)?.get("CFF ")).toEqual(
          readOpenTypeTables(original)?.get("CFF "),
        );
        const parsed = opentype.parse(asset.data.slice().buffer as ArrayBuffer);
        expect(parsed.charToGlyphIndex("A")).toBe(1);
        expect(parsed.glyphs.get(1).advanceWidth).toBe(600);
        expect(page.spans[0]?.text).toBe("A");
        expect(page.spans[0]?.fontAssetId).toBe(asset.id);
        expect(page.spans[0]?.bounds.width).toBeCloseTo(7.2);
      } finally {
        reader.close();
      }
    },
  );

  it.each([false, true])(
    "extracts TrueType outlines and repairs the browser cmap (composite=%s)",
    async (composite) => {
      const reader = await openPdf(memorySource(fontPdf(trueTypeOpenType(), composite, true)));
      try {
        const page = await reader.getPage(0);
        const asset = page.fonts?.[0];
        expect(asset?.format).toBe("truetype");
        if (asset?.format !== "truetype") throw new Error("missing TrueType font");
        expect(parseTrueTypeCmap(asset.data)?.glyphOfCodePoint(65)).toBe(1);
        expect(page.spans[0]?.fontAssetId).toBe(asset.id);
        expect(page.spans[0]?.text).toBe("A");
      } finally {
        reader.close();
      }
    },
  );

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "translates CIDs to GIDs before repairing TrueType cmap (FontFile2=%s, customCmap=%s)",
    async (fontFile2, customCmap) => {
      const cid = customCmap ? 7 : 1;
      const cidToGid = new Uint8Array((cid + 1) * 2);
      new DataView(cidToGid.buffer).setUint16(cid * 2, 2);
      const reader = await openPdf(
        memorySource(
          fontPdf(trueTypeOpenType(), true, true, customCmap, { cidToGid, fontFile2, cid }),
        ),
      );
      try {
        const page = await reader.getPage(0);
        const asset = page.fonts?.[0];
        expect(asset?.format).toBe("truetype");
        if (asset?.format !== "truetype") throw new Error("missing TrueType font");
        expect(parseTrueTypeCmap(asset.data)?.glyphOfCodePoint(65)).toBe(2);
        expect(page.spans[0]?.text).toBe("A");
        expect(page.spans[0]?.fontAssetId).toBe(asset.id);
      } finally {
        reader.close();
      }
    },
  );

  it.each([false, true])(
    "retains text and CID cmap fallback when CIDToGIDMap uses an unsupported filter (FontFile2=%s)",
    async (fontFile2) => {
      const reader = await openPdf(
        memorySource(
          fontPdf(trueTypeOpenType(), true, true, false, {
            cidToGid: Uint8Array.of(0, 0, 0, 2),
            cidToGidFilter: "RunLengthDecode",
            fontFile2,
          }),
        ),
      );
      try {
        const page = await reader.getPage(0);
        expect(page.spans[0]?.text).toBe("A");
        const asset = page.fonts?.[0];
        if (asset?.format !== "truetype") throw new Error("missing TrueType font");
        expect(parseTrueTypeCmap(asset.data)?.glyphOfCodePoint(65)).toBe(1);
        expect(page.spans[0]?.fontAssetId).toBe(asset.id);
      } finally {
        reader.close();
      }
    },
  );

  it("preserves CIDToGIDMap decoded-stream resource-limit errors", async () => {
    const reader = await openPdf(
      memorySource(
        fontPdf(trueTypeOpenType(), true, true, false, {
          cidToGid: new TextEncoder().encode(`${"00".repeat(64)}>`),
          cidToGidFilter: "ASCIIHexDecode",
        }),
      ),
      { maxDecodedStreamBytes: 32 },
    );
    try {
      await expect(reader.getPage(0)).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    } finally {
      reader.close();
    }
  });

  it("preserves malformed CIDToGIDMap decoding errors", async () => {
    const reader = await openPdf(
      memorySource(
        fontPdf(trueTypeOpenType(), true, true, false, {
          cidToGid: Uint8Array.of(0, 0, 0, 2),
          cidToGidFilter: "FlateDecode",
        }),
      ),
    );
    try {
      await expect(reader.getPage(0)).rejects.toMatchObject({ code: "INVALID_PDF" });
    } finally {
      reader.close();
    }
  });

  it.each([new Uint8Array(), Uint8Array.of(0, 0, 0)])(
    "maps missing or truncated CIDToGIDMap entries to .notdef instead of assuming identity",
    async (cidToGid) => {
      const reader = await openPdf(
        memorySource(fontPdf(trueTypeOpenType(), true, true, false, { cidToGid })),
      );
      try {
        const page = await reader.getPage(0);
        expect(page.spans[0]?.text).toBe("A");
        const asset = page.fonts?.[0];
        expect(asset?.format).toBe("truetype");
        if (asset?.format !== "truetype") throw new Error("missing TrueType font");
        expect(parseTrueTypeCmap(asset.data)?.glyphOfCodePoint(65)).toBe(0);
      } finally {
        reader.close();
      }
    },
  );

  it("falls back without exposing a malformed OpenType program", async () => {
    const reader = await openPdf(memorySource(fontPdf(Uint8Array.of(0x4f, 0x54, 0x54, 0x4f))));
    try {
      const page = await reader.getPage(0);
      expect(page.fonts ?? []).toHaveLength(0);
      expect(page.spans[0]?.text).toBe("A");
      expect(page.spans[0]?.fontAssetId).toBeUndefined();
    } finally {
      reader.close();
    }
  });

  it("rejects truncated, overlapping, duplicate and unsupported sfnt tables", () => {
    const source = cffOpenType();
    expect(readOpenTypeTables(source.subarray(0, 11))).toBeUndefined();
    expect(readOpenTypeTables(source.subarray(0, 20))).toBeUndefined();
    const badOffset = source.slice();
    new DataView(badOffset.buffer).setUint32(20, source.length);
    expect(readOpenTypeTables(badOffset)).toBeUndefined();
    const headerOverlap = source.slice();
    new DataView(headerOverlap.buffer).setUint32(20, 0);
    expect(readOpenTypeTables(headerOverlap)).toBeUndefined();
    const overlap = source.slice();
    new DataView(overlap.buffer).setUint32(36, new DataView(source.buffer).getUint32(20));
    expect(readOpenTypeTables(overlap)).toBeUndefined();
    const duplicate = source.slice();
    duplicate.set(source.subarray(12, 16), 28);
    expect(readOpenTypeTables(duplicate)).toBeUndefined();
    const unsupported = source.slice();
    unsupported.set(new TextEncoder().encode("ttcf"));
    expect(readOpenTypeTables(unsupported)).toBeUndefined();
    const cff2 = source.slice();
    const count = new DataView(cff2.buffer).getUint16(4);
    for (let i = 0; i < count; i += 1) {
      const offset = 12 + i * 16;
      if (new TextDecoder().decode(cff2.subarray(offset, offset + 4)) === "CFF ")
        cff2.set(new TextEncoder().encode("CFF2"), offset);
    }
    expect(readOpenTypeTables(cff2)).toBeUndefined();
  });
});
