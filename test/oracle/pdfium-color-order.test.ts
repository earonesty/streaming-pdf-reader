import { PDFiumLibrary } from "@hyzyla/pdfium";
import { expect, it } from "vitest";
import { syntheticImagePdf } from "../helpers/synthetic-images.js";

it("PDFium BGRA rendering returns RGBA bytes with REVERSE_BYTE_ORDER", async () => {
  const pdfium = await PDFiumLibrary.init();
  try {
    const document = await pdfium.loadDocument(syntheticImagePdf({ id: "color-order" }));
    try {
      const rendered = await document.getPage(0).render({ scale: 2, colorSpace: "BGRA" });
      expect([rendered.width, rendered.height]).toEqual([400, 320]);
      // Known source colors, independently of HTML/Sharp or the visual mismatch baseline.
      const samples = [
        { x: 20, y: 80, rgba: [0, 0, 0, 255] },
        { x: 100, y: 80, rgba: [255, 0, 0, 255] },
        { x: 300, y: 80, rgba: [0, 255, 0, 255] },
        { x: 100, y: 240, rgba: [0, 0, 255, 255] },
        { x: 300, y: 240, rgba: [255, 255, 0, 255] },
      ];
      for (const { x, y, rgba } of samples) {
        const offset = (y * rendered.width + x) * 4;
        expect(Array.from(rendered.data.subarray(offset, offset + 4))).toEqual(rgba);
      }
    } finally {
      document.destroy();
    }
  } finally {
    pdfium.destroy();
  }
});
