import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";
import { structurePage } from "../../src/structure/index.js";

it("requires enclosure evidence before absorbing adjacent text into a table", async () => {
  const source = await fileSource(
    fileURLToPath(new URL("../../fixtures/semantic/rich-content.pdf", import.meta.url)),
  );
  const pdf = await openPdf(source);
  try {
    const page = await pdf.getPage(0);
    const enclosed = structurePage(page).tables[0];
    expect(enclosed?.caption?.map((line) => line.text)).toEqual(["Plan comparison"]);
    expect(enclosed?.cells.at(-1)).toMatchObject({
      columnSpan: 3,
      text: "Footer cell spans all columns and keeps mixed inline content together.",
    });
    const transparent = structurePage({
      ...page,
      paths: page.paths?.map((path) => ({ ...path, strokeOpacity: 0 })),
    }).tables[0];
    expect(transparent?.caption).toBeUndefined();
    expect(transparent?.cells.some((cell) => cell.text.includes("Footer cell"))).toBe(false);
    const unseparated = structurePage({
      ...page,
      paths: page.paths?.filter((path) => /Z$/i.test(path.d)),
    }).tables[0];
    expect(unseparated?.cells.some((cell) => cell.text.includes("Footer cell"))).toBe(false);
    const disjoint = structurePage({
      ...page,
      paths: [
        {
          d: "M70 320L100 320L100 460L70 460ZM490 320L530 320L530 460L490 460Z",
          stroke: "#000000",
        },
      ],
    }).tables[0];
    expect(disjoint?.caption).toBeUndefined();
    expect(disjoint?.cells.some((cell) => cell.text.includes("Footer cell"))).toBe(false);
    const open = structurePage({ ...page, paths: [] }).tables[0];
    expect(open?.caption).toBeUndefined();
    expect(open?.cells.some((cell) => cell.text.includes("Footer cell"))).toBe(false);
    expect(open?.cells.every((cell) => cell.columnSpan === 1)).toBe(true);
  } finally {
    pdf.close();
    await source.close();
  }
});
