import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";
import { structurePage, tableToRows } from "../../src/structure/index.js";

interface Contract {
  id: string;
  file: string;
  pages: number[];
  expect: {
    readingOrder: string[][];
    elements: Record<string, { min?: number; max?: number }>;
    tables?: Array<{ headers: string[]; rowsAtLeast: number; rows: string[][] }>;
  };
}

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/semantic");
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  fixtures: Contract[];
};

describe("semantic flow fixture gate", () => {
  for (const fixture of manifest.fixtures) {
    it(`${fixture.id} preserves reading flow and table relationships`, async () => {
      const source = await fileSource(resolve(fixtureRoot, fixture.file));
      const pdf = await openPdf(source);
      try {
        const pages = [];
        for (const pageNumber of fixture.pages) {
          pages.push(structurePage(await pdf.getPage(pageNumber - 1)));
        }
        const text = normalize(
          pages
            .flatMap((page) => page.blocks)
            .flatMap((block) => {
              if (block.type === "table") return tableToRows(block.table).flat();
              if (block.type === "list") return block.items.map((item) => item.text);
              if (block.type === "definitionList") {
                return block.entries.flatMap((entry) => [entry.term, entry.description]);
              }
              if (block.type === "cardList") {
                return block.items.flatMap((item) => [item.title, ...item.details]);
              }
              if (block.type === "sectionGroup") {
                return block.items.flatMap((item) => [item.label, ...item.content]);
              }
              return [block.text];
            })
            .join(" "),
        );
        const assertions = fixture.expect.readingOrder.flat();
        let offset = 0;
        let matched = 0;
        for (const assertion of assertions) {
          const found = text.indexOf(normalize(assertion), offset);
          if (found < 0) continue;
          matched += 1;
          offset = found + normalize(assertion).length;
        }
        expect(matched).toBe(assertions.length);

        const tables = pages.flatMap((page) => page.tables);
        const tableConstraint = fixture.expect.elements.table;
        if (tableConstraint?.min !== undefined)
          expect(tables.length).toBeGreaterThanOrEqual(tableConstraint.min);
        if (tableConstraint?.max === 0) expect(tables).toHaveLength(0);

        const definitionLists = pages
          .flatMap((page) => page.blocks)
          .filter((block) => block.type === "definitionList");
        const definitionConstraint = fixture.expect.elements.dl;
        if (definitionConstraint?.min !== undefined) {
          expect(definitionLists.length).toBeGreaterThanOrEqual(definitionConstraint.min);
        }

        const rows = tables.flatMap(tableToRows);
        for (const expected of fixture.expect.tables ?? []) {
          if (expected.headers.length > 0) expect(rows).toContainEqual(expected.headers);
          expect(rows.length).toBeGreaterThanOrEqual(expected.rowsAtLeast);
          for (const row of expected.rows) expect(rows).toContainEqual(row);
        }
      } finally {
        pdf.close();
        await source.close();
      }
    });
  }

  it("groups the order confirmation into product cards, address sections, and totals", async () => {
    const fixture = manifest.fixtures.find((candidate) => candidate.id === "order-confirmation");
    if (!fixture) throw new Error("missing order-confirmation semantic fixture");
    const source = await fileSource(resolve(fixtureRoot, fixture.file));
    const pdf = await openPdf(source);
    try {
      const page = structurePage(await pdf.getPage(0));
      const cards = page.blocks.find((block) => block.type === "cardList");
      const sections = page.blocks.find((block) => block.type === "sectionGroup");
      const totals = page.blocks.find((block) => block.type === "definitionList");

      expect(cards?.items).toEqual([
        { title: "Field jacket", details: ["Olive · M", "× 1 $198.00"] },
        { title: "Linen trousers", details: ["Stone · 32", "× 2 $178.00"] },
        { title: "Wool socks (3-pack)", details: ["Charcoal heather", "× 1 $32.00"] },
      ]);
      expect(sections?.items).toEqual([
        {
          label: "SHIP TO",
          content: [
            "Sam Reyes",
            "482 Page Street, Apt 2B",
            "San Francisco, CA 94117",
            "United States",
          ],
        },
        {
          label: "BILLED TO",
          content: ["Sam Reyes", "Visa ending 4242", "Charged May 14, 2026"],
        },
      ]);
      expect(totals?.entries).toEqual([
        { term: "Subtotal", description: "$408.00" },
        { term: "Shipping", description: "$14.00" },
        { term: "Tax (8.75%)", description: "$35.70" },
        { term: "Total", description: "$457.70" },
      ]);
    } finally {
      pdf.close();
      await source.close();
    }
  });
});

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/\s*×\s*/g, "×")
    .trim()
    .toLocaleLowerCase("en");
}
