import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeHtmlDocument } from "../../packages/html-writer/src/index.js";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/semantic");

describe("semantic media associations", () => {
  it("associates exact TraceMonkey diagrams with their observed captions", async () => {
    const html = await semanticHtml("research-paper.pdf");
    for (const label of [
      "Figure 2.",
      "Figure 5.",
      "Figure 6.",
      "Figure 7.",
      "Figure 10.",
      "Figure 11.",
      "Figure 12.",
    ]) {
      expect(figureWithCaption(html, label)).toMatch(/<svg\b/);
    }
  });

  it("associates SciCap diagrams rather than satisfying the gate with captioned tables", async () => {
    const html = await semanticHtml("scicap-paper.pdf");
    expect(figureWithCaption(html, "Figure 1:")).toMatch(/<img\b/);
    expect(figureWithCaption(html, "Figure 2:")).toMatch(/<img\b/);
  });

  it("associates brochure images while leaving nearby body prose as prose", async () => {
    const html = await semanticHtml("aquarius-brochure.pdf");
    expect(figureWithCaption(html, "From 1872 to 1876, the H.M.S. Challenger")).toMatch(/<img\b/);
    expect(figureWithCaption(html, "Average salinity from historical ship and buoy data")).toMatch(
      /<img\b/,
    );
    expect(figcaptions(html)).not.toContainEqual(expect.stringContaining("A trip to the beach"));
    expect(figcaptions(html)).not.toContainEqual(
      expect.stringContaining("Aquarius/SAC-D will begin its three-year baseline mission"),
    );
    expect(figcaptions(html)).not.toContainEqual(
      expect.stringContaining("With Earth’s changing climate"),
    );
  });
});

async function semanticHtml(file: string): Promise<string> {
  const source = await fileSource(resolve(fixtureRoot, file));
  const pdf = await openPdf(source);
  let html = "";
  try {
    await writeHtmlDocument(
      pdf.pages(),
      (chunk) => {
        html += chunk;
      },
      { profile: "semantic", includeDocument: false, imageOptions: "embedded" },
    );
  } finally {
    pdf.close();
    await source.close();
  }
  return html;
}

function figureWithCaption(html: string, caption: string): string {
  const figure = figureBlocks(html).find((item) => text(item).includes(caption));
  expect(figure, `missing media association for ${caption}`).toBeDefined();
  return figure ?? "";
}

function figcaptions(html: string): string[] {
  return [...html.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((match) =>
    text(match[1] ?? ""),
  );
}

function figureBlocks(html: string): string[] {
  return [...html.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>/g)].map((match) => match[0]);
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
