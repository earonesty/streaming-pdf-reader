import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";
import { buildPdfObjects } from "../support/pdf-builder.js";

const standardFontDataUrl = `${resolve(import.meta.dirname, "../../node_modules/pdfjs-dist/standard_fonts")}/`;

describe("PDF.js font geometry oracle", () => {
  it.each([
    {
      name: "Standard 14 metrics under a page transform",
      font: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      content: "q 0.85 0 0 0.85 20 30 cm BT /F1 11 Tf 1 0 0 1 40 100 Tm (All swimming) Tj ET Q",
    },
    {
      name: "explicit widths under a rotated text matrix",
      font: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 66 /Widths [600 700] >>",
      content: "BT /F1 14 Tf 0 1 -1 0 120 40 Tm (AB) Tj ET",
    },
  ])("matches $name", async ({ font, content }) => {
    const bytes = buildPdf(font, content);
    const reader = await openPdf(memorySource(bytes));
    const oracle = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
    try {
      const actual = (await reader.getPage(0)).spans[0];
      const expectedPage = await oracle.getPage(1);
      const expectedContent = await expectedPage.getTextContent();
      const expected = expectedContent.items.find((item) => "str" in item && item.str.length > 0);
      if (!actual || !expected || !("str" in expected)) throw new Error("missing oracle text span");
      expect(actual.text).toBe(expected.str);
      expect(actual.bounds.x).toBeCloseTo(expected.transform[4] ?? 0, 4);
      expect(actual.bounds.y).toBeCloseTo(expected.transform[5] ?? 0, 4);
      expect(actual.bounds.width).toBeCloseTo(expected.width, 4);
      expect(actual.bounds.height).toBeCloseTo(expected.height, 4);
      expect(actual.fontSize).toBeCloseTo(
        Math.hypot(expected.transform[2] ?? 0, expected.transform[3] ?? 0),
        4,
      );
    } finally {
      reader.close();
      await oracle.destroy();
    }
  });
});

function buildPdf(font: string, content: string): Uint8Array {
  return buildPdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${font} >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}
