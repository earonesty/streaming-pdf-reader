import { deflate } from "pako";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf, PdfError } from "../../src/index.js";
import { decodeFlate } from "../../src/syntax/filters.js";

describe("typed PDF errors", () => {
  it("reports malformed documents with INVALID_PDF", async () => {
    await expect(
      openPdf(memorySource(new TextEncoder().encode("%PDF-1.4\n%%EOF"))),
    ).rejects.toMatchObject({ name: "PdfError", code: "INVALID_PDF" });
  });

  it("reports encryption and unsupported filters", async () => {
    await expect(openPdf(memorySource(buildPdf("", "/Encrypt 6 0 R")))).rejects.toMatchObject({
      code: "UNSUPPORTED_FEATURE",
    });
    const reader = await openPdf(memorySource(buildPdf("/Filter /RunLengthDecode")));
    await expect(reader.getPage(0)).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
  });

  it("reports decoded-byte ceilings with RESOURCE_LIMIT", async () => {
    const error = await decodeFlate(deflate(new Uint8Array(32)), undefined, 4).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PdfError);
    expect(error).toMatchObject({ code: "RESOURCE_LIMIT" });
  });
});

function buildPdf(filter: string, trailerExtra = ""): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    `<< /Length 0 ${filter} >>\nstream\n\nendstream`,
    "<<>>",
    "<< /Filter /Standard >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
