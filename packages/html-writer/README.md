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

## Compatibility oracle

Tests compare normalized page geometry, text, and anchor positions with
Poppler's `pdftohtml -c -hidden -noframes -zoom 1` output. Poppler runs only as
an independent test oracle; its resource use is not part of the writer's memory
contract.

`pnpm poppler:report` runs the positioned writer over all 62 text fixtures in
the pinned PDF.js corpus. The checked-in baseline currently records exact text
and geometry agreement on 51 fixtures. The remaining cases are retained in the
denominator; most exercise intentional PDF.js/Poppler differences in RTL text,
font encodings, or malformed Unicode maps. `pnpm poppler:gate` rejects any loss
from the known-good pass set and runs in CI.
