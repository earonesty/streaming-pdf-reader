import type { ExtractedPage } from "@boxpdf/reader";
import { describe, expect, it } from "vitest";
import { pageToHtml, writeHtmlDocument } from "../src/index.js";

const page: ExtractedPage = {
  number: 1,
  width: 612,
  height: 792,
  rotate: 0,
  spans: [
    {
      text: '<Hello & "world">',
      bounds: { x: 20, y: 700, width: 100, height: 12 },
      direction: "ltr",
      fontSize: 12,
      source: { page: 1, objectNumber: 4 },
    },
  ],
};

describe("HTML writer", () => {
  it("writes positioned, escaped page HTML", async () => {
    const html = await pageToHtml(page);
    expect(html).toContain('data-page="1"');
    expect(html).toContain("width:612pt;height:792pt");
    expect(html).toContain("&lt;Hello &amp; &quot;world&quot;&gt;");
    const rtl = await pageToHtml({
      ...page,
      width: Number.NaN,
      spans: [{ ...span("RTL", 20, 700), direction: "rtl" }],
    });
    expect(rtl).toContain('dir="rtl"');
    expect(rtl).toContain("width:0pt");
  });

  it("awaits output chunks and supports document metadata", async () => {
    const chunks: string[] = [];
    let writes = 0;
    await writeHtmlDocument(
      [page, { ...page, number: 2 }],
      async (chunk) => {
        await Promise.resolve();
        chunks.push(chunk);
        writes += 1;
      },
      { title: "A < B", language: 'en" test' },
    );
    const html = chunks.join("");
    expect(writes).toBeGreaterThan(10);
    expect(html).toContain("<title>A &lt; B</title>");
    expect(html).toContain('lang="en&quot; test"');
    expect(html.match(/class="pdf-page /g)).toHaveLength(2);
    expect(html.endsWith("</body></html>")).toBe(true);
  });

  it("writes flow HTML without a document wrapper", async () => {
    const chunks: string[] = [];
    await writeHtmlDocument(
      [page],
      (chunk) => {
        chunks.push(chunk);
      },
      {
        layout: "flow",
        includeDocument: false,
      },
    );
    const html = chunks.join("");
    expect(html.startsWith('<main class="pdf-document">')).toBe(true);
    expect(html).toContain("<p>&lt;Hello &amp; &quot;world&quot;&gt;</p>");
    expect(html).not.toContain("<!doctype html>");
  });

  it("writes inferred tables once and permits style-free documents", async () => {
    const tablePage: ExtractedPage = {
      ...page,
      spans: [span("A", 20, 700), span("B", 120, 700), span("C", 20, 680), span("D", 120, 680)],
    };
    const chunks: string[] = [];
    await writeHtmlDocument(
      [tablePage],
      (chunk) => {
        chunks.push(chunk);
      },
      { layout: "flow", includeStyles: false },
    );
    const html = chunks.join("");
    expect(html).toContain("<table><tr><td>A</td><td>B</td></tr>");
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).not.toContain("<p>");
    expect(html).not.toContain("<style>");
  });
});

function span(text: string, x: number, y: number): ExtractedPage["spans"][number] {
  return {
    text,
    bounds: { x, y, width: 10, height: 12 },
    direction: "ltr",
    fontSize: 12,
    source: { page: 1 },
  };
}
