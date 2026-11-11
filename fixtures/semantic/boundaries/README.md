# Bounded semantic regression fixtures

These are real, generated PDFs with deliberately small, known layouts, inspired by the research-paper and municipal corpus failures. They are reproductions of defect classes, not crops of those documents or claims that the underlying causes are identical. No converter behavior changes accompany them.

| PDF | Intended relationship |
| --- | --- |
| column-plain.pdf | One paragraph continues from the left column into the right: “captions can suggest better descriptions”. Text is painted in alternating left/right bands to exercise geometric reading order. |
| column-asides.pdf | The same continuation with a separate figure/caption and footnote. Preserve the asides without inserting them into the paragraph. |
| page-furniture.pdf | One sentence crosses a page boundary: “is based on the public archive”. Running headers/footers must not interrupt it; the later new paragraph must remain separate. Tested with lookahead 1 and 3. |
| wrapped-notes.pdf | The Notes value wraps at “missing or has a delinquent balance.” Keep the complete value before Documents Issued, and preserve the real violation table. |
| separation-control.pdf | Preserve two intentionally separate paragraphs, the Widget/42 table association, and a source note. |

All five PDFs are 1–2 pages and under 3 KB (tests enforce a 20 KB ceiling). Every rendered page was visually reviewed. Expectations assert selected relationships rather than an entire idealized document. HTML and independently parsed Markdown are checked separately.

Regenerate with `pnpm fixtures:generate:semantic-boundaries`. The generator uses fixed dates and explicit geometry; repeat generation should produce identical bytes.

Run `pnpm test:semantic-boundaries`: **3 passing controls/bounds checks, 10 skipped known-defect tests**. Only the column/page continuation and wrapped Notes assertions are skipped; they remain unresolved and outside the links/table release. An unrestricted Vitest/coverage run uses the same skips.

Run `pnpm reproduce:semantic-boundaries` to execute all assertions: currently **10 failures, 3 passes**, with a nonzero exit status. Remove each skip as its converter fix lands, and retain the broader corpus checks. The passing controls always run; no complete HTML/Markdown fixture expectations are skipped.

The generator is `scripts/generate-flow-boundaries.mjs`; assertions are in `test/semantic-boundaries/flow.test.ts`. Keep the broader municipal/research corpus checks when fixing these: passing a miniature reproduction alone does not establish that the original document is fixed.
