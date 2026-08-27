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
  it("writes visual, escaped page HTML by default", async () => {
    const html = await pageToHtml(page);
    expect(html).toContain("pdf-page--visual");
    expect(html).toContain('data-page="1"');
    expect(html).toContain('data-rotate="0"');
    expect(html).toContain("width:612pt;height:792pt");
    expect(html).toContain("&lt;Hello &amp; &quot;world&quot;&gt;");
    const rtl = await pageToHtml({
      ...page,
      width: Number.NaN,
      spans: [{ ...span("RTL", 20, 700), direction: "rtl" }],
    });
    expect(rtl).toContain('dir="rtl"');
    expect(rtl).toContain("width:0pt");
    const controls = await pageToHtml({
      ...page,
      spans: [{ ...span("A\0B\u0007C\tD\nE\rF", 20, 700) }],
    });
    expect(controls).toContain("A�B�C\tD\nE\nF");
    expect(controls).not.toContain("\0");
  });

  it("uses rotated display dimensions for quarter-turn pages", async () => {
    const html = await pageToHtml({ ...page, rotate: 90 });
    expect(html).toContain("width:792pt;height:612pt");
    expect(html).toContain("pdf-page-content--90");
  });

  it("maps resolved PDF font evidence to safe visual CSS", async () => {
    const html = await pageToHtml({
      ...page,
      spans: [{ ...span("Bold", 20, 700), fontFamily: "ABCDEF+Times-BoldItalic" }],
    });
    expect(html).toContain("font-family:Times New Roman,Times,serif");
    expect(html).toContain("font-weight:700");
    expect(html).toContain("font-style:italic");
  });

  it("emits extracted text color and rejects unsafe color values", async () => {
    const colored = await pageToHtml({
      ...page,
      spans: [{ ...span("Red", 20, 700), color: "#ff0000" }],
    });
    expect(colored).toContain("color:#ff0000");
    const unsafe = await pageToHtml({
      ...page,
      spans: [{ ...span("No", 20, 700), color: 'red" onmouseover="alert(1)' }],
    });
    expect(unsafe).not.toContain("onmouseover");
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

  it("does not produce the next chunk until the output accepts the current one", async () => {
    let release: (() => void) | undefined;
    const writes: string[] = [];
    const pending = writeHtmlDocument([page], async (chunk) => {
      writes.push(chunk);
      if (writes.length === 1) await new Promise<void>((resolve) => (release = resolve));
    });
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    release?.();
    await pending;
    expect(writes.length).toBeGreaterThan(1);
  });

  it("writes semantic HTML without a document wrapper", async () => {
    const chunks: string[] = [];
    await writeHtmlDocument(
      [page],
      (chunk) => {
        chunks.push(chunk);
      },
      {
        profile: "semantic",
        includeDocument: false,
      },
    );
    const html = chunks.join("");
    expect(html.startsWith('<main class="pdf-document">')).toBe(true);
    expect(html).toContain("pdf-page--semantic");
    expect(html).toContain("<p>&lt;Hello &amp; &quot;world&quot;&gt;</p>");
    expect(html).not.toContain("<!doctype html>");
  });

  it("supports legacy layout aliases and rejects conflicting output intents", async () => {
    expect(await pageToHtml(page, { layout: "positioned" })).toContain("pdf-page--visual");
    expect(await pageToHtml(page, { layout: "flow" })).toContain("pdf-page--semantic");
    await expect(pageToHtml(page, { profile: "visual", layout: "flow" })).rejects.toThrow(
      'profile "visual" does not match layout "flow"',
    );
  });

  it("preserves logical RTL text and marks positioned and flow direction", async () => {
    const rtlPage = {
      ...page,
      spans: [{ ...span("שלום עולם", 20, 700), direction: "rtl" as const }],
    };
    const positioned = await pageToHtml(rtlPage);
    const flow = await pageToHtml(rtlPage, { profile: "semantic" });
    expect(positioned).toContain('<span class="pdf-span" dir="rtl"');
    expect(positioned).toContain("שלום עולם");
    expect(flow).toContain('<p dir="rtl">שלום עולם</p>');
  });

  it("marks vertical text without mislabeling it as RTL", async () => {
    const vertical = await pageToHtml({
      ...page,
      spans: [{ ...span("vertical", 20, 700), direction: "ttb" }],
    });
    expect(vertical).toContain('data-direction="ttb"');
    expect(vertical).not.toContain('dir="rtl"');
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
      { profile: "semantic", includeStyles: false },
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
