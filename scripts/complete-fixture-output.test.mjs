import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
      const pdf = await openPdf(source);
      let actual = "";
      try {
        await (format === "html" ? writeHtmlDocument : writeMarkdownDocument)(
          pdf.pages(),
          (chunk) => {
            actual += chunk;
          },
          { profile: "semantic" },
        );
        const expected = await readFile(new URL(fixture[format], root), "utf8");
        assert.deepEqual(completeTree(actual, format), completeTree(expected, format));
      } finally {
        pdf.close();
        await source.close();
      }
    });
  }
