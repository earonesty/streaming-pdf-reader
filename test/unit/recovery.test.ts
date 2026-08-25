import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";
import { findStartXref, scanPdfStructure } from "../../src/syntax/recovery.js";

const encoder = new TextEncoder();

describe("bounded PDF structure recovery", () => {
  it("finds line-delimited objects, trailer roots, and the final startxref", () => {
    const bytes = encoder.encode(
      "%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstream contains 9 0 obj text\n" +
        "trailer\n<< /Root 1 0 R >>\nstartxref\n12\nstartxref\n34\n%%EOF",
    );
    const recovered = scanPdfStructure(bytes, 100);
    expect(recovered.objects.get(1)).toEqual({ offset: 109, generation: 0 });
    expect(recovered.objects.has(9)).toBe(false);
    expect(recovered.root).toEqual({ type: "ref", object: 1, generation: 0 });
    expect(findStartXref(bytes)).toBe(34);
  });

  it("opens a small PDF with no xref table through bounded recovery", async () => {
    const bytes = encoder.encode(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] /CropBox [20 10 180 90] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R
   /Resources << /XObject << /X 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 999 >>
stream
q 1 0 0 1 30 20 cm /X Do Q
endstream
endobj
5 0 obj
<< /Type /XObject /Subtype /Form /BBox [0 0 100 50] /Length 38
   /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
stream
BT /F1 12 Tf 0 0 Td (Recovered) Tj ET
endstream
endobj
trailer
<< /Root 1 0 R /Size 6 >>
%%EOF
`);
    const reader = await openPdf(memorySource(bytes), {
      chunkSize: 64,
      maxBytes: 256,
      maxXrefBytes: 1024,
    });
    expect(await reader.getPageCount()).toBe(1);
    const page = await reader.getPage(0);
    expect([page.width, page.height]).toEqual([160, 80]);
    expect(page.spans.map((span) => span.text).join("")).toBe("Recovered");
    expect(reader.stats.largestSourceRead).toBeLessThanOrEqual(64);
  });

  it("rejects recovery when the bounded window has no catalog root", async () => {
    const bytes = encoder.encode("%PDF-1.4\n1 0 obj\nnull\nendobj\n%%EOF");
    await expect(
      openPdf(memorySource(bytes), { chunkSize: 16, maxBytes: 64, maxXrefBytes: 32 }),
    ).rejects.toThrow("could not locate a /Root reference");
  });
});
