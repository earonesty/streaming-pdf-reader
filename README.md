# `@boxpdf/reader`

A streaming, memory-bounded PDF reader and structured-data extractor for
JavaScript. The source repository is named `streaming-pdf-reader` so the
project is discoverable by the problem it solves; the package uses the compact
`@boxpdf/reader` API name.

## Defining contract

The reader parses and extracts content from large PDFs without buffering
the complete file. Memory use is governed by explicit byte and object cache
budgets rather than document size or pages already processed.

```text
peak parser-owned memory <= configured caches
  + active page window
  + largest permitted decoded object
  + measured fixed overhead
```

Every input implements a random-access source:

```ts
interface PdfSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
```

## Package boundaries

```text
@boxpdf/reader
├── source          random-access file, HTTP, Blob, and memory inputs
├── store           bounded sparse byte cache
├── syntax          PDF lexer, objects, xref, and page tree
├── content         graphics state, fonts, CMaps, and text operations
└── structure       optional reading order, paragraphs, lists, and tables

future optional package or entry point
└── render          Canvas, SVG, or bitmap rendering
```

The core result preserves positioned text and provenance. Semantic structure
is inferred separately and includes confidence and diagnostic reasons. A
future renderer will consume page operations without becoming a dependency of
text or table extraction.

## Usage

Read a local file in Node:

```ts
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";

const source = await fileSource("large.pdf");
const pdf = await openPdf(source, {
  chunkSize: 64 * 1024,
  maxBytes: 16 * 1024 * 1024,
});

try {
  for await (const page of pdf.pages()) {
    console.log(page.number, page.spans);
  }
  console.log(pdf.stats);
} finally {
  pdf.close();
  await source.close();
}
```

HTTP sources require byte-range support:

```ts
import { httpSource, openPdf } from "@boxpdf/reader";

const pdf = await openPdf(await httpSource("https://example.com/large.pdf"));
const firstPage = await pdf.getPage(0);
```

Infer reading-order lines and aligned tables, then format a table:

```ts
import { structurePage, tableToCsv } from "@boxpdf/reader/structure";

const structured = structurePage(firstPage);
const csv = structured.tables[0] ? tableToCsv(structured.tables[0]) : undefined;
```

## v1 support

The v1 parser supports:

- classic cross-reference tables, cross-reference streams, and `/Prev` chains
- compressed object streams and linearized PDFs
- lazy page-tree lookup with inherited media boxes, rotation, and resources
- unfiltered, Flate, and ASCII-hex streams with decoded-size limits
- literal and hexadecimal strings, common text operators, graphics transforms,
  WinAnsi text, UTF-16 strings, Type 0 fonts, and common `ToUnicode` mappings
- bounded sparse byte caching with source-read and resident-byte telemetry
- deterministic line grouping, aligned-table inference, and rows, CSV, and HTML formatting

Encrypted PDFs, damaged-file repair, inline images in content streams, uncommon
stream filters, complete font-width metrics, OCR, and rendering are outside the
v1 support surface. Unsupported filters and configured resource limits fail
with explicit errors.

## Compatibility oracle

PDF.js is the primary behavioral oracle for page geometry, decoded text, text
direction, and positioning. Tests compare normalized positioned characters
rather than requiring identical text-span boundaries. Poppler and MuPDF can
serve as secondary oracles where implementations disagree.

The current commit gate compares seven OSS fixtures against PDF.js. It requires
exact page count, dimensions, rotation, and normalized decoded characters, plus
first-span positioning on unrotated pages. Table reconstruction has exact
goldens for reading order, rows, CSV, and HTML.

Memory tests extract from 10 MB and 1 GB virtual random-access PDFs with the
same 64 KiB byte-cache limit. They assert cache residency, maximum individual
source reads, total bytes fetched, process RSS, and ArrayBuffer growth.

## Repository layout

- `src/source.ts`: public random-access source contract and portable sources
- `src/store/`: bounded sparse byte storage
- `src/syntax/`: PDF lexical and object parsing
- `src/content/`: page content and text interpretation
- `src/structure/`: reading-order and table inference
- `src/render/`: reserved boundary for an optional renderer adapter
- `test/unit/`: fast surgical tests
- `test/fixtures/`: fixture integrity and golden extraction tests
- `test/oracle/`: differential PDF.js tests
- `test/memory/`: isolated-process memory-bound tests
- `fixtures/`: revision-pinned OSS corpus and provenance

## Development

```sh
pnpm install
pnpm fixtures:fetch
pnpm test:quick
pnpm test:oracle
pnpm test:memory
pnpm quality
```
