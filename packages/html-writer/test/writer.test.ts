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
  it("uses original chunks for visual HTML and reordered spans for semantic HTML", async () => {
    const split: ExtractedPage = {
      ...page,
      spans: [span("semantic", 20, 700)],
      visualSpans: [span("visual", 40, 680)],
    };

    const visual = await pageToHtml(split, { profile: "visual" });
    expect(visual).toContain(">visual</text>");
    expect(visual).not.toContain(">semantic</text>");

    const semantic = await pageToHtml(split, { profile: "semantic" });
    expect(semantic).toContain("semantic");
    expect(semantic).not.toContain("visual");
  });

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
    expect(rtl).toContain('x="30" y="92"');
    expect(rtl).toContain("width:0pt");
    const controls = await pageToHtml({
      ...page,
      spans: [{ ...span("A\0B\u0007C\tD\nE\rF", 20, 700) }],
    });
    expect(controls).toContain("A�B�C\tD\nE\nF");
    expect(controls).not.toContain("\0");
  });

  it("preserves natural glyph ink for Hebrew spans stored in PDF paint order", async () => {
    const html = await pageToHtml({
      ...page,
      spans: [span("םולש", 20, 700)],
    });

    expect(html).toContain("unicode-bidi:bidi-override;direction:ltr");
    expect(html).not.toContain("textLength");
  });

  it("uses rotated display dimensions for quarter-turn pages", async () => {
    const html = await pageToHtml({ ...page, rotate: 90 });
    expect(html).toContain("width:792pt;height:612pt");
    expect(html).toContain("pdf-page-content--90");
    expect(html).toContain("transform:translate(792pt,0) rotate(90deg)");
    const counterclockwise = await pageToHtml({ ...page, rotate: 270 });
    expect(counterclockwise).toContain("transform:translate(0,612pt) rotate(270deg)");
  });

  it("applies extracted text orientation as an SVG matrix", async () => {
    const html = await pageToHtml({
      ...page,
      spans: [{ ...span("Turn", 20, 700), transform: [0, -1, 1, 0] }],
    });
    expect(html).toContain('transform="matrix(0 -1 1 0 20 92)"');
  });

  it("paints transformed vector fills beneath visual text", async () => {
    const html = await pageToHtml({
      ...page,
      fills: [
        {
          points: [
            [10, 20],
            [40, 20],
            [40, 60],
            [10, 60],
          ],
          color: "#00ff00",
        },
      ],
    });
    expect(html).toContain('<polygon points="10,772 40,772 40,732 10,732" fill="#00ff00"/>');
    expect(html.indexOf("<polygon")).toBeLessThan(html.indexOf("<text"));
  });

  it("embeds transformed RGB images beneath visual text", async () => {
    const html = await pageToHtml({
      ...page,
      images: [
        {
          width: 1,
          height: 1,
          format: "rgb",
          data: Uint8Array.of(255, 0, 0),
          transform: [30, 0, 0, 40, 10, 20],
        },
      ],
    });

    expect(html).toContain('transform="matrix(30 0 0 40 10 732)"');
    expect(html).toContain('href="data:image/bmp;base64,');
    expect(html.indexOf("<image")).toBeLessThan(html.indexOf("<text"));
  });

  it("paints validated vector paths with fill and stroke", async () => {
    const html = await pageToHtml({
      ...page,
      paths: [
        {
          d: "M10 20L30 40Z",
          fill: "#112233",
          stroke: "#445566",
          strokeWidth: 2,
          fillOpacity: 0.25,
          strokeOpacity: 0.5,
        },
        { d: '" onload="alert(1)', fill: "#000000" },
      ],
    });
    expect(html).toContain(
      '<path d="M10 20L30 40Z" fill="#112233" stroke="#445566" stroke-width="2" fill-opacity="0.25" stroke-opacity="0.5"/>',
    );
    expect(html).not.toContain("onload");
  });

  it("maps resolved PDF font evidence to safe visual CSS", async () => {
    const html = await pageToHtml({
      ...page,
      spans: [{ ...span("Bold", 20, 700), fontFamily: "ABCDEF+Times-BoldItalic" }],
    });
    expect(html).toContain("font-family:Times New Roman,Times,serif");
    expect(html).toContain("font-weight:700");
    expect(html).toContain("font-style:italic");
    const opaque = await pageToHtml({
      ...page,
      spans: [{ ...span("Subset", 20, 700), fontFamily: "MSTT31c64e" }],
    });
    expect(opaque).toContain("font-family:Arial,Helvetica,sans-serif");
  });

  it("emits extracted text color and rejects unsafe color values", async () => {
    const colored = await pageToHtml({
      ...page,
      spans: [{ ...span("Red", 20, 700), color: "#ff0000" }],
    });
    expect(colored).toContain("fill:#ff0000");
    const unsafe = await pageToHtml({
      ...page,
      spans: [{ ...span("No", 20, 700), color: 'red" onmouseover="alert(1)' }],
    });
    expect(unsafe).not.toContain("onmouseover");
  });

  it("preserves PDF fill and stroke text rendering modes", async () => {
    const stroked = await pageToHtml({
      ...page,
      spans: [
        {
          ...span("Outline", 20, 700),
          color: "#112233",
          strokeColor: "#ff0000",
          strokeWidth: 1.5,
          renderingMode: 1,
        },
      ],
    });
    expect(stroked).toContain("fill:none;stroke:#ff0000;stroke-width:1.5");

    const both = await pageToHtml({
      ...page,
      spans: [
        {
          ...span("Both", 20, 700),
          color: "#112233",
          strokeColor: "#445566",
          strokeWidth: 2,
          renderingMode: 2,
        },
      ],
    });
    expect(both).toContain("fill:#112233;stroke:#445566;stroke-width:2");

    const invisible = await pageToHtml({
      ...page,
      spans: [{ ...span("Hidden", 20, 700), renderingMode: 3 }],
    });
    expect(invisible).not.toContain("Hidden");
  });

  it("inlines page-scoped embedded fonts for visual spans", async () => {
    const html = await pageToHtml({
      ...page,
      fonts: [
        { id: "font-1", family: "ArialMT", format: "truetype", data: Uint8Array.of(0, 1, 2) },
      ],
      spans: [{ ...span("Font", 20, 700), fontFamily: "ArialMT", fontAssetId: "font-1" }],
    });
    expect(html).toContain("@font-face{font-family:boxpdf-1-font-1");
    expect(html).toContain("base64,AAEC");
    expect(html).toContain("font-family:boxpdf-1-font-1,Arial,Helvetica,sans-serif");
    expect(
      await pageToHtml(
        { ...page, fonts: [{ id: "font-1", format: "truetype", data: Uint8Array.of(0) }] },
        { includeStyles: false },
      ),
    ).not.toContain("@font-face");
  });

  it("renders page-scoped Type3 vector glyph programs as SVG", async () => {
    const html = await pageToHtml({
      ...page,
      fonts: [
        {
          id: "type3-1",
          format: "type3",
          glyphs: [
            {
              code: 97,
              advance: 1,
              fills: [
                {
                  points: [
                    [0, 0],
                    [0.75, 0],
                    [0.75, 0.75],
                    [0, 0.75],
                  ],
                  color: "#000000",
                },
              ],
            },
            {
              code: 98,
              advance: 1,
              paths: [{ d: "M0 0L0.375 0.75L0.75 0Z", fill: "#000000" }],
            },
          ],
        },
      ],
      spans: [
        {
          ...span("ab", 20, 700),
          bounds: { x: 20, y: 700, width: 24, height: 12 },
          fontSize: 12,
          fontAssetId: "type3-1",
          glyphCodes: [97, 98],
        },
      ],
    });
    expect(html).toContain('<g transform="matrix(1 0 0 1 20 92)">');
    expect(html).toContain('transform="scale(12 -12)"');
    expect(html).toContain('<polygon points="0,0 0.75,0 0.75,0.75 0,0.75" fill="#000000"/>');
    expect(html).toContain('<g transform="translate(1 0)"><path d="M0 0L0.375 0.75L0.75 0Z"');
    expect(html).not.toContain(">ab</text>");

    const hidden = await pageToHtml({
      ...page,
      fonts: [{ id: "type3-1", format: "type3", glyphs: [] }],
      spans: [
        {
          ...span("hidden", 20, 700),
          fontAssetId: "type3-1",
          glyphCodes: [97],
          renderingMode: 3,
        },
      ],
    });
    expect(hidden).not.toContain("hidden");
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
    expect(positioned).toContain('<text dir="rtl"');
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
