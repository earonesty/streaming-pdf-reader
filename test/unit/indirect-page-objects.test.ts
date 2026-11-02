import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";

describe("indirect page objects", () => {
  it.each(["media", "crop", "contents"] as const)(
    "resolves inherited/indirect %s objects",
    async (kind) => {
      const media = kind === "media" ? "6 0 R" : "[0 0 612 792]";
      const crop = kind === "crop" ? "/CropBox 7 0 R" : "";
      const contents = kind === "contents" ? "8 0 R" : "4 0 R";
      const stream = (text: string) => {
        const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
        return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      };
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox ${media} ${crop} >>`,
        `<< /Type /Page /Parent 2 0 R /Contents ${contents} /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`,
        stream("First"),
        stream("Second"),
        "[0 0 612 792]",
        "[10 20 602 772]",
        "[4 0 R 5 0 R]",
      ];
      let text = "%PDF-1.4\n";
      const offsets = objects.map((object, index) => {
        const offset = text.length;
        text += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
      });
      const xref = text.length;
      text += `xref\n0 9\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size 9 >>\nstartxref\n${xref}\n%%EOF\n`;
      const pdf = await openPdf(memorySource(new TextEncoder().encode(text)));
      try {
        const page = await pdf.getPage(0);
        expect([page.width, page.height]).toEqual(kind === "crop" ? [592, 752] : [612, 792]);
        expect(page.spans.map((span) => span.text)).toContain("First");
        if (kind === "contents") expect(page.spans.map((span) => span.text)).toContain("Second");
      } finally {
        pdf.close();
      }
    },
  );
});
