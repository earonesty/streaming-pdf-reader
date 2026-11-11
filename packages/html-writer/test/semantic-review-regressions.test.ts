import { fileURLToPath } from "node:url";
import type { ExtractedPage, TextSpan } from "@boxpdf/reader";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";
import type { Table, TextLine } from "@boxpdf/reader/structure";
import { marked } from "marked";
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { expect, it } from "vitest";
import { writeHtmlDocument, writeMarkdownDocument, writePage } from "../src/index.js";
import { semanticTextMarkdown } from "../src/semantic-inline.js";
import { panelTableHtml } from "../src/semantic-table.js";

function span(text: string, x: number, y: number, extra: Partial<TextSpan> = {}): TextSpan {
  return {
    text,
    bounds: { x, y, width: text.length * 5, height: 10 },
    fontSize: 10,
    direction: "ltr",
    source: { page: 1 },
    ...extra,
  };
}
it("preserves entity-like and backslash sequences in Markdown link destinations", () => {
  const href = "https://example.com/?x=&copy;&y=\\*";
  const s = span("go", 20, 200, { href });
  const line: TextLine = {
    type: "line",
    text: s.text,
    spans: [s],
    bounds: s.bounds,
    confidence: 1,
    reasons: [],
  };
  const html = marked.parse(semanticTextMarkdown("go", [line], "#000000")) as string;
  const root = parse(html);
  type Node = DefaultTreeAdapterMap["node"];
  const walk = (node: Node): Node[] => [
    node,
    ...("childNodes" in node ? node.childNodes : []).flatMap(walk),
  ];
  const link = walk(root).find((node) => "tagName" in node && node.tagName === "a");
  expect(
    link && "attrs" in link ? link.attrs.find((attr) => attr.name === "href")?.value : undefined,
  ).toBe(href.replaceAll("\\", "%5C"));
});
it("keeps regular-weight inferred headers when a table has a caption", () => {
  const cells = ["Item", "Qty", "Widget", "2"].map((text, index) => {
    const s = span(text, (index % 2) * 100, 200 - Math.floor(index / 2) * 20);
    return {
      row: Math.floor(index / 2),
      column: index % 2,
      rowSpan: 1,
      columnSpan: 1,
      bounds: s.bounds,
      text,
      spans: [s],
      confidence: 1,
      reasons: [],
    };
  });
  const title = span("Inventory", 0, 230, { fontFamily: "Helvetica-Bold" });
  const table: Table = {
    type: "table",
    page: 1,
    bounds: { x: 0, y: 180, width: 120, height: 30 },
    columns: [0, 100],
    cells,
    confidence: 1,
    reasons: [],
    caption: [
      {
        type: "line",
        text: title.text,
        spans: [title],
        bounds: title.bounds,
        confidence: 1,
        reasons: [],
      },
    ],
  };
  expect(panelTableHtml(table, "#000000")).toContain(
    '<thead><tr><th scope="col">Item</th><th scope="col">Qty</th></tr></thead>',
  );
});
it("preserves URI links in native Markdown table headers", async () => {
  const page: ExtractedPage = {
    number: 1,
    width: 300,
    height: 300,
    rotate: 0,
    spans: [
      span("Item", 20, 200, { fontFamily: "Helvetica-Bold", href: "https://example.com" }),
      span("State", 180, 200, { fontFamily: "Helvetica-Bold" }),
      span("First", 20, 180),
      span("Ready", 180, 180),
      span("Second", 20, 160),
      span("Waiting", 180, 160),
    ],
  };
  let output = "";
  await writeMarkdownDocument([page], (chunk) => {
    output += chunk;
  });
  expect(output).toContain("[Item](<https://example.com>)");
});
it.each(["html", "markdown"] as const)(
  "keeps a captioned table open for continuation in %s",
  async (format) => {
    const first: ExtractedPage = {
      number: 1,
      width: 300,
      height: 300,
      rotate: 0,
      spans: [
        span("Inventory", 20, 230, { fontFamily: "Helvetica-Bold" }),
        span("Item", 20, 210),
        span("Qty", 180, 210),
        span("Widget", 20, 190),
        span("2", 180, 190),
      ],
      paths: [{ d: "M15 180L210 180L210 245L15 245Z", stroke: "#000000" }],
    };
    const second: ExtractedPage = {
      number: 2,
      width: 300,
      height: 300,
      rotate: 0,
      spans: [
        span("Gadget", 20, 210),
        span("3", 180, 210),
        span("Spare", 20, 190),
        span("4", 180, 190),
      ],
    };
    let output = "";
    await (format === "html" ? writeHtmlDocument : writeMarkdownDocument)(
      [first, second],
      (chunk) => {
        output += chunk;
      },
      { profile: "semantic" },
    );
    expect(output.match(/<table>/g)).toHaveLength(1);
    expect(output).toContain("<caption>Inventory</caption>");
    expect(output).toContain("Gadget");
    expect(output).toContain("Spare");
  },
);
it("keeps financial summaries as HTML inside a raw Markdown table", async () => {
  const first: ExtractedPage = {
    number: 1,
    width: 300,
    height: 300,
    rotate: 0,
    spans: [
      span("Inventory", 20, 230, { fontFamily: "Helvetica-Bold" }),
      span("Item", 20, 210),
      span("Qty", 180, 210),
      span("Widget", 20, 190),
      span("2", 180, 190),
    ],
    paths: [{ d: "M15 180L210 180L210 245L15 245Z", stroke: "#000000" }],
  };
  const totals: ExtractedPage = {
    number: 2,
    width: 300,
    height: 300,
    rotate: 0,
    spans: [
      span("Subtotal", 20, 210, { fontFamily: "Helvetica-Bold" }),
      span("$20", 180, 210),
      span("Tax", 20, 190),
      span("$2", 180, 190),
    ],
  };
  let output = "";
  await writeMarkdownDocument([first, totals], (chunk) => {
    output += chunk;
  });
  expect(output).toContain(
    '<tfoot><tr><th scope="row">Subtotal</th><td>$20</td></tr><tr><th scope="row">Tax</th><td>$2</td></tr></tfoot>',
  );
  expect(output).not.toContain("| Subtotal |");
  expect(output.match(/<table>/g)).toHaveLength(1);
});

it("preserves the rich-content table through the single-page semantic API", async () => {
  const source = await fileSource(
    fileURLToPath(new URL("../../../fixtures/semantic/rich-content.pdf", import.meta.url)),
  );
  const reader = await openPdf(source);
  try {
    const page = await reader.getPage(0);
    let single = "";
    let document = "";
    await writePage(
      page,
      (chunk) => {
        single += chunk;
      },
      { profile: "semantic" },
    );
    await writeHtmlDocument(
      [page],
      (chunk) => {
        document += chunk;
      },
      { profile: "semantic" },
    );
    const table = single.match(/<table>[\s\S]*?<\/table>/)?.[0];
    expect(table).toContain("<caption>Plan comparison</caption>");
    expect(table).toContain('<tfoot><tr><td colspan="3">');
    expect(table).toContain(
      '<strong><a href="https://example.com"><span style="color:#0f62fe">link</span></a></strong>',
    );
    expect(table).toBe(document.match(/<table>[\s\S]*?<\/table>/)?.[0]);
  } finally {
    reader.close();
    await source.close();
  }
});
