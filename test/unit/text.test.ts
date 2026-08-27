import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeUtf16Bytes,
  decodeWithMap,
  normalizeTextCompatibility,
  parseToUnicode,
} from "../../src/content/cmap.js";
import { reorderBidiLines, reorderMixedRtlCitation } from "../../src/content/text.js";
import { memorySource, openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";
import type { TextSpan } from "../../src/types.js";

describe("text flow normalization", () => {
  it("keeps embedded TrueType programs page-scoped and binds their spans", async () => {
    const source = await fileSource(
      resolve(import.meta.dirname, "../../fixtures/pdfjs/basicapi.pdf"),
    );
    const reader = await openPdf(source);
    try {
      const page = await reader.getPage(0);
      const embedded = page.fonts?.find((font) => font.family === "DejaVuSans");
      expect(embedded?.format).toBe("truetype");
      expect(embedded?.data.length).toBeGreaterThan(1_000);
      expect(page.spans.some((span) => span.fontAssetId === embedded?.id)).toBe(true);
    } finally {
      reader.close();
      await source.close();
    }
  });

  it("reorders visual RTL chunks by line while retaining LTR lines", () => {
    const spans = [span("ג", 10, 20), span("ב", 15, 20), span("א", 20, 20), span("abc", 5, 10)];
    const reordered = reorderBidiLines(spans);
    expect(reordered.map((item) => item.text).join("")).toBe("אבגabc");
    expect(reordered[0]?.bounds.x).toBe(10);
    expect(reordered[0]?.direction).toBe("rtl");
    expect(reordered[3]?.direction).toBe("ltr");
  });

  it("preserves chunk order for shaped Arabic presentation forms", () => {
    const reordered = reorderBidiLines([
      span("ﺔﻴﺑﺮﻌﻟا", 30, 20),
      span("طﻮﻄﳋا", 20, 20),
      span("عاﻮﻧا", 10, 20),
    ]);
    expect(reordered.map((item) => item.text).join(" ")).toBe("اﻟﻌﺮﺑﻴﺔ اﳋﻄﻮط اﻧﻮاع");
  });

  it("restores visual-order RTL citations containing nested numbers", () => {
    expect(reorderMixedRtlCitation(") לחוק מבקר המדינה4(ב()15לחיוב פעולות אלה לפי סעיף")).toBe(
      "לחיוב פעולות אלה לפי סעיף15(ב)(4) לחוק מבקר המדינה",
    );
    expect(reorderMixedRtlCitation("שלום עולם")).toBeUndefined();
  });

  it("parses sequential and array ToUnicode ranges with their source width", () => {
    const cmap = parseToUnicode(
      new TextEncoder().encode(`2 beginbfrange
<01> <02> <0061>
<03> <04> [<0066> <00660069>]
endbfrange`),
    );
    expect(cmap.codeBytes).toBe(1);
    expect([...cmap.mapping.entries()]).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "f"],
      [4, "fi"],
    ]);
  });

  it("retains variable-width CMap code spaces for decoding", () => {
    const cmap = parseToUnicode(
      new TextEncoder().encode(`3 begincodespacerange
<00> <7F>
<E08080> <EFBFBF>
<F0808080> <F7BFBFBF>
endcodespacerange
2 beginbfchar
<61> <0061>
<f0a8a780> <d862ddc0>
endbfchar`),
    );
    expect(cmap.codeSpaceRanges).toEqual([
      { width: 1, start: 0, end: 0x7f },
      { width: 3, start: 0xe08080, end: 0xefbfbf },
      { width: 4, start: 0xf0808080, end: 0xf7bfbfbf },
    ]);
    expect(cmap.codeBytes).toBeUndefined();
    expect(cmap.mapping.get(0xf0a8a780)).toBe("𨧀");
  });

  it("decodes fixed and variable CMap codes with mapped and fallback values", () => {
    const fallback = { decode: (bytes: Uint8Array) => String.fromCharCode(...bytes) };
    expect(
      decodeWithMap(
        Uint8Array.of(0x41, 0x81, 0x01, 0x42),
        {
          mapping: new Map([[0x8101, "Ω"]]),
          codeSpaceRanges: [
            { width: 1, start: 0, end: 0x7f },
            { width: 2, start: 0x8100, end: 0x81ff },
          ],
        },
        1,
        fallback,
      ),
    ).toBe("AΩB");
    expect(
      decodeWithMap(
        Uint8Array.of(0x01, 0x02),
        { mapping: new Map(), codeBytes: 2, codeSpaceRanges: [] },
        1,
        fallback,
      ),
    ).toBe("Ă");
    expect(
      decodeWithMap(
        Uint8Array.of(0x41),
        {
          mapping: new Map(),
          codeSpaceRanges: [{ width: 2, start: 0x8100, end: 0x81ff }],
        },
        1,
        fallback,
      ),
    ).toBe("A");
  });

  it("ignores malformed CMap code-space widths", () => {
    const cmap = parseToUnicode(
      new TextEncoder().encode("1 begincodespacerange\n<00> <ffff>\nendcodespacerange"),
    );
    expect(cmap.codeSpaceRanges).toEqual([]);
  });

  it("decodes UTF-16 byte pairs and normalizes compatibility glyphs", () => {
    expect(decodeUtf16Bytes(Uint8Array.of(0, 65, 0, 66, 0))).toBe("AB");
    expect(normalizeTextCompatibility("ﬀﬁﬂﬃﬄﳋ")).toBe("fffiflffifflلخ");
  });

  it("interprets text-state, positioning, array, and quote operators", async () => {
    const content = `0.2 0.4 0.6 rg q
0 2 -2 0 300 0 cm
BT /F1 10 Tf 1 Tc 2 Tw 80 Tz 12 TL 3 Ts
1 0 0 1 10 100 Tm (A) Tj
0.5 g
5 -14 TD [(B) 100 ( C)] TJ
0 1 1 0 k
T* (D) '
1 2 (E) " ET Q
<< /Truncated`;
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Rotate -90 /Contents 4 0 R
   /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
4 0 obj
<< /Length 999 >>
stream
${content}
endstream
endobj
trailer
<< /Root 1 0 R /Size 5 >>
%%EOF`;
    const reader = await openPdf(memorySource(new TextEncoder().encode(pdf)), {
      chunkSize: 128,
      maxBytes: 512,
    });
    const pages = [];
    for await (const page of reader.pages()) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.rotate).toBe(270);
    expect(
      pages[0]?.spans
        .map((span) => span.text)
        .join("")
        .replaceAll(" ", ""),
    ).toBe("ABCDE");
    expect(pages[0]?.spans[0]?.bounds.width).toBeCloseTo(12.272, 5);
    expect(pages[0]?.spans[0]?.bounds.height).toBeCloseTo(20, 5);
    expect(pages[0]?.spans[0]?.fontSize).toBeCloseTo(20, 5);
    expect(pages[0]?.spans[0]?.transform).toEqual([0, -1, 1, 0]);
    expect(pages[0]?.spans.map((span) => span.color)).toEqual([
      "#336699",
      "#808080",
      "#808080",
      "#ff0000",
      "#ff0000",
    ]);
    reader.close();
  });
});

function span(text: string, x: number, y: number): TextSpan {
  return {
    text,
    bounds: { x, y, width: 5, height: 10 },
    direction: "ltr",
    fontSize: 10,
    source: { page: 1, objectNumber: 1 },
  };
}
