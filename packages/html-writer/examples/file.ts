import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { writeHtmlDocument } from "@boxpdf/html-writer";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("usage: file.ts input.pdf output.html");

const source = await fileSource(inputPath);
const reader = await openPdf(source);
const output = createWriteStream(outputPath, { encoding: "utf8" });

try {
  await writeHtmlDocument(reader.pages(), async (chunk) => {
    if (!output.write(chunk)) await once(output, "drain");
  });
  output.end();
  await finished(output);
} finally {
  output.destroy();
  reader.close();
  await source.close();
}
