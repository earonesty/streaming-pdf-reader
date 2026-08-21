# PDF.js parity corpus

This corpus defines the compatibility denominator for `@boxpdf/reader`. It is
derived from a pinned PDF.js test manifest by `scripts/build-corpus-manifest.mjs`.

The selection contains exactly 120 repository-local PDF fixtures:

- every unique non-linked PDF used by PDF.js `text` or `load` tests;
- curated parser, font, annotation, filter, xref, malformed-input, and geometry
  fixtures until the configured target is reached.

External `.link` fixtures are excluded because their bytes and licensing are
not controlled by the pinned PDF.js revision. Corpus PDFs download into
`.cache/pdfjs-corpus/` and are not stored in ordinary Git history. The generated
`manifest.json` records the pinned source URL, upstream MD5, test mode, page
window, and feature categories for every fixture.

Commands:

```sh
pnpm corpus:build     # regenerate and verify corpus/manifest.json
pnpm corpus:fetch     # download and verify all 120 PDFs
pnpm parity:report    # compare @boxpdf/reader with PDF.js
pnpm parity:baseline  # intentionally replace the checked-in baseline
pnpm parity:gate      # enforce the checked-in non-regression floor
```

One fixture contributes one score. A `load` fixture passes when both readers
open it and agree on page count, selected page dimensions, and rotation. A
`text` fixture must also agree on normalized decoded characters and the initial
positioned text origin on unrotated selected pages. At most five pages per
fixture are scored to keep the commit gate fast and deterministic.
