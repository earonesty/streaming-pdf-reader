import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";
import { structurePage, tableToRows } from "../../src/structure/index.js";

async function structuredFixture(name: string) {
  const source = await fileSource(fileURLToPath(new URL(name, import.meta.url)));
  const pdf = await openPdf(source);
  try {
    return structurePage(await pdf.getPage(0));
  } finally {
    pdf.close();
    await source.close();
  }
}

describe("production semantic regressions", () => {
  it("reconstructs DeKalb Oracle tax rows painted one column at a time", async () => {
    const structured = await structuredFixture("./dekalb-oracle-tax-page.pdf");
    expect(structured.lines.map((line) => line.text)).toContain(
      "HASAN NAJAM 2018 2123-0037 F 7.62 5.07 0.38 0.00 0.00 13.07 10/01/2018 DO",
    );
    expect(structured.tables.some((table) => tableToRows(table).length >= 40)).toBe(true);
  });

  it("uses stroked cell borders to recover the Lauderhill violations table", async () => {
    const structured = await structuredFixture("./lauderhill-goveasy-case.pdf");
    const table = structured.tables.find((candidate) =>
      tableToRows(candidate).some((row) => row.includes("Ordinance/Regulation")),
    );
    expect(table).toBeDefined();
    expect(tableToRows(table as NonNullable<typeof table>)).toEqual([
      ["Ordinance/Regulation", "Section", "Description", "Date Complied"],
      [
        "Code of Ordinance - Chapter 12",
        "Section 12-33(d)",
        expect.stringContaining("Any person engaging in or managing any business"),
        "Not in Compliance - Reinspection Date: 5/13/2026",
      ],
    ]);
  });

  it("removes embedded OCR control characters from St. Augustine prose", async () => {
    const structured = await structuredFixture("./staug-embedded-ocr-page.pdf");
    const text = structured.lines.map((line) => line.text).join("\n");
    expect(
      [...text].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return !(
          (code >= 0 && code <= 8) ||
          code === 11 ||
          code === 12 ||
          (code >= 14 && code <= 31) ||
          code === 127
        );
      }),
    ).toBe(true);
    expect(text).toContain("order. I first ask everyone here today");
  });
});
