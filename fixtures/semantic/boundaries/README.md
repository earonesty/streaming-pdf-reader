# Bounded semantic regression fixtures

These are real, generated PDFs with deliberately small, known layouts, inspired by the research-paper and municipal corpus failures. They are reproductions of defect classes, not crops of those documents or claims that the underlying causes are identical. The semantic-flow follow-up now fixes the bounded cases.

| PDF | Intended relationship |
| --- | --- |
| column-plain.pdf | One paragraph continues from the left column into the right: “captions can suggest better descriptions”. Text is painted in alternating left/right bands to exercise geometric reading order. |
| column-asides.pdf | The same continuation with a separate figure/caption and footnote. Preserve the asides without inserting them into the paragraph. |
| page-furniture.pdf | One sentence crosses a page boundary: “is based on the public archive”. Running headers/footers must not interrupt it; the later new paragraph must remain separate. Tested with lookahead 1 and 3. |
| wrapped-notes.pdf | The Notes value wraps at “missing or has a delinquent balance.” Keep the complete value before Documents Issued, and preserve the real violation table. |
| column-code.pdf | Two-column prose followed by exact embedded code and one comment. |
| spanning-rows.pdf | Wrapped full-width middle content and footer, data rows before/after, repeated Markdown headers, and separate following prose. |
| separation-control.pdf | Preserve two intentionally separate paragraphs, the Widget/42 table association, and a source note. |

All seven PDFs are 1–2 pages and under 3 KB (tests enforce a 20 KB ceiling). Every rendered page was visually reviewed. Complete independent expectations additionally cover wrapped-notes, column-code and spanning-rows; targeted assertions diagnose selected relationships. HTML and independently parsed Markdown are checked separately.

Regenerate with `pnpm fixtures:generate:semantic-boundaries`. The generator uses fixed dates and explicit geometry; repeat generation should produce identical bytes.

Run `pnpm test:semantic-boundaries`: **15 passing tests, no skips**. The old `pnpm reproduce:semantic-boundaries` command remains an equivalent reproduction entry point. Existing separation and size/page controls still run.

The generator is `scripts/generate-flow-boundaries.mjs`; assertions are in `test/semantic-boundaries/flow.test.ts`. Keep the broader municipal/research corpus checks when fixing these: passing a miniature reproduction alone does not establish that the original document is fixed.

See [flow and Markdown decisions](../../../docs/semantic-flow-and-markdown.md) for inference boundaries and memory guarantees.
