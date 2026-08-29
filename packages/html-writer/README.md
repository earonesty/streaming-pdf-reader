# `@boxpdf/html-writer`

Streams visual or semantic HTML from pages produced by `@boxpdf/reader`.

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
  }, { profile: "visual" });
} finally {
  await output.close();
  pdf.close();
  await source.close();
}
```

The default `visual` profile preserves page dimensions and text coordinates for
display presentation. The `semantic` profile uses inferred reading order,
lines, nesting, and tables to produce reflowable HTML. The visual model comes
first: semantic structure is derived from the complete page evidence rather
than inferred after presentation information has been discarded.

Document-level semantic output uses a bounded page window to merge tables that
continue across page boundaries, preserve section nesting across pages, and
suppress repeated margin furniture. It also expresses aligned product cards,
address groups, and financial summaries as useful HTML rather than loose text.
The default window retains at most four extracted text models; configure it
from one to sixteen pages without buffering PDF bytes, fonts, or raster images:

```ts
await writeHtmlDocument(pdf.pages(), write, {
  profile: "semantic",
  semanticLookaheadPages: 4,
  onSemanticStats(stats) {
    console.log(stats.peakBufferedPages, stats.mergedTables);
  },
});
```

The reported statistics also include processed pages, peak buffered lines, and
suppressed furniture. Page-level `pageToHtml()` remains available when no
cross-page inference is wanted.

Semantic HTML excludes images by default, which keeps extraction output small
for text and LLM workflows. Choose how raster and vector media are represented
with `imageOptions`:

```ts
await writeHtmlDocument(pdf.pages(), write, {
  profile: "semantic",
  imageOptions: "references",
  async onImage({ name, mimeType, data }) {
    await saveAsset(name, mimeType, data);
  },
});
```

`"embedded"` writes raster data URIs and inline SVG into the HTML.
`"references"` writes deterministic asset names into the HTML and passes each
asset to the awaited `onImage` callback, so callers can store it without
accumulating a document's images in memory. `"excluded"` omits media. Visual
HTML defaults to `"embedded"`; semantic HTML defaults to `"excluded"`.
Referenced semantic assets include both raster images and SVG vector media.

The legacy `layout: "positioned" | "flow"` option remains as an alias for
`profile: "visual" | "semantic"`. The PDFium parity report tracks progress
toward complete display presentation.

The callback is awaited for every chunk, so a file stream, HTTP response, or
Web `WritableStream` can apply backpressure. The caller owns and closes the PDF
source, reader, and destination; the writer owns only HTML serialization. See
[`examples/file.ts`](examples/file.ts) for Node file-to-file conversion and
[`examples/http.ts`](examples/http.ts) for a streaming Web `Response`. Validate
or allowlist user-provided PDF URLs before passing them to the HTTP example.

## Compatibility oracle

Tests compare normalized page geometry, text, and anchor positions with
Poppler's `pdftohtml -c -hidden -noframes -zoom 1` output. Poppler serves as an
independent test oracle. The writer's memory contract covers the reader and
HTML serialization.

`pnpm poppler:report` runs the visual writer over every text fixture in the
pinned PDF.js corpus. Cases where visual glyph rendering intentionally replaces
extractable HTML text remain explicit in the baseline, alongside known
PDF.js/Poppler differences in RTL text, font encodings, and malformed Unicode
maps. `pnpm poppler:gate` rejects any loss
from the known-good pass set and runs in CI.

The writer retains the reader's logical Unicode order. RTL spans and flow lines
receive `dir="rtl"` plus isolated bidirectional CSS so browsers perform visual
ordering without changing extracted text. Vertical spans use CSS writing mode.
Poppler emits visual-order text for several RTL corpus files, so those source
strings are expected to differ.

`issue16224` is the geometry exception: its 531 × 666 point MediaBox contains an
182.77 × 32.539 point CropBox. PDF.js, `pdfinfo`, and the reader expose the
CropBox as page size; Poppler 22.02 `pdftohtml` emits the MediaBox. The writer
keeps the PDF.js-compatible CropBox dimensions.
