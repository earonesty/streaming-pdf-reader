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
      "<table><tr><th>Item</th><th>Price</th></tr><tr><td>Socks</td><td>$28</td></tr><tr><td>Hat</td><td>$12, sale</td></tr></table>",
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

  it("restores narrow proportional-font word gaps", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 300,
      height: 100,
      rotate: 0,
      spans: [
        span("compiled", 20, 50, 33.373, 8.966, "NimbusRomNo9L-Regu"),
        span("twice,", 55.139, 50, 21.663, 8.966, "NimbusRomNo9L-Regu"),
        span("and", 78.577, 50, 12.947, 8.966, "NimbusRomNo9L-Regu"),
        span("both", 93.3, 50, 15.942, 8.966, "NimbusRomNo9L-Regu"),
      ],
    };

    expect(structurePage(page).lines[0]?.text).toBe("compiled twice, and both");
  });

  it("uses repeated alignments to recover narrow table columns and wrapped cells", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 300,
      height: 200,
      rotate: 0,
      spans: [
        span("Tag", 20, 150, 15, 9),
        span("JS Type", 45, 150, 32, 9),
        span("Description", 98, 150, 45, 9),
        span("000", 20, 138, 15, 9),
        span("object", 45, 138, 25, 9),
        span("pointer to handle", 98, 138, 70, 9),
        span("010", 20, 126, 15, 9),
        span("number", 45, 126, 28, 9),
        span("pointer to double", 98, 126, 72, 9),
        span("110", 20, 114, 15, 9),
        span("boolean", 45, 114, 30, 9),
        span("enumeration", 98, 114, 48, 9),
        span("null or undefined", 45, 102, 65, 9),
      ],
    };

    expect(tableToRows(structurePage(page).tables[0] as never)).toEqual([
      ["Tag", "JS Type", "Description"],
      ["000", "object", "pointer to handle"],
      ["010", "number", "pointer to double"],
      ["110", "boolean null or undefined", "enumeration"],
    ]);
  });

  it("restores spaces between single-letter font fragments when geometry shows a word gap", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 100,
      height: 100,
      rotate: 0,
      spans: [span("a", 10, 50, 4, 9), span("k", 16, 50, 4, 9), span("ey", 20, 50, 8, 9)],
    };
    expect(structurePage(page).lines[0]?.text).toBe("a key");
  });

  it("keeps superscripts attached to their visual text line", () => {
    const page: ExtractedPage = {
      number: 1,
      width: 300,
      height: 100,
      rotate: 0,
      spans: [
        span("Andreas Gal", 20, 50, 55, 11, "Regular"),
        { ...span("*", 75, 54, 4, 8, "Symbol"), bounds: { x: 75, y: 54, width: 4, height: 8 } },
        span(", Brendan Eich", 80, 50, 66, 11, "Regular"),
        {
          ...span("*", 146, 54, 4, 8, "Symbol"),
          bounds: { x: 146, y: 54, width: 4, height: 8 },
        },
      ],
    };

    expect(structurePage(page).lines.map((line) => line.text)).toEqual([
      "Andreas Gal*, Brendan Eich*",
    ]);
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
