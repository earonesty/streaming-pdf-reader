# `@boxpdf/html-writer`

Streams text-oriented HTML from pages produced by `@boxpdf/reader`. This is the
PDF-to-HTML package; it is intentionally named differently from `boxpdf-html`,
which converts HTML in the opposite direction.

```ts
import { open } from "node:fs/promises";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";
import { writeHtmlDocument } from "@boxpdf/html-writer";

const source = await fileSource("input.pdf");
const pdf = await openPdf(source);
const output = await open("output.html", "w");

try {
  await writeHtmlDocument(pdf.pages(), async (chunk) => {
    await output.write(chunk);
  });
} finally {
  await output.close();
  pdf.close();
  await source.close();
}
```

The default `positioned` layout preserves text coordinates. The optional
`flow` layout uses the reader's inferred lines and tables. Images, vector
graphics, and exact font reproduction are not yet rendered.
