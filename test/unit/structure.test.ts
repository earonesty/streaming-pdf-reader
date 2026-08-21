import { describe, expect, it } from "vitest";
import type { ExtractedPage, TextSpan } from "../../src/index.js";
import { structurePage, tableToCsv, tableToHtml, tableToRows } from "../../src/structure/index.js";

describe("structured extraction quality gate", () => {
  it("reconstructs aligned rows and formats tabular data deterministically", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 300,
      height: 300,
      rotate: 0,
      spans: [
        span("Item", 20, 250, 35),
        span("Price", 180, 250, 35),
        span("Socks", 20, 230, 40),
        span("$28", 180, 230, 25),
        span("Hat", 20, 210, 22),
        span("$12, sale", 180, 210, 55),
      ],
    };

    const structured = structurePage(page);
    expect(structured.lines.map((line) => line.text)).toEqual([
      "Item Price",
      "Socks $28",
      "Hat $12, sale",
    ]);
    expect(structured.tables).toHaveLength(1);
    const table = structured.tables[0];
    if (!table) throw new Error("expected a table");
    expect(tableToRows(table)).toEqual([
      ["Item", "Price"],
      ["Socks", "$28"],
      ["Hat", "$12, sale"],
    ]);
    expect(tableToCsv(table)).toBe('Item,Price\nSocks,$28\nHat,"$12, sale"');
    expect(tableToHtml(table)).toBe(
      "<table><tr><td>Item</td><td>Price</td></tr><tr><td>Socks</td><td>$28</td></tr><tr><td>Hat</td><td>$12, sale</td></tr></table>",
    );
  });
});

function span(text: string, x: number, y: number, width: number): TextSpan {
  return {
    text,
    bounds: { x, y, width, height: 12 },
    direction: "ltr",
    fontSize: 12,
    source: { page: 1 },
  };
}
