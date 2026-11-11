# Draft semantic reference documents

These HTML files are review aids, **not authoritative ground truth**. The directory
name is historical. Whole-document differences produce advisory `REVIEW` results;
they cannot fail the semantic gate. A draft match does not prove correctness.

The original commit (`5660c2e`) and manifest describe fresh reviewers working from
rendered PDFs without extractor output. That describes the recorded process, not
a verified quality guarantee. Subsequent inspection found incorrect code layout,
duplicated comments, missing diagram artwork and questionable heading choices.
Some regions have since been corrected against the source, but the documents have
not been exhaustively audited. Do not rewrite a correct converter to imitate them.

## What can block a change

Small checks in `../review-contracts.json` can be enforced when they carry explicit
verification evidence: a source-reviewed relationship or a previously established
regression test. Examples are a particular table row, a caption/media pairing, or
a sentence spanning a column boundary. Unverified checks remain advisory. A new
check must include its evidence before it is promoted; generated output alone is
not evidence of semantic correctness.

Use the complete PDFs and current HTML/Markdown to understand context. Use
before/after report comparisons to spot interactions across documents. Review
changes even when they move closer to a draft. Controlled synthetic fixtures with
known source structure complement these real-document checks; they do not establish
that the inferred structure of an unrelated production PDF is correct.

## Media and Markdown

Draft Markdown is generated from these HTML files with an independent review-only
renderer. It inherits their errors and is not a second source of truth. The
`assets/` directory contains source-rendered reference imagery and reproduction
notes. A PNG reference does not require the converter to emit PNG instead of SVG.
A `data-visual-required` placeholder indicates an incomplete draft, not proof of a
converter failure.

See [the regression review guide](../../../docs/semantic-regression-review.md) for
commands, coverage limitations and findings. Historical corrections are recorded
in [the oracle review log](../../../docs/semantic-oracle-review.md).
