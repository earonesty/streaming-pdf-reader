import { expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";

function linkedPdf(
  uri: string,
  rotate = 0,
  options: { action?: string; rect?: string; content?: string; annotation?: string } = {},
): Uint8Array {
  const content = options.content ?? "BT /F1 12 Tf 30 100 Td (Linked) Tj 80 0 Td (Plain) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /CropBox [10 20 290 190] /Rotate ${rotate} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "[7 0 R]",
    options.annotation ??
      `<< /Type /Annot /Subtype /Link /Rect ${options.rect ?? "[29 96 70 115]"} /A ${options.action ?? "8 0 R"} >>`,
    "<< /S /URI /URI 9 0 R >>",
    `(${uri})`,
    "29",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
it.each([0, 90, 180, 270])(
  "preserves an indirect URI with a crop origin and rotation %i, without linking neighboring text",
  async (rotate) => {
    const pdf = await openPdf(memorySource(linkedPdf("https://example.com/a?x=1&y=2", rotate)));
    try {
      const page = await pdf.getPage(0);
      expect(page.spans.find((span) => span.text === "Linked")?.href).toBe(
        "https://example.com/a?x=1&y=2",
      );
      expect(page.spans.find((span) => span.text === "Plain")?.href).toBeUndefined();
    } finally {
      pdf.close();
    }
  },
);
it.each(["javascript:alert", "data:text/html,test", "https://example.com/has space"])(
  "does not expose unsafe URI %s",
  async (uri) => {
    const pdf = await openPdf(memorySource(linkedPdf(uri)));
    try {
      expect((await pdf.getPage(0)).spans.every((span) => !span.href)).toBe(true);
    } finally {
      pdf.close();
    }
  },
);

it.each(["null", "42", "999 0 R"])(
  "keeps page text when an optional link action is %s",
  async (action) => {
    const pdf = await openPdf(memorySource(linkedPdf("https://example.com", 0, { action })));
    try {
      const page = await pdf.getPage(0);
      expect(page.spans.map((s) => s.text)).toEqual(["Linked", "Plain"]);
      expect(page.spans.every((s) => !s.href)).toBe(true);
    } finally {
      pdf.close();
    }
  },
);
it("resolves indirect rectangle numbers and honors rotated text coordinates", async () => {
  const pdf = await openPdf(
    memorySource(linkedPdf("https://example.com", 0, { rect: "[10 0 R 96 70 115]" })),
  );
  try {
    expect((await pdf.getPage(0)).spans[0]?.href).toBe("https://example.com");
  } finally {
    pdf.close();
  }
  const rotated = await openPdf(
    memorySource(
      linkedPdf("https://example.com", 0, {
        content: "BT /F1 12 Tf 0 1 -1 0 100 50 Tm (Linked) Tj ET",
        rect: "[85 49 101 90]",
      }),
    ),
  );
  try {
    expect((await rotated.getPage(0)).spans[0]?.href).toBe("https://example.com");
  } finally {
    rotated.close();
  }
});
it("does not extend a substring annotation to neighboring unlinked text", async () => {
  const pdf = await openPdf(
    memorySource(
      linkedPdf("https://example.com", 0, {
        content: "BT /F1 12 Tf 30 100 Td (Linked Plain) Tj ET",
      }),
    ),
  );
  try {
    expect((await pdf.getPage(0)).spans[0]?.href).toBeUndefined();
  } finally {
    pdf.close();
  }
});
