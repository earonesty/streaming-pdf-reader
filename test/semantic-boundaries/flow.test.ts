import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { describe, expect, it } from "vitest";
import { writeHtmlDocument, writeMarkdownDocument } from "../../packages/html-writer/src/index.js";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";

type Node = DefaultTreeAdapterMap["node"];
const root = new URL("../../fixtures/semantic/boundaries/", import.meta.url);
function tag(node: Node): string {
  return "tagName" in node ? node.tagName : "";
}
function text(node: Node): string {
  if (["head", "style", "script", "svg"].includes(tag(node))) return "";
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(text).join("") : "";
}
function nodes(node: Node, name: string): Node[] {
  return [
    ...(tag(node) === name ? [node] : []),
    ...("childNodes" in node ? node.childNodes.flatMap((child) => nodes(child, name)) : []),
  ];
}
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
async function output(name: string, format: "html" | "markdown", lookahead = 3) {
  const source = await fileSource(fileURLToPath(new URL(name, root)));
  const pdf = await openPdf(source);
  let value = "";
  try {
    const writer = format === "html" ? writeHtmlDocument : writeMarkdownDocument;
    await writer(
      pdf.pages(),
      (chunk) => {
        value += chunk;
      },
      { profile: "semantic", semanticLookaheadPages: lookahead },
    );
    return parse(format === "markdown" ? await marked.parse(value) : value);
  } finally {
    pdf.close();
    await source.close();
  }
}
function paragraphContaining(document: Node, phrase: string) {
  return nodes(document, "p").find((node) => normalize(text(node)).includes(phrase));
}
function requireParagraph(document: Node, phrase: string) {
  const paragraph = paragraphContaining(document, phrase);
  expect(paragraph, `Expected one paragraph containing: ${phrase}`).toBeDefined();
  if (!paragraph) return;
  for (
    let parent: Node | null = ("parentNode" in paragraph) ? paragraph.parentNode : null;
    parent;
    parent = "parentNode" in parent ? parent.parentNode : null
  )
    expect(["table", "td", "th"]).not.toContain(tag(parent));
}

describe.each(["html", "markdown"] as const)("bounded semantic flow: %s", (format) => {
  it.each(["column-plain.pdf", "column-asides.pdf", "column-code.pdf"])(
    "joins a sentence across columns in %s",
    async (name) => {
      const document = await output(name, format);
      requireParagraph(document, "captions can suggest better descriptions");
      expect(nodes(document, "table")).toHaveLength(0);
      if (name === "column-code.pdf") {
        expect(nodes(document, "pre").map((node) => text(node).replace(/\n$/, ""))).toEqual([
          "// load values from the record\nfor (const value of values) {\n  emit(value);\n}",
        ]);
        expect(normalize(text(document)).match(/load values from the record/g)).toHaveLength(1);
      }
      if (name === "column-asides.pdf") {
        expect(normalize(text(document))).toContain(
          "Additional source information belongs in a footnote.",
        );
        expect(normalize(text(document))).toContain("Figure 1. A separate example diagram.");
        const paragraph = paragraphContaining(document, "captions can suggest better descriptions");
        expect(text(paragraph as Node)).not.toContain("Additional source information");
        expect(text(paragraph as Node)).not.toContain("Figure 1.");
      }
    },
  );
  it.each([1, 3])(
    "joins page continuation with lookahead %i without merging a new paragraph",
    async (lookahead) => {
      const document = await output("page-furniture.pdf", format, lookahead);
      requireParagraph(document, "is based on the public archive");
      const continuation = paragraphContaining(document, "is based on the public archive");
      const next = paragraphContaining(document, "A genuinely new paragraph starts here.");
      expect(next).toBeDefined();
      expect(next).not.toBe(continuation);
    },
  );
  it("keeps a complete wrapped Notes value before the next section", async () => {
    const document = await output("wrapped-notes.pdf", format);
    // Either a description value or ordinary paragraph is acceptable, but the
    // sentence may not be split merely because its visual line wrapped.
    const value = [...nodes(document, "p"), ...nodes(document, "dd")].find((node) =>
      normalize(text(node)).includes(
        "Our records indicate that the permit is missing or has a delinquent balance. Please contact the service desk to resolve the balance before the next inspection.",
      ),
    );
    expect(value, "Notes sentence split at its wrapped line").toBeDefined();
    const body = normalize(text(document));
    expect(body.indexOf("Notes")).toBeLessThan(body.indexOf("Documents Issued"));
    expect(body.indexOf("to resolve the balance before the next inspection.")).toBeLessThan(
      body.indexOf("Documents Issued"),
    );
    expect(
      nodes(document, "tr").map((row) => nodes(row, "td").map((cell) => normalize(text(cell)))),
    ).toContainEqual(["12-33(d)", "Not in compliance"]);
  });
  it("preserves real paragraph breaks, table associations and source notes", async () => {
    const document = await output("separation-control.pdf", format);
    const first = paragraphContaining(
      document,
      "This first paragraph ends with a complete thought.",
    );
    const second = paragraphContaining(document, "A second paragraph begins after a visible gap.");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(
      nodes(document, "tr").map((row) => nodes(row, "td").map((cell) => normalize(text(cell)))),
    ).toContainEqual(["Widget", "42"]);
    expect(normalize(text(document))).toContain("Source note: keep this information available.");
  });
});

it("keeps every boundary fixture below 20 KB and at most two pages", async () => {
  for (const name of [
    "column-plain.pdf",
    "column-code.pdf",
    "spanning-rows.pdf",
    "column-asides.pdf",
    "page-furniture.pdf",
    "wrapped-notes.pdf",
    "separation-control.pdf",
  ]) {
    expect((await readFile(new URL(name, root))).length).toBeLessThan(20_000);
    const source = await fileSource(fileURLToPath(new URL(name, root)));
    const pdf = await openPdf(source);
    try {
      let count = 0;
      for await (const _page of pdf.pages()) count += 1;
      expect(count).toBeLessThanOrEqual(2);
    } finally {
      pdf.close();
      await source.close();
    }
  }
});
