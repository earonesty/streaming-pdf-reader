import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";
import type { TextSpan } from "../../src/types.js";
import { buildPdfObjects, streamObject } from "../support/pdf-builder.js";
import { buildType1Font } from "../support/type1-font.js";

describe("PDF.js embedded and vertical font geometry oracle", () => {
  it("uses an embedded Type 1 width when PDF.js substitutes a fallback", async () => {
    const fontFile = buildType1Font(600);
    const bytes = buildPdfObjects([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      streamObject(new TextEncoder().encode("BT /F1 12 Tf 1 0 0 1 100 100 Tm (A) Tj ET")),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Synthetic /FirstChar 65 /LastChar 65 /FontDescriptor 6 0 R >>",
      "<< /Type /FontDescriptor /FontName /Synthetic /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile 7 0 R >>",
      streamObject(fontFile),
    ]);
    const reader = await openPdf(memorySource(bytes));
    const oracle = await getDocument({ data: bytes.slice() }).promise;
    try {
      const extracted = await reader.getPage(0);
      const actual = extracted.spans[0];
      const oraclePage = await oracle.getPage(1);
      const expected = (await oraclePage.getTextContent()).items.find((item) => "str" in item);
      if (!actual || !expected || !("str" in expected)) throw new Error("missing oracle text span");
      expect(actual.text).toBe(expected.str);
      expect(actual.bounds.x).toBeCloseTo(expected.transform[4] ?? 0, 4);
      expect(actual.bounds.y).toBeCloseTo(expected.transform[5] ?? 0, 4);
      expect(actual.bounds.width).toBeCloseTo(7.2, 4);
      expect(expected.width).toBeCloseTo(8.004, 4);
      const asset = extracted.fonts?.[0];
      expect(asset?.format).toBe("opentype");
      if (asset?.format !== "opentype") throw new Error("missing OpenType font asset");
      expect(new TextDecoder("latin1").decode(asset.data.subarray(0, 4))).toBe("OTTO");
      expect(actual.fontAssetId).toBe(asset?.id);
    } finally {
      reader.close();
      await oracle.destroy();
    }
  });

  it("matches vertical /W2 advances, bounds, direction, and TJ displacement", async () => {
    const content = "BT /F1 20 Tf 1 0 0 1 100 200 Tm [<0041> 100 <0042>] TJ ET";
    const toUnicode =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0041> <0041> <0042> <0042> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";
    const bytes = buildPdfObjects([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      streamObject(new TextEncoder().encode(content)),
      "<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-V /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [65 [600 700]] /DW2 [880 -1000] /W2 [65 [-900 300 850 -1100 350 870]] /CIDToGIDMap /Identity /FontDescriptor 8 0 R >>",
      streamObject(new TextEncoder().encode(toUnicode)),
      "<< /Type /FontDescriptor /FontName /Test /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>",
    ]);
    await expectFirstSpanToMatchPdfJs(bytes, "ttb");
  });
});

async function expectFirstSpanToMatchPdfJs(
  bytes: Uint8Array,
  direction: TextSpan["direction"],
): Promise<void> {
  const reader = await openPdf(memorySource(bytes));
  const oracle = await getDocument({ data: bytes.slice() }).promise;
  try {
    const spans = (await reader.getPage(0)).spans;
    const actual = spans[0];
    const oraclePage = await oracle.getPage(1);
    const content = await oraclePage.getTextContent();
    const expected = content.items.find((item) => "str" in item && item.str.length > 0);
    if (!actual || !expected || !("str" in expected)) throw new Error("missing oracle text span");
    expect(spans.map((span) => span.text).join("")).toBe(expected.str);
    expect(actual.direction).toBe(direction);
    expect(actual.bounds.x).toBeCloseTo(expected.transform[4] ?? 0, 4);
    expect(actual.bounds.y).toBeCloseTo(expected.transform[5] ?? 0, 4);
    const width =
      direction === "ttb"
        ? Math.max(...spans.map((span) => span.bounds.width))
        : actual.bounds.width;
    const last = spans.at(-1) as TextSpan;
    const height =
      direction === "ttb"
        ? actual.bounds.y - (last.bounds.y - last.bounds.height)
        : actual.bounds.height;
    expect(width).toBeCloseTo(expected.width, 4);
    expect(height).toBeCloseTo(expected.height, 4);
  } finally {
    reader.close();
    await oracle.destroy();
  }
}
