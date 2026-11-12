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
it.each([
  ["govern-", "ment", "government"],
  ["ISO-9001-", "certified", "ISO-9001-certified"],
])("joins a page-break hyphen without inserting a space: %s", async (left, right, expected) => {
  const first = page(1),
    second = page(2);
  const last = first.spans.at(-1),
    head = second.spans[0];
  if (!last || !head) throw new Error("missing spans");
  last.text = left;
  head.text = right;
  let html = "";
  await writeHtmlDocument(
    [first, second],
    (chunk) => {
      html += chunk;
    },
    { profile: "semantic", semanticLookaheadPages: 1 },
  );
  expect(html).toContain(expected);
  expect(html).not.toContain("govern- ment");
});
it("retains standalone dashes at a page seam", async () => {
  const { pageContinuationTail } = await import("../src/semantic-flow.js");
  expect(pageContinuationTail("Option A -")).toEqual({ text: "Option A -", separator: " " });
});
it.each(["html", "markdown"] as const)(
  "preserves the last linked bold span while dehyphenating %s",
  async (format) => {
    const first = page(1),
      second = page(2),
      last = first.spans.at(-1),
      head = second.spans[0];
    if (!last || !head) throw new Error("missing spans");
    last.text = "govern-";
    last.fontFamily = "Times-Bold";
    last.href = "https://example.com";
    head.text = "ment";
    head.fontFamily = "Times-Bold";
    let output = "";
    const { writeMarkdownDocument } = await import("../src/index.js");
    await (format === "html" ? writeHtmlDocument : writeMarkdownDocument)(
      [first, second],
      (chunk) => {
        output += chunk;
      },
      { profile: "semantic", semanticLookaheadPages: 1 },
    );
    expect(output).toContain(
      format === "html"
        ? '<strong><a href="https://example.com">govern</a></strong>'
        : "**[govern](<https://example.com>)**",
    );
    expect(output).not.toContain("govern-");
  },
);
