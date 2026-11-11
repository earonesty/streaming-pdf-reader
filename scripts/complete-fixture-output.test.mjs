import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parse } from "parse5";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { writeHtmlDocument, writeMarkdownDocument } from "../packages/html-writer/dist/index.js";
import { completeTree } from "./complete-fixtures.mjs";

const root = new URL("../fixtures/semantic/expected/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
for (const fixture of manifest.fixtures)
  for (const format of ["html", "markdown"]) {
    test(`${fixture.id}: complete ${format}`, async () => {
      const source = await fileSource(fileURLToPath(new URL(fixture.pdf, root)));
      let pdf;
      let actual = "";
      try {
        pdf = await openPdf(source);
        await (format === "html" ? writeHtmlDocument : writeMarkdownDocument)(
          pdf.pages(),
          (chunk) => {
            actual += chunk;
          },
          { profile: "semantic" },
        );
        const expected = await readFile(new URL(fixture[format], root), "utf8");
        const errors = [];
        parse(format === "markdown" ? marked.parse(expected) : expected, {
          onParseError: (error) => errors.push(error.code),
        });
        assert.deepEqual(
          errors.filter((error) => error !== "missing-doctype"),
          [],
          "Expected fixture must be valid HTML",
        );
        assert.deepEqual(completeTree(actual, format), completeTree(expected, format));
      } finally {
        pdf?.close();
        await source.close();
      }
    });
  }
