# Semantic extraction fixtures

These fixtures define semantic intent independently of visual layout. The PDFs are copied from the
BoxPDF gallery, except `research-paper.pdf`, which is the public PDF.js `tracemonkey.pdf` fixture used
by the reader demo.

`manifest.json` is hand-authored. Its assertions are deliberately relational: they say which content
must remain associated, which content must occur in reading order, and which visual containers must
not leak into semantic HTML. They do not prescribe a particular inference implementation.

The central adversarial pair is:

- `research-paper`: two visual columns are presentation and must collapse into one reading flow.
- `acme-studio-invoice`: two visual columns are a real item table and must remain associated by row.

Assertion vocabulary:

- `readingOrder`: each inner array is an ordered subsequence of normalized document text.
- `elements`: minimum or maximum counts for semantic HTML elements.
- `tables`: required headers, minimum row counts, and representative complete rows.
- `groups`: content that must share a semantic container; `role` states the preferred element.
- `exclude`: repeated furniture that should not appear in the semantic document body.
- `notes`: human rationale for cases that need judgment.

Text comparison should normalize whitespace but preserve punctuation and reading order. A future
semantic gate should report uncertain classifications separately rather than silently inventing a
table.
