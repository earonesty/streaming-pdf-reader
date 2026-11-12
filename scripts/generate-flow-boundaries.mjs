import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "@boxpdf/writer";

const directory = new URL("../fixtures/semantic/boundaries/", import.meta.url);
await mkdir(directory, { recursive: true });
const fixedDate = new Date("2000-01-01T00:00:00Z");
async function document(title, withMono = false) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("BoxPDF bounded semantic fixtures");
  pdf.setProducer("pdf-lib via @boxpdf/writer");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const mono = withMono ? await pdf.embedFont(StandardFonts.Courier) : regular;
  function line(page, value, x, y, options = {}) {
    const font = options.mono ? mono : options.bold ? bold : regular;
    const size = options.size ?? 11;
    const width = options.width ?? 540;
    if (font.widthOfTextAtSize(value, size) > width)
      throw new Error(`Fixture text exceeds column: ${value}`);
    page.drawText(value, { x, y, font, size });
  }
  return { pdf, line };
}
async function save(name, pdf) {
  const bytes = await pdf.save({ useObjectStreams: false });
  if (bytes.length > 20_000) throw new Error("Fixture exceeds 20 KB budget");
  await writeFile(new URL(name, directory), bytes);
  console.log(`${name}: ${pdf.getPageCount()} pages, ${bytes.length} bytes`);
}
const left = [
  "Readers follow the left column first. This",
  "paragraph describes a single connected idea",
  "using ordinary words and consistent spacing.",
  "It continues below without a new heading",
  "or a change of topic. The final sentence",
  "explains why captions can",
];
const right = [
  "suggest better descriptions when the whole",
  "sentence remains together. The reader should",
  "reach this text only after the left column.",
  "Neither an extra column nor a page shape",
  "should insert a paragraph boundary inside",
  "the sentence. This ends the opening paragraph.",
];
for (const variant of ["plain", "asides", "code"]) {
  const aside = variant === "asides";
  const { pdf, line } = await document(
    aside ? "Column flow with footnote and figure" : "Plain column continuation",
    variant === "code",
  );
  const page = pdf.addPage([612, 420]);
  line(page, "Column continuation", 36, 380, { bold: true, size: 18 });
  if (aside) {
    page.drawRectangle({
      x: 330,
      y: 295,
      width: 210,
      height: 55,
      borderWidth: 1,
      opacity: 0,
      borderOpacity: 1,
    });
    line(page, "Input -> Output", 370, 316, { bold: true, size: 12 });
    line(page, "Figure 1. A separate example diagram.", 330, 280, { size: 9, width: 246 });
  }
  // Deliberately paint left/right bands alternately, not semantic order.
  for (let i = 0; i < left.length; i += 1) {
    line(page, left[i], 36, 245 - i * 15, { width: 240 });
    line(page, right[i], 330, 245 - i * 15, { width: 246 });
  }
  if (aside) {
    page.drawLine({ start: { x: 36, y: 145 }, end: { x: 180, y: 145 }, thickness: 0.5 });
    line(page, "1 Additional source information belongs in a footnote.", 36, 130, {
      size: 8,
      width: 240,
    });
  }
  if (variant === "code") {
    [
      "// load values from the record",
      "for (const value of values) {",
      "  emit(value);",
      "}",
    ].forEach((text, i) => {
      line(page, text, 330, 135 - i * 12, { mono: true, size: 9 });
    });
  }
  await save(`column-${variant}.pdf`, pdf);
}
{
  const { pdf, line } = await document("Page continuation with running furniture");
  const first = pdf.addPage([480, 300]);
  const second = pdf.addPage([480, 300]);
  for (const [index, page] of [first, second].entries()) {
    line(page, "Example journal - continuing article", 36, 278, { size: 8 });
    line(page, `Page ${index + 1}`, 220, 16, { size: 8 });
  }
  line(first, "Page continuation", 36, 246, { size: 18, bold: true });
  [
    "This paragraph starts on the first page and",
    "continues through the available space below.",
    "All of these lines belong to the same idea.",
    "The column width and typeface stay constant.",
    "The final sentence names a collection that",
    "is based on",
  ].forEach((value, i) => {
    line(first, value, 36, 135 - i * 18, { width: 408 });
  });
  [
    "the public archive and remains available for",
    "later study. This sentence continues from the",
    "previous page without a new paragraph.",
  ].forEach((value, i) => {
    line(second, value, 36, 247 - i * 18, { width: 408 });
  });
  line(second, "A genuinely new paragraph starts here.", 36, 165);
  await save("page-furniture.pdf", pdf);
}
{
  const { pdf, line } = await document("Wrapped notes beside a label and a real table");
  const page = pdf.addPage([612, 440]);
  line(page, "Case overview", 36, 395, { size: 18, bold: true });
  line(page, "Case Status", 36, 350, { bold: true });
  line(page, "Open", 130, 350);
  line(page, "Notes", 36, 315, { bold: true });
  [
    "Our records indicate that the permit is missing or has a",
    "delinquent balance. Please contact the service desk",
    "to resolve the balance before the next inspection.",
  ].forEach((value, i) => {
    line(page, value, 130, 315 - i * 15, { width: 430 });
  });
  line(page, "Documents Issued", 36, 235, { bold: true, size: 14 });
  line(page, "Notice of violation issued on May 1.", 36, 213);
  line(page, "Violations", 36, 176, { bold: true, size: 14 });
  for (const y of [156, 132, 102])
    page.drawLine({ start: { x: 36, y }, end: { x: 576, y }, thickness: 0.6 });
  for (const x of [36, 306, 576])
    page.drawLine({ start: { x, y: 102 }, end: { x, y: 156 }, thickness: 0.6 });
  line(page, "Section", 42, 140, { bold: true });
  line(page, "Compliance", 312, 140, { bold: true });
  line(page, "12-33(d)", 42, 115);
  line(page, "Not in compliance", 312, 115);
  await save("wrapped-notes.pdf", pdf);
}
{
  const { pdf, line } = await document("Separate paragraph and table control");
  const page = pdf.addPage([612, 420]);
  line(page, "Distinct paragraphs and data", 36, 380, { bold: true, size: 18 });
  line(page, "This first paragraph ends with a complete thought.", 36, 340);
  line(page, "A second paragraph begins after a visible gap.", 36, 295);
  for (const y of [250, 225, 200])
    page.drawLine({ start: { x: 36, y }, end: { x: 576, y }, thickness: 0.6 });
  for (const x of [36, 306, 576])
    page.drawLine({ start: { x, y: 200 }, end: { x, y: 250 }, thickness: 0.6 });
  line(page, "Label", 42, 233, { bold: true });
  line(page, "Value", 312, 233, { bold: true });
  line(page, "Widget", 42, 208);
  line(page, "42", 312, 208);
  line(page, "Source note: keep this information available.", 36, 160, { size: 9 });
  await save("separation-control.pdf", pdf);
}
{
  const { pdf, line } = await document("Spanning table rows and wrapped footer");
  const page = pdf.addPage([612, 440]);
  line(page, "Inventory notes", 36, 395, { bold: true, size: 18 });
  const rules = [350, 325, 300, 260, 235, 195];
  for (const y of rules) page.drawSvgPath(`M36 ${-y}L576 ${-y}`, { borderWidth: 0.6 });
  for (const [top, bottom] of [
    [350, 300],
    [260, 235],
  ])
    for (const x of [36, 216, 396, 576])
      page.drawSvgPath(`M${x} ${-bottom}L${x} ${-top}`, { borderWidth: 0.6 });
  for (const [text, x] of [
    ["Item", 42],
    ["Quantity", 222],
    ["State", 402],
  ])
    line(page, text, x, 333, { bold: true });
  for (const [text, x] of [
    ["Widget", 42],
    ["2", 222],
    ["Ready", 402],
  ])
    line(page, text, x, 308);
  line(
    page,
    "This is the stuff in the middle of the table, explaining the next group of items.",
    42,
    282,
  );
  line(page, "It wraps onto another line without becoming a data row.", 42, 267);
  for (const [text, x] of [
    ["Gadget", 42],
    ["3", 222],
    ["Pending", 402],
  ])
    line(page, text, x, 243);
  line(
    page,
    "All quantities include replacement units and should be checked before dispatch.",
    42,
    217,
  );
  line(page, "Keep this wrapped footer with the inventory.", 42, 202);
  line(page, "A separate paragraph remains outside the table.", 36, 165);
  await save("spanning-rows.pdf", pdf);
}
