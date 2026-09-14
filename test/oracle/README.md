# PDF.js oracle tests

This suite compares `@boxpdf/reader` page output with PDF.js. Corpus tests cover
normalized decoded characters, page geometry, and first-span position. Focused
generated cases compare complete single-span geometry, including width, height,
font size, and transformed position. Span boundaries across general PDFs are
not an exact oracle because readers may combine adjacent glyphs differently.

## Synthetic image visual parity

Run the focused PDFium-versus-Chromium suite:

```sh
SYNTHETIC_IMAGE_ORACLE=1 pnpm exec vitest run test/oracle/synthetic-images.test.ts
```

Set `CHROMIUM_PATH` if Chrome/Chromium is not at a detected location. Ordinary
oracle runs skip this browser-dependent suite. No downloaded PDFs are needed:
`test/helpers/synthetic-images.ts` builds valid PDFs with exact stream lengths
and xref tables. Output goes to `artifacts/synthetic-images/`: open `index.html`
for paired renders, with links to each PDF and generated HTML. `results.json`
records mismatches, extracted image counts, and PDF/HTML byte counts.

The 18 cases cover page-sized and oversized placement, high pixel count,
CropBox offsets, all quarter-turn rotations, reflection, explicit clipping,
grayscale/1-bit/CMYK/indexed images, Decode inversion, a soft mask, interpolation,
and vector paint order. A black edge band makes clipping visibly different
from fitting the image to the page. The high-resolution fixture is 2400 x 3200
pixels (23,040,000 decoded RGB bytes); this is a correctness probe, not a memory
benchmark or a test of arbitrary image sizes.

The current baseline has **10 cases with visual parity and 8 known visual gaps**.
Baseline mode asserts parity for supported cases and an actual measured mismatch
for each named gap; a successful baseline run does not mean all images render
correctly. To make all eight gaps fail as desired-behavior tests:

```sh
SYNTHETIC_IMAGE_ORACLE=1 SYNTHETIC_IMAGE_STRICT=1 pnpm exec vitest run test/oracle/synthetic-images.test.ts
```

Known gaps: 8-bit grayscale, 1-bit grayscale, CMYK, and indexed images disappear;
Decode inversion and soft masks are ignored; low-resolution images are smoothed;
and a vector fill painted after an image is incorrectly placed behind it.
Promote a fixed case by removing its `issue` annotation. Setup, extraction,
decoding, and page-dimension failures always fail the oracle in either mode.

Comparison uses PDFium at 2 pixels/point and Chromium at 1.5 device pixels/CSS
pixel. Only outer two-pixel borders and a narrow band around the central quadrant
edges are excluded. A pixel differs if any RGB channel differs by more than 32;
passing cases require fewer than 1% such pixels. This is a focused content and
geometry check, not a claim of pixel-perfect rendering. Browser screenshots
reset only document/page margins and capture at the origin to avoid rounding
fractional CSS bounding boxes.

`test/unit/synthetic-images.test.ts` also runs without a browser: three placement
and clipping regressions plus four explicitly expected failures for omitted image
formats. The subsequent encoding change replaces BMP with PNG by default and adds
optional compact PNG/JPEG selection. The high-resolution fixture now emits
40,950 HTML bytes instead of 30,721,658; its lossless visual comparison still passes.
