import { describe, expect, it } from "vitest";
import { parseToUnicode, reorderBidiLines } from "../../src/content/text.js";
import { memorySource, openPdf } from "../../src/index.js";
import type { TextSpan } from "../../src/types.js";

describe("text flow normalization", () => {
  it("reorders visual RTL chunks by line while retaining LTR lines", () => {
    const spans = [span("ג", 10, 20), span("ב", 15, 20), span("א", 20, 20), span("abc", 5, 10)];
    const reordered = reorderBidiLines(spans);
    expect(reordered.map((item) => item.text).join("")).toBe("אבגabc");
    expect(reordered[0]?.bounds.x).toBe(10);
    expect(reordered[0]?.direction).toBe("rtl");
    expect(reordered[3]?.direction).toBe("ltr");
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

  it("interprets text-state, positioning, array, and quote operators", async () => {
    const content = `q
2 0 0 2 0 0 cm
BT /F1 10 Tf 1 Tc 2 Tw 80 Tz 12 TL 3 Ts
1 0 0 1 10 20 Tm (A) Tj
5 -14 TD [(B) 100 ( C)] TJ
T* (D) '
1 2 (E) " ET Q`;
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate -90 /Contents 4 0 R
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
