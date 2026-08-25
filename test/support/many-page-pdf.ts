export function buildManyPagePdf(pageCount: number, pageText = "Last page"): Uint8Array {
  const groupSize = 100;
  const groupCount = Math.ceil(pageCount / groupSize);
  const firstGroup = 3;
  const firstPage = firstGroup + groupCount;
  const contentObject = firstPage + pageCount;
  const objects = new Map<number, string>();
  const groupRefs = Array.from({ length: groupCount }, (_, index) => `${firstGroup + index} 0 R`);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${groupRefs.join(" ")}] /MediaBox [0 0 200 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`,
  );
  for (let group = 0; group < groupCount; group += 1) {
    const start = group * groupSize;
    const count = Math.min(groupSize, pageCount - start);
    const refs = Array.from({ length: count }, (_, index) => `${firstPage + start + index} 0 R`);
    objects.set(
      firstGroup + group,
      `<< /Type /Pages /Parent 2 0 R /Count ${count} /Kids [${refs.join(" ")}] >>`,
    );
  }
  for (let page = 0; page < pageCount; page += 1) {
    const parent = firstGroup + Math.floor(page / groupSize);
    objects.set(
      firstPage + page,
      `<< /Type /Page /Parent ${parent} 0 R /Contents ${contentObject} 0 R >>`,
    );
  }
  const content = `BT /F1 12 Tf 20 40 Td (${pageText}) Tj ET`;
  objects.set(contentObject, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (let object = 1; object <= contentObject; object += 1) {
    offsets[object] = pdf.length;
    pdf += `${object} 0 obj\n${objects.get(object)}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${contentObject + 1}\n0000000000 65535 f \n`;
  for (let object = 1; object <= contentObject; object += 1) {
    pdf += `${String(offsets[object]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${contentObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
