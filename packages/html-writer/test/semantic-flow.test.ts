import type { ExtractedPage } from "@boxpdf/reader";
import { expect, it } from "vitest";
import { type SemanticDocumentStats, writeHtmlDocument } from "../src/index.js";

function page(number: number): ExtractedPage {
  return {
    number,
    width: 300,
    height: 300,
    rotate: 0,
    spans: Array.from({ length: 12 }, (_, i) => ({
      text: i === 0 ? `continued page ${number}` : "ordinary connected prose",
      fontSize: 10,
      fontFamily: "Times-Roman",
      direction: "ltr" as const,
      source: { page: number },
      bounds: { x: 20, y: 240 - i * 18, width: 180, height: 10 },
    })),
  };
}
it("streams long cross-page paragraphs while retaining only bounded page state", async () => {
  let output = "";
  let stats: SemanticDocumentStats | undefined;
  async function* pages() {
    for (let number = 1; number <= 50; number++) {
      if (number === 3) expect(output).toContain("continued page 1");
      yield page(number);
    }
  }
  await writeHtmlDocument(
    pages(),
    (chunk) => {
      output += chunk;
    },
    {
      profile: "semantic",
      semanticLookaheadPages: 1,
      onSemanticStats: (value) => {
        stats = { ...value };
      },
    },
  );
  expect(output.match(/<p>/g)).toHaveLength(1);
  expect(output.match(/<\/p>/g)).toHaveLength(1);
  expect(output).toContain("continued page 50");
  expect(stats?.peakBufferedPages).toBe(1);
  expect(stats?.peakBufferedLines).toBe(12);
});
it.each(["New paragraph starts here.", "• a new list item"])(
  "does not join a new block across pages: %s",
  async (text) => {
    let output = "";
    const second = page(2);
    if (second.spans[0]) second.spans[0].text = text;
    await writeHtmlDocument(
      [page(1), second],
      (chunk) => {
        output += chunk;
      },
      { profile: "semantic", semanticLookaheadPages: 1 },
    );
    expect(output).not.toMatch(
      new RegExp(`ordinary connected prose ${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    expect(output).toContain(text.startsWith("•") ? "<ul>" : "<p>New paragraph starts here.");
  },
);
