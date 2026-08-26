import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ExtractedPage, openPdf, type TextSpan } from "../../src/index.js";
import { fileSource } from "../../src/node.js";
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

  it("recovers word spaces from embedded font metrics", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 612,
      height: 792,
      rotate: 0,
      spans: [
        span("All", 275.213, 635.232, 12.304, 9.35, "F1"),
        span("swimming", 292.126, 635.232, 40.428, 9.35, "F1"),
        span("pools", 338.897, 635.232, 21.093, 9.35, "F1"),
        span("and", 365.623, 635.232, 13.867, 9.35, "F1"),
        span("any", 383.998, 635.232, 13.476, 9.35, "F1"),
        span("ornamental", 402.372, 635.232, 43.553, 9.35, "F1"),
        span("pool", 452.484, 635.232, 17.187, 9.35, "F1"),
        span("with", 474.408, 635.232, 17.382, 9.35, "F1"),
        span("a", 496.541, 635.232, 4.297, 9.35, "F1"),
        span("depth", 504.684, 635.232, 21.288, 9.35, "F1"),
      ],
    };

    expect(structurePage(page).lines[0]?.text).toBe(
      "All swimming pools and any ornamental pool with a depth",
    );
  });

  it("preserves word fragments in the Atlantic Beach spacing regression", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../fixtures/atlantic-beach-page-150.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    try {
      const lines = structurePage(await pdf.getPage(0)).lines.map((line) => line.text);
      expect(lines).toContain("Agenda Item #5.A.");
      expect(lines).toContain("Page 150 of 300");
      expect(lines).toContain("Sec. 24-164 Swimming Pools (c) Fences:");
      expect(lines).toContain("All swimming pools and any ornamental pool with a depth");
    } finally {
      pdf.close();
      await source.close();
    }
  });

  it("keeps hyphen continuations and styled word fragments joined", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 300,
      height: 100,
      rotate: 0,
      spans: [
        span("24-", 10, 50, 14, 10, "F1"),
        span("164", 24.5, 50, 14, 10, "F1"),
        span("(", 43, 50, 4, 10, "F1"),
        span("c", 49, 50, 5, 10, "F1"),
        span(")", 55, 50, 4, 10, "F1"),
        span("hel", 70, 50, 14, 10, "Regular"),
        span("lo", 84, 50, 9, 10, "Bold"),
      ],
    };

    expect(structurePage(page).lines[0]?.text).toBe("24-164 (c) hello");
  });

  it("groups vertical spans into right-to-left columns and top-to-bottom text", () => {
    const vertical = (text: string, x: number, y: number): TextSpan => ({
      ...span(text, x, y, 10, 10, "F1"),
      bounds: { x, y, width: 10, height: 10 },
      direction: "ttb",
    });
    const page: ExtractedPage = {
      number: 1,
      width: 200,
      height: 200,
      rotate: 0,
      spans: [vertical("語", 100, 80), vertical("日", 120, 100), vertical("本", 120, 90)],
    };
    const structured = structurePage(page);
    expect(structured.lines.map((line) => line.text)).toEqual(["日本", "語"]);
    expect(structured.lines[0]?.reasons).toEqual(["shared-vertical-axis"]);
    expect(structured.tables).toEqual([]);
  });
});

function span(
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize = 12,
  fontName?: string,
): TextSpan {
  return {
    text,
    bounds: { x, y, width, height: 12 },
    direction: "ltr",
    fontName,
    fontSize,
    source: { page: 1 },
  };
}
