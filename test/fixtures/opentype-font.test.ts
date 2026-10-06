import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";

describe("public FontFile3 OpenType regression fixture", () => {
  it("extracts fonts09.pdf with outlines and a glyph for every character", async () => {
    const bytes = new Uint8Array(await readFile(new URL("./fonts09.pdf", import.meta.url)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "2b9d25ac04654f672519d6e0d525fe10916ac557e111d30d6f356323239ea120",
    );
    const reader = await openPdf(memorySource(bytes));
    try {
      expect(await reader.getPageCount()).toBe(1);
      const page = await reader.getPage(0);
      expect(page.spans.map((span) => span.text).join("")).toBe("“Hello World!”");
      expect(page.fonts).toHaveLength(1);
      const asset = page.fonts?.[0];
      expect(asset?.format).toBe("opentype");
      if (asset?.format !== "opentype") throw new Error("missing embedded OpenType asset");
      const font = opentype.parse(asset.data.slice().buffer as ArrayBuffer);
      expect(font.numGlyphs).toBe(12);
      expect(font.charToGlyphIndex("“")).toBe(10);
      expect(font.charToGlyphIndex("”")).toBe(11);
      for (const span of page.spans) {
        expect(span.fontAssetId).toBe(asset.id);
        for (const character of span.text) {
          expect(font.charToGlyphIndex(character)).toBeGreaterThan(0);
          if (character !== " ")
            expect(font.charToGlyph(character).path.commands.length).toBeGreaterThan(0);
        }
      }
    } finally {
      reader.close();
    }
  });
});
