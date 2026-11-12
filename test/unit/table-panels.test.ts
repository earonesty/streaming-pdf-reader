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

it("attaches a tightly wrapped footer only with enclosure and separator evidence", async () => {
  const { attachTablePanels } = await import("../../src/structure/table-panels.js");
  const line = (text: string, y: number, x = 20) => {
    const bounds = { x, y, width: 150, height: 10 };
    const span = { text, bounds, fontSize: 10, direction: "ltr" as const, source: { page: 1 } };
    return { type: "line" as const, text, bounds, spans: [span], confidence: 1, reasons: [] };
  };
  const makeTable = () => ({
    type: "table" as const,
    page: 1,
    bounds: { x: 20, y: 100, width: 180, height: 60 },
    columns: [20, 120],
    cells: [],
    confidence: 1,
    reasons: [],
  });
  const page = {
    number: 1,
    width: 300,
    height: 300,
    rotate: 0 as const,
    spans: [],
    paths: [
      { d: "M15 60L210 60L210 180L15 180Z", stroke: "#000000" },
      { d: "M15 95L210 95", stroke: "#000000" },
    ],
  };
  // Existing rows establish the final data row; footer lines are unassigned.
  const create = () => {
    const table: import("../../src/structure/index.js").Table = makeTable();
    table.cells.push({
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      text: "Data",
      spans: [],
      bounds: table.bounds,
      confidence: 1,
      reasons: [],
    });
    return table;
  };
  const table = create();
  attachTablePanels(
    page,
    [table],
    [
      line("A wrapped footer begins here", 80),
      line("and continues here.", 65),
      line("Outside prose", 40),
    ],
  );
  expect(table.cells.at(-1)).toMatchObject({
    columnSpan: 2,
    text: "A wrapped footer begins here and continues here.",
  });
  for (const invalid of [
    [line("Footer", 80), line("Unrelated indent", 65, 50)],
    [line("Footer", 80), line("Separated paragraph", 60)],
  ]) {
    const control = create();
    attachTablePanels(page, [control], invalid);
    expect(control.cells).toHaveLength(1);
  }
  const control = create();
  attachTablePanels(
    { ...page, paths: page.paths.slice(0, 1) },
    [control],
    [line("Footer", 80), line("Continued", 65)],
  );
  expect(control.cells).toHaveLength(1);
});
