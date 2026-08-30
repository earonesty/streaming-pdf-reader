# `@boxpdf/reader`

A streaming, memory-bounded PDF reader and structured-data extractor for
JavaScript.

## Defining contract

The reader parses and extracts content from large PDFs without buffering
the complete file. Explicit byte and object cache budgets govern memory use.

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

separate output packages
├── @boxpdf/html-writer  streaming visual or semantic HTML output
└── render               future Canvas, SVG, or bitmap rendering
```

The core result preserves positioned text and provenance. Semantic structure
is inferred separately and includes confidence and diagnostic reasons. A
future renderer will consume page operations without becoming a dependency of
text or table extraction.

## HTML writer

`@boxpdf/html-writer` streams PDF pages to HTML through an awaited write
callback. The default `visual` profile preserves display presentation; the
`semantic` profile turns page geometry into reflowable reading order, nested
sections, paragraphs, lists, cards, label/value groups, and tables. A bounded
document window joins tables continued across pages and removes repeated page
furniture without buffering the complete PDF. See `packages/html-writer`.

## Usage

Read a local file in Node:

```ts
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";

const source = await fileSource("large.pdf");
const pdf = await openPdf(source, {
  chunkSize: 64 * 1024,
  maxBytes: 16 * 1024 * 1024,
  maxXrefCacheBytes: 16 * 1024 * 1024,
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

HTTP sources prefer byte-range support. Servers that return a complete HTTP 200 response are also
supported: the reader keeps only the requested slice in memory and emits one transfer-efficiency
warning per source.

```ts
import { httpSource, openPdf } from "@boxpdf/reader";

const pdf = await openPdf(await httpSource("https://example.com/large.pdf"));
const firstPage = await pdf.getPage(0);
```

## v1 support

The v1 parser supports:

- classic cross-reference tables, cross-reference streams, and `/Prev` chains
- compressed object streams and linearized PDFs
- lazy page-tree lookup with inherited media boxes, rotation, and resources
- unfiltered, Flate, and ASCII-hex streams with decoded-size limits
- literal and hexadecimal strings, common text operators, graphics transforms,
  WinAnsi text, UTF-16 strings, Type 0 fonts, and common `ToUnicode` mappings
- Standard 14, explicit, embedded TrueType, and PFA/PFB Type 1 horizontal
  metrics
- horizontal and vertical CID widths, vertical origins, `TJ` displacement, and
  top-to-bottom structure grouping
- bounded sparse byte caching with source-read and resident-byte telemetry
- a configurable packed-xref byte ceiling with resident-byte telemetry
- semantic HTML with heuristic reading-order and table inference based on repeated text alignment

Encrypted PDFs, damaged-file repair, inline images in content streams, uncommon
stream filters, Type1C/CFF width recovery, named CMap collections without a
`ToUnicode` map or usable embedded TrueType cmap, OCR, and rendering are outside
the v1 support surface. Unsupported filters and configured resource limits fail
with explicit errors.

## Compatibility oracle

PDF.js is the primary behavioral oracle for page geometry, decoded text, text
direction, and positioning. Tests compare normalized positioned characters and
allow different text-span boundaries. Poppler is an independent secondary
oracle for the HTML writer. Its corpus gate preserves exact geometry and
decoded-text agreement on every fixture known to agree across both engines.
The report records RTL and font-decoding differences between the engines.

The full corpus gate accepts all 118 supported, unencrypted fixtures (100%).
Of those, 115 match PDF.js and three named fixtures intentionally diverge where
the visual oracle confirms improved `.notdef`, rotated-origin, or UTF-16 behavior.
The two remaining fixtures in the fixed 120-file denominator are encrypted and
intentionally unsupported. This score covers page count,
dimensions, rotation, normalized decoded characters, and the first text origin
on unrotated pages. Focused geometry tests additionally compare span width,
height, font size, and transformed positions. Structure goldens cover reading
order, inferred word boundaries, table rows, and semantic HTML. The scoring limits and the
layout gap found after v0.1.1 are recorded in `docs/PARITY_PLAN.md`.

Memory tests extract from 10 MB and 1 GB virtual random-access PDFs with the
same 64 KiB byte-cache limit. They assert cache residency, maximum individual
source reads, total bytes fetched, process RSS, and ArrayBuffer growth.

## Memory comparison

`pnpm memory:compare` runs `@boxpdf/reader`, raw PDF.js, and unpdf in isolated
processes against the same logical PDF. The default comparison uses 10 MiB and
100 MiB inputs. PDF.js and unpdf receive complete `Uint8Array` inputs;
`@boxpdf/reader` receives a random-access source. PDF.js URL and range loading
are separate input modes and are outside this comparison.

One Node 24 run produced these measurements:

| Input | Engine | Peak RSS | RSS growth | ArrayBuffer growth | Source data read |
|---:|---|---:|---:|---:|---:|
| 10 MiB | `@boxpdf/reader` | 49.26 MiB | 3.64 MiB | 77.06 KiB | 140 KiB |
| 10 MiB | PDF.js | 130.13 MiB | 84.49 MiB | 10.15 MiB | entire input |
| 10 MiB | unpdf | 82.37 MiB | 36.74 MiB | 10.14 MiB | entire input |
| 100 MiB | `@boxpdf/reader` | 49.32 MiB | 3.64 MiB | 77.06 KiB | 140 KiB |
| 100 MiB | PDF.js | 220.09 MiB | 174.44 MiB | 100.15 MiB | entire input |
| 100 MiB | unpdf | 172.37 MiB | 126.75 MiB | 100.14 MiB | entire input |

Peak RSS includes the Node process baseline, which was about 46 MiB in this
run. RSS and allocator behavior vary by operating system and dependency
version. The benchmark script is the source of current measurements.

## Repository layout

- `src/source.ts`: public random-access source contract and portable sources
- `src/store/`: bounded sparse byte storage
- `src/syntax/`: PDF lexical and object parsing
- `src/content/`: page content and text interpretation
- `src/structure/`: reading-order and table inference
- `src/render/`: reserved boundary for an optional renderer adapter
- `test/unit/`: focused parser and API tests
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
