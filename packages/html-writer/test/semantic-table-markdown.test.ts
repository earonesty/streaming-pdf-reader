import type { Table } from "@boxpdf/reader/structure";
import { marked } from "marked";
import { expect, it } from "vitest";
import { markdownTableChunks } from "../src/semantic-table-markdown.js";

function table(rows: string[][]): Table {
  return {
    type: "table",
    page: 1,
    bounds: { x: 0, y: 0, width: 200, height: 100 },
    columns: [0, 100],
    confidence: 1,
    reasons: [],
    cells: rows.flatMap((row, r) =>
      row.map((text, c) => ({
        row: r,
        column: c,
        columnSpan: row.length === 1 ? 2 : 1,
        rowSpan: 1,
        text,
        bounds: { x: c * 100, y: 100 - r * 20, width: 80, height: 10 },
        confidence: 1,
        reasons: [],
        spans: [
          {
            text,
            fontSize: 10,
            direction: "ltr" as const,
            source: { page: 1 },
            bounds: { x: c * 100, y: 100 - r * 20, width: 80, height: 10 },
          },
        ],
      })),
    ),
  };
}
it("splits middle and final spans and repeats established headers", () => {
  const value = [
    ...markdownTableChunks(
      table([["Item", "Qty"], ["Widget", "2"], ["Middle note"], ["Gadget", "3"], ["End note"]]),
      "#000000",
    ),
  ].join("");
  expect(value).toBe(
    "| Item | Qty |\n| --- | --- |\n| Widget | 2 |\n\n_Middle note_\n\n| Item | Qty |\n| --- | --- |\n| Gadget | 3 |\n\n_End note_\n\n",
  );
});
it("retains original headers through a headerless continuation and a split", () => {
  const header = table([["Item", "Qty"]]);
  const value = [
    ...markdownTableChunks(
      table([["Gadget", "3"], ["Middle note"], ["Spare", "4"]]),
      "#000000",
      header,
      true,
      ["Item", "Qty"],
    ),
  ].join("");
  expect(value).toBe(
    "| Gadget | 3 |\n\n_Middle note_\n\n| Item | Qty |\n| --- | --- |\n| Spare | 4 |\n",
  );
});
it("preserves links and escapes while applying one italic wrapper", () => {
  const input = table([["Item", "Qty"], ["Widget", "2"], ["Use *these* | values"]]);
  const span = input.cells.at(-1)?.spans[0];
  if (!span) throw new Error("missing fixture span");
  span.fontFamily = "Helvetica-BoldOblique";
  span.href = "https://example.com";
  const html = marked.parse([...markdownTableChunks(input, "#000000")].join(""));
  expect(html).toContain(
    '<em><strong><a href="https://example.com">Use *these* | values</a></strong></em>',
  );
});
it("retains HTML for rowspans that table splitting cannot represent", () => {
  const input = table([
    ["Item", "Qty"],
    ["Widget", "2"],
  ]);
  if (input.cells[2]) input.cells[2].rowSpan = 2;
  expect([...markdownTableChunks(input, "#000000")].join("")).toContain('rowspan="2"');
});
it("suppresses repeated regular headers even when continuation data is nonnumeric", () => {
  const header = table([
    ["Item", "Qty"],
    ["Widget", "2"],
  ]);
  const value = [
    ...markdownTableChunks(
      table([
        ["Item", "Qty"],
        ["Gadget", "Unknown"],
      ]),
      "#000000",
      header,
      true,
      ["Item", "Qty"],
    ),
  ].join("");
  expect(value).toBe("| Gadget | Unknown |\n");
});
it("does not insert a cell into a position occupied by a rowspan", () => {
  const input = table([
    ["Item", "Qty"],
    ["Widget", "2"],
    ["Spare", "4"],
  ]);
  const spanning = input.cells[2];
  if (!spanning) throw new Error("missing cell");
  spanning.rowSpan = 2;
  input.cells = input.cells.filter((cell) => !(cell.row === 2 && cell.column === 0));
  const html = [...markdownTableChunks(input, "#000000")].join("");
  expect(html).toContain('<td rowspan="2">Widget</td>');
  expect(html).toContain("<tr><td>4</td></tr>");
  expect(html).not.toContain("<tr><td></td><td>4</td></tr>");
});
