# Semantic regression review set

## Current authority and gate policy

Whole-document references are **drafts**, not pass/fail authorities. Their
comparisons are labeled `REVIEW` or `DRAFT MATCH` and never block the gate.
Focused checks carry per-check verification evidence in
`fixtures/semantic/review-contracts.json`. Only findings on checks backed by
source review or existing regression evidence can fail `--gate`; checks without
that evidence remain advisory. The known paragraph-continuity findings are still
failures, rather than being waived by this change.

Capture output before a heuristic change, then compare after it:

```sh
node scripts/semantic-oracle-report.mjs --out /tmp/semantic-before
# Make the change and rebuild both packages.
node scripts/semantic-oracle-report.mjs --compare /tmp/semantic-before/report.json --out /tmp/semantic-after --gate
```

The report retains normalized output snapshots and lists `changes` separately
from draft differences and verified-check failures. Changed output is a review
signal, not automatically a defect or a new accepted baseline. Older reports
without snapshots must be regenerated. This comparison detects changes in the
structures currently inspected; it is not a pixel comparison or an exhaustive
media-content diff. Whole-document review still matters.

The remaining sections record the expansion and its findings before this authority
policy was clarified; references to oracle targets describe review drafts.


Use this set before changing shared heuristics for labels, headings, paragraphs,
columns, tables, or captions. A successful fix on the invoice is insufficient if
it damages an agenda, case record, register, or paper. Converter source remains
unchanged in this checks-only work.

## Coverage

The preview now contains 17 distinct PDFs, always showing full current output.
Ten have reviewed full-document HTML targets and derived oracle Markdown. Six
municipal PDFs and SciCap currently have focused contracts, not full ideal
outputs. TraceMonkey has both types of coverage. Do not interpret a passing
focused contract as a complete semantic-quality verdict.

| Document | Protected relationships | Existing regression context |
| --- | --- | --- |
| Lauderhill case overview | Case status and notes, section progression, ordinance/section/description/compliance cells | PR #20; labels coexist with a true bordered table |
| DeKalb tax report | Complete tax row associations and at least 40 rows in one table | PR #20; columns painted separately |
| St. Augustine minutes | Speaker order, motion placement, readable text without OCR controls | PR #20; prose and bold inline labels |
| Pompano agenda | Case number, owner, address, inspector in the same list item; old/new business order | PR #13; painting order differs from reading order |
| Atlantic Beach notice | Unfragmented phrases and legal-prose order | Existing font/word-spacing regression |
| Derby register | Address, dates and long breach description stay in their row | PR #18; rotated page geometry |
| TraceMonkey research paper | Column traversal, paragraph continuity, page-boundary order, real table rows, contribution list, compound words and seven SVG/caption associations | Existing semantic-flow and media-association regressions |
| SciCap research paper | Column traversal, column and page paragraph continuations, two image/caption associations | Independent paper; existing media-association regressions |

Municipal pages and the first pages of both papers were visually inspected while
adding contracts. Existing focused tests supplied additional regression evidence.
No current converter output was copied into a supposed independent ideal target.

## Latest findings

The final-output contracts run separately against HTML and parsed Markdown:

- DeKalb, St. Augustine, Pompano, Atlantic Beach and Derby pass their focused checks.
- Lauderhill retains its violations row and case status, but Notes is split across
  paragraphs. Its complete first sentence no longer belongs to one label/value
  group. This is exactly the kind of interaction an invoice-only review misses.
- Both papers pass the prior focused order, row/list, and media/caption assertions.
- TraceMonkey splits the Introduction sentence at the first column boundary:
  `client-side web programming` does not share a paragraph with
  `and is used for the application logic`.
- SciCap splits the `captions can suggest better captions` continuation between
  columns, and an extracted footnote marker intrudes at that boundary. It also
  splits the Related Work paragraph between pages 1 and 2 and the
  `is based on the arXiv dataset` continuation between page 2 columns.

Those continuity requirements are explicit `flowParagraph` contracts. They require
contiguous phrases inside one paragraph outside a table, not merely words found
somewhere in the output. Self-tests demonstrate rejection of interleaved columns,
split paragraphs and prose incorrectly wrapped in table cells. These contracts
cover selected seams; they are not exhaustive paragraph annotations for every page.

Of 16 focused document/format comparisons, 10 pass and 6 report findings. The
original ideal-target checks remain stricter and separately reported. No expected
failures were suppressed and no converter behavior was changed.

## Reproduce the review

```sh
pnpm semantic:report
node scripts/semantic-oracle-report.mjs --gate --out /tmp/semantic-review-results
pnpm semantic:preview --input /tmp/semantic-review-results --out /tmp/semantic-review-preview
```

The gate deliberately exits 1 on review findings; run the preview command after
it, not chained with `&&`. The preview requires Poppler's `pdftoppm` and writes a
`preview.html`, source PDF copies, and page PNGs. It uses local assets and requires
no server. Source page selection supports every page; both output panes contain
the entire document. Left and right views independently select source PDF,
current HTML, rendered/raw current Markdown, or rendered/raw oracle Markdown.
Unavailable oracle views are disabled, rather than showing current output as a
made-up target. The checks/findings panel explains focused coverage.

Oracle Markdown is an independent rendering of reviewed HTML using Turndown plus
review-only rules for definition pairs and row labels. It is not a separately
authored ground truth and never uses the current PDF converter. Complex tables
retain raw HTML when GFM cannot preserve spans. Table-label/link equivalence is
covered by checker self-tests. Generated previews and images are review artifacts,
not fixture baselines to commit.

## Before changing heuristics

Run the existing intermediate-structure tests as well as the final-output report.
Review every newly failing contract alongside its PDF and both output formats.
Keep acceptable representational differences explicit; do not weaken an unrelated
municipal or research requirement to make an invoice change pass. Full independent
municipal/SciCap targets and additional annotated paragraph seams remain future
coverage work.

## Validation for this expansion

- All 21 checker/target-renderer self-tests pass.
- All 50 tests in the selected existing structure, production semantic,
  semantic-flow, media-association and ideal-fixture suites pass.
- Biome and diff whitespace checks pass for changed tooling and metadata.
- The 17-document preview was exercised in Chrome: both rendered Markdown panes,
  raw view availability, municipal/research selections, local source images,
  and a narrow viewport. Runtime errors: none.
- Converter source is unchanged. These new findings were not fixed or waived.

## First converter fixes: links and tables

Rich-content and order-confirmation now pass complete expected HTML and Markdown comparisons (`pnpm test:semantic-complete`). PDF URI annotations propagate to semantic text; table cells retain inline emphasis and links; bold header rows identify nonnumeric comparison tables; product row labels remain bold in Markdown. An enclosing table panel supports caption and spanning-footer association. Spanning tables remain HTML inside Markdown.

The broad corpus comparison caught trailing-column loss in DeKalb during implementation. Column counts now include actual cells, and an end-to-end HTML/Markdown test protects the complete HASAN NAJAM row including its trailing DO value. All previously passing municipal contracts still pass. Derby loses 24 duplicate header rows through continued-table header suppression; every data row is retained unchanged. Research-paper checks are unchanged; SciCap gains links. Existing column/page continuation and wrapped Notes failures remain for subsequent work.

Regression checks include cropped/rotated PDF URI annotations, unsafe URI rejection, adjacent unlinked text, and removal of enclosure evidence keeping nearby text outside a table. URI support currently covers HTTP(S) and mailto actions. This does not implement internal PDF destinations or arbitrary annotation shapes.
