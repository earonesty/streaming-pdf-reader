import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { expect, it } from "vitest";
import { writeHtmlDocument, writeMarkdownDocument } from "../../packages/html-writer/src/index.js";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => ("childNodes" in node ? node.childNodes : []);
const tag = (node: Node) => ("tagName" in node ? node.tagName : "");
const text = (node: Node): string =>
  "value" in node ? node.value : children(node).map(text).join("");
const all = (node: Node): Node[] => [node, ...children(node).flatMap(all)];
it.each(["html", "markdown"] as const)(
  "preserves the trailing DeKalb column in %s output",
  async (format) => {
    const source = await fileSource(
      fileURLToPath(new URL("./dekalb-oracle-tax-page.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let output = "";
    try {
      await (format === "html" ? writeHtmlDocument : writeMarkdownDocument)(
        pdf.pages(),
        (chunk) => {
          output += chunk;
        },
        { profile: "semantic" },
      );
      const root = parse(format === "markdown" ? await marked.parse(output) : output);
      const rows = all(root)
        .filter((node) => tag(node) === "tr")
        .map((row) =>
          children(row)
            .filter((node) => ["td", "th"].includes(tag(node)))
            .map((node) => text(node).trim()),
        );
      expect(rows).toContainEqual([
        "HASAN NAJAM",
        "2018",
        "2123-0037",
        "F",
        "7.62",
        "5.07",
        "0.38",
        "0.00",
        "0.00",
        "13.07",
        "10/01/2018",
        "DO",
      ]);
    } finally {
      pdf.close();
      await source.close();
    }
  },
);
