import { expect, it } from "vitest";
import { structurePage, type TextLine } from "../../src/structure/index.js";
import { inferRuledTables } from "../../src/structure/ruled-tables.js";
import { inferSemanticBlocks } from "../../src/structure/semantic.js";
import type { ExtractedPage, TextSpan } from "../../src/types.js";

const span = (
  text: string,
  x: number,
  y: number,
  size = 10,
  fontFamily = "Times-Roman",
): TextSpan => ({
  text,
  fontSize: size,
  fontFamily,
  direction: "ltr",
  source: { page: 1 },
  bounds: { x, y, width: 180, height: size },
});
const line = (spans: TextSpan[], reasons: string[] = []): TextLine => ({
  type: "line",
  spans,
  text: spans.map((s) => s.text).join(" "),
  bounds: {
    x: Math.min(...spans.map((s) => s.bounds.x)),
    y: spans[0]?.bounds.y ?? 0,
    width:
      Math.max(...spans.map((s) => s.bounds.x + s.bounds.width)) -
      Math.min(...spans.map((s) => s.bounds.x)),
    height: spans[0]?.fontSize ?? 10,
  },
  confidence: 1,
  reasons,
});
it("retains the inferred table when prose-column layout evidence is insufficient", () => {
  const page: ExtractedPage = { number: 1, width: 600, height: 400, rotate: 0, spans: [] };
  for (let row = 0; row < 4; row++)
    page.spans.push(
      span(
        row === 3
          ? "The unfinished sentence keeps going here"
          : "This left column contains ordinary words. More",
        30,
        250 - row * 18,
        row % 2 ? 12 : 10,
      ),
      span(
        "the right column contains ordinary words. More",
        300,
        250 - row * 18,
        row % 2 ? 12 : 10,
      ),
    );
  expect(structurePage(page).tables).toHaveLength(1);
});
it("does not consume monospace code at a marked column seam", () => {
  const lines = [
    line([span("This prose begins a connected idea", 20, 130)]),
    line([span("and continues through this column", 20, 115)]),
    line([span("before its unfinished boundary", 20, 100)]),
    line(
      [span("const values = record.values;", 300, 200, 10, "Courier")],
      ["reading-column-start"],
    ),
    line([span("  emit(values);", 300, 185, 10, "Courier")]),
  ];
  const blocks = inferSemanticBlocks(lines, []);
  expect(blocks.map((block) => block.type)).toEqual(["paragraph", "preformatted"]);
  expect(blocks[1]).toMatchObject({ text: "const values = record.values;\n  emit(values);" });
});
it("keeps a slightly left-shifted later-column value in its column", () => {
  const header = [span("Left", 20, 180), span("Right", 150, 180)];
  header.forEach((s) => {
    s.bounds.width = 35;
  });
  const value = span("later column value", 149, 155);
  value.bounds.width = 90;
  const page: ExtractedPage = {
    number: 1,
    width: 300,
    height: 220,
    rotate: 0,
    spans: [...header, value],
    paths: [200, 175, 140].map((y) => ({ d: `M10 ${y}L290 ${y}`, stroke: "#000000" })),
  };
  const tables = inferRuledTables(page, [line(header), line([value])]);
  expect(tables[0]?.cells.find((cell) => cell.row === 1)).toMatchObject({
    column: 1,
    columnSpan: 1,
    text: "later column value",
  });
});
it("does not absorb an independent later-column value into a spanning band", () => {
  const header = [span("Left", 20, 180), span("Middle", 120, 180), span("Right", 220, 180)];
  header.forEach((s) => {
    s.bounds.width = 35;
  });
  const note = span("A note across two columns", 20, 155);
  note.bounds.width = 150;
  const value = span("42", 220, 155);
  value.bounds.width = 20;
  const page: ExtractedPage = {
    number: 1,
    width: 300,
    height: 220,
    rotate: 0,
    spans: [...header, note, value],
    paths: [200, 175, 140].map((y) => ({ d: `M10 ${y}L290 ${y}`, stroke: "#000000" })),
  };
  expect(
    inferRuledTables(page, [line(header), line([note, value])])[0]
      ?.cells.filter((cell) => cell.row === 1)
      .map((cell) => [cell.text, cell.columnSpan]),
  ).toEqual([
    [note.text, 1],
    ["42", 1],
  ]);
});
it("retains inline code in a prose continuation at a marked column seam", () => {
  const next = [
    span("the", 300, 200),
    span("values", 325, 200, 10, "Courier"),
    span("continue here.", 365, 200),
  ];
  const lines = [
    line([span("This prose begins a connected idea", 20, 130)]),
    line([span("and continues through this column", 20, 115)]),
    line([span("before its unfinished boundary", 20, 100)]),
    line(next, ["reading-column-start"]),
  ];
  const blocks = inferSemanticBlocks(lines, []);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({
    type: "paragraph",
    text: expect.stringContaining("boundary the values continue here."),
  });
});
it("preserves standalone dashes and normal short words in new wrapped joins", async () => {
  const { joinWrappedText } = await import("../../src/structure/text-join.js");
  expect(joinWrappedText("Option A -", "Option B")).toBe("Option A - Option B");
  expect(joinWrappedText("-", "item")).toBe("- item");
  expect(joinWrappedText("internationalization", "is.")).toBe("internationalization is.");
});
it("retains a prose table outside another accepted reading band", () => {
  const page: ExtractedPage = { number: 1, width: 650, height: 750, rotate: 0, spans: [] };
  for (let row = 0; row < 4; row++) {
    for (const x of [30, 230]) {
      const value = span(
        x === 30 && row === 3
          ? "The unfinished sentence keeps going here"
          : "the ordinary prose contains many words. More",
        x,
        650 - row * 18,
      );
      value.bounds.width = 150;
      page.spans.push(value);
    }
    for (let column = 0; column < 3; column++) {
      const value = span("separate column region", 30 + column * 200, 350 - row * 45 - column * 12);
      value.bounds.width = 120;
      page.spans.push(value);
    }
  }
  page.spans.sort((a, b) => b.bounds.y - a.bounds.y || a.bounds.x - b.bounds.x);
  const result = structurePage(page);
  expect(result.tables).toHaveLength(1);
  expect(result.tables[0]?.cells).toHaveLength(8);
  expect(result.lines.some((value) => value.reasons.includes("reading-column-start"))).toBe(true);
});
it.each([
  ["internationalization", "is.", "internationalization is."],
  ["govern-", "ment", "government"],
])("joins a column seam only with explicit word-break evidence: %s", (left, right, expected) => {
  const blocks = inferSemanticBlocks(
    [
      line([span("This prose begins a connected idea", 20, 130)]),
      line([span("and continues through this column", 20, 115)]),
      line([span(left, 20, 100)]),
      line([span(right, 300, 200)], ["reading-column-start"]),
    ],
    [],
  );
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({ type: "paragraph", text: expect.stringContaining(expected) });
});
