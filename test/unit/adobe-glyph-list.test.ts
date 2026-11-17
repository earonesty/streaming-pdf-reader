import { describe, expect, it } from "vitest";
import {
  glyphNameToUnicode,
  loadFontEncoding,
  parseType1Encoding,
} from "../../src/content/encoding.js";
import { memorySource, openPdf } from "../../src/index.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import type { PdfDict, PdfValue } from "../../src/syntax/values.js";
import { buildPdfObjects, streamObject } from "../support/pdf-builder.js";

const glyphs = [
  ["endash", "–"],
  ["emdash", "—"],
  ["eacute", "é"],
  ["Eacute", "É"],
  ["Adieresis", "Ä"],
  ["ntilde", "ñ"],
  ["ellipsis", "…"],
  ["Euro", "€"],
  ["Alpha", "Α"],
  ["afii10017", "А"],
  ["alefhebrew", "א"],
  ["dalethatafpatah", "דֲ"],
] as const;

describe("Adobe glyph names without ToUnicode", () => {
  it.each(glyphs)("maps %s and its alternate suffix", (name, unicode) => {
    expect(glyphNameToUnicode(name)).toBe(unicode);
    expect(glyphNameToUnicode(`${name}.alt`)).toBe(unicode);
  });

  it("preserves extraction-friendly ligatures and unknown-name fallback", () => {
    for (const name of ["ff", "fi", "fl", "ffi", "ffl"]) {
      expect(glyphNameToUnicode(name)).toBe(name);
      expect(glyphNameToUnicode(`${name}.alt`)).toBe(name);
    }
    expect(glyphNameToUnicode("noSuchAdobeGlyph")).toBeUndefined();
    expect(glyphNameToUnicode("constructor")).toBeUndefined();
  });

  it("applies Adobe names to Differences text and glyph metrics", async () => {
    const encoding: PdfDict = new Map([
      ["Differences", [123, ...glyphs.map(([value]) => ({ type: "name" as const, value }))]],
    ]);
    const reader = {
      async resolve(value: PdfValue) {
        return value;
      },
    } as PdfObjectReader;
    const decoder = await loadFontEncoding(
      reader,
      new Map<string, PdfValue>([
        ["BaseFont", { type: "name", value: "Helvetica" }],
        ["Encoding", encoding],
      ]),
    );
    expect(decoder.decode(Uint8Array.from(glyphs, (_, index) => 123 + index))).toBe(
      glyphs.map(([, value]) => value).join(""),
    );
    expect(decoder.glyphTable?.slice(123, 126)).toEqual(["endash", "emdash", "eacute"]);
    expect(decoder.advance?.(Uint8Array.of(123, 124, 125))).toBeCloseTo(2.112);
  });

  it("decodes Adobe names in embedded Type 1 encoding arrays", () => {
    const program = `/Encoding 256 array\n${glyphs
      .map(([name], index) => `dup ${123 + index} /${name} put`)
      .join("\n")}\nreadonly def\ncurrentfile eexec`;
    const table = parseType1Encoding(new TextEncoder().encode(program));
    expect(table?.slice(123, 123 + glyphs.length)).toEqual(glyphs.map(([, value]) => value));
  });

  it.each([false, true])("extracts the issue #30 PDF (embedded encoding: %s)", async (embedded) => {
    const content = "BT /F1 12 Tf 72 720 Td (a{b|c}d) Tj ET";
    const program = new TextEncoder().encode(
      "/Encoding 256 array\ndup 123 /endash put\ndup 124 /emdash put\ndup 125 /eacute put\nreadonly def\ncurrentfile eexec",
    );
    const encoding = embedded
      ? "/FontDescriptor 6 0 R"
      : "/Encoding << /BaseEncoding /WinAnsiEncoding /Differences [123 /endash /emdash /eacute] >>";
    const pdf = await openPdf(
      memorySource(
        buildPdfObjects([
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
          `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${encoding} >>`,
          streamObject(new TextEncoder().encode(content)),
          "<< /Type /FontDescriptor /FontName /Helvetica /FontFile 7 0 R >>",
          streamObject(program),
        ]),
      ),
    );
    try {
      const page = await pdf.getPage(0);
      expect(page.spans.map((span) => span.text).join("")).toBe("a–b—céd");
    } finally {
      pdf.close();
    }
  });
});
