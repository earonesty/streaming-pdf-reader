# Semantic oracle: checks-only review

**Current policy:** historical whole-document references are advisory drafts. Complete fixture expectations and focused checks with recorded verification evidence are enforced. See the
[current policy and before/after workflow](semantic-regression-review.md#current-authority-and-gate-policy).
The entries below are a chronological review log, not a declaration that the
original targets were correct.


Current coverage and latest cross-document findings are in
[Semantic regression review set](semantic-regression-review.md). The sections below
record the initial oracle work and subsequent reviewed decisions chronologically.


The initial checks-only phase did not modify reader, inference, or writer source; the later links/table fixes are recorded in the regression review. The independently
reviewed ideal HTML files were initially unchanged; subsequent user-reviewed
corrections are recorded below. `marked` is a development-only parser
used to interpret actual Markdown independently of the writer.

## Running

- `pnpm test:semantic-oracle`: adversarial tests of the checker itself.
- `pnpm semantic:report`: build both packages and report HTML and Markdown findings.
- `pnpm semantic:gate`: the same comparison, exiting 1 on complete-fixture differences or enforced verified-check failures; draft differences remain advisory.
- After building, `node scripts/semantic-oracle-report.mjs --gate --out /tmp/semantic-review`
  saves actual HTML, Markdown, and a detailed `report.json`.
- `--json` prints the detailed report. The report JSON schema replaces the former
  vocabulary/tag-count report; each row now represents one fixture and format.

The strict gate is opt-in during review, not added to release quality yet. No
baseline has been blessed and no thresholds were weakened to match current output.

## What is compared

Visible text token multiplicities (case and punctuation retained); longest common
token subsequence versus shared-token count for order; heading levels and labels;
list kind, start, item grouping and nested lists; ordered rows, cells and spans
inside each table; link labels and destinations; preformatted text; and content
between successive headings. The last check detects employment details assigned
to a different role without requiring identical HTML wrappers. Product associations
are checked through complete table rows. Counts include both missing and extra
structures. Samples are capped at eight entries, with full actual outputs saved.

Metadata, styles, scripts and SVG internals are excluded. Inline wrappers and
ordinary whitespace are normalized. Code retains internal whitespace. The checker
is an offline corpus tool, not a streaming memory benchmark.

## Initial results

Ten existing PDFs, independently emitted as HTML and Markdown: 3/20 comparisons
pass exactly. Acme invoice HTML and both hanging-indent outputs pass. The other
17 comparisons produce review findings, **not 17 confirmed conversion bugs**.

Concrete differences inspected:

- Acme invoice: HTML preserves Status and Notes as h2 headings; Markdown turns
  them into uppercase labels with colons. This is a format-specific structure gap.
- Rich content: both formats lose the expected link destinations. The spanning
  footer text survives, but is outside the table. Markdown additionally uses an
  empty header row above the actual feature labels.
- Resume: the expected employment heading/detail records survive; differences
  concern contact links, separators, heading levels and education grouping.
- Order confirmation: HTML product rows preserve names, variants, quantities and
  amounts. Markdown adds dashes between names and variants, which strict cell
  comparison reports. Both formats omit the target's Order total heading and
  expected links. Verify that heading against the PDF before changing extraction.
- Multipage invoice: Markdown retains all 84 rows, including totals, but expands
  spanning total labels into cells with empty placeholders. This is a Markdown
  representation policy decision, not evidence of lost amounts.
- Research paper, itinerary and boarding pass also have order differences among
  shared tokens; inspect their artifacts before deciding fixes.

## Review boundaries and next decisions

The ideal targets may add semantic labels or infer destinations not recoverable
from the source PDF. Case, separators, Markdown table spans and heading choices
can represent acceptable differences. Confirm those against the PDF, then encode
narrow, reviewed equivalences or separate Markdown expectations; do not globally
ignore punctuation, missing text, or table structure to get a green gate.

There are checker self-tests for nested lists, level-five headings and changed
fragment link destinations, but these do not establish PDF extraction coverage.
Dedicated PDFs and reviewed targets for nested lists, h5/h6, and footnote/reference
relationships are still needed. GFM does not define footnotes; this check currently
compares rendered links rather than a footnote AST. Fragment target resolution,
figure/caption relationships, emphasis, full heading ancestry, and arbitrary
card layouts outside tables are not yet separately validated. Heading-delimited
records are a useful association check, not a complete document tree oracle.

Validation: both package builds succeeded; all 10 checker self-tests passed;
Biome passed for changed JavaScript and package metadata; diff whitespace checks
passed. The corpus gate exited 1 as intended and conversion source was untouched.

## Accepted label/value equivalence

Following visual review, HTML description-list pairs (`dt`/`dd`) and Markdown
`**Label:** value` (also `**Label**: value`) express the same relationship.
The oracle now compares explicit label/value pairs and removes only that Markdown
separator colon from content/order/record comparison. Other punctuation, including
colons within values, remains significant. Missing, duplicated, unmarked, or swapped
pairs still fail. This does not equate heading sections or arbitrary tables with
label/value pairs.

All 13 checker self-tests pass. The corpus remains at 3/20 exact passes, with
additional relationship diagnostics now available. In order-confirmation Markdown,
all four summary pairs match and the four delimiter-colon findings disappear;
three product-variant dashes and the other previously reported differences remain.
No converter source or expected fixture was changed.


## Reviewed invoice labels and table headers

Status and Notes in Acme are labels for single values, not section headings.
The target now uses a description list with the source's uppercase labels.
Current Markdown matches those pairs; HTML's existing heading representation
is now a reported difference. No converter change was made.

A separate `tableHeaders` check records each header's table/row/column position,
text and row/column scope. This catches loss of a header role even when every
cell's text remains intact. GFM column headers are recognized; a fully bold first
body cell is accepted as Markdown's row-label representation. Bold amounts in
other columns do not become headers. In HTML, bold styling alone does not
substitute for a `th` role. Implicit scope uses the header section/first row or
first column; unusual multi-level tables will require further review.

Acme Markdown now fails only `tableHeaders`, exposing its unmarked row-label
column. Link destinations remain strict and unchanged. The full corpus has 2/20
exact passes (both hanging-indent outputs), reflecting the corrected target and
stronger checks, not a converter regression. All 16 checker tests and all 12
ideal-fixture tests pass. At that stage the corpus gate still exited 1; current gate policy is stated above.

## Source-verified research-code correction

Visual review found three incorrect code targets in the TraceMonkey paper. Against
PDF pages 2–3, Figure 1 now keeps each line number with its instruction and restores
nesting indentation; Figure 3 keeps instructions and comments on the same line;
Figure 4 restores omitted inline comments. These corrections were transcribed
against the source pages, not copied from current extraction. Oracle Markdown
preserves the revised code blocks exactly. A new test checks the six-line and
13-line listings, indentation, restored comments and HTML-to-Markdown preservation.
All 22 checker self-tests and 12 ideal-fixture tests pass. Converter code is unchanged.

## Source-verified Figure 2 correction

The research target's Figure 2 was only a list of state-machine labels. It now
uses an independently rendered crop of PDF page 2 and retains the semantic caption.
The crop and reproduction command are in `fixtures/semantic/ideal/assets/`.
Oracle Markdown carries an image reference followed by the caption; the report
and preview copy the required asset. This corrects the target, not the current
converter's SVG. A new test requires media/caption association in both oracle
formats. All 23 checker self-tests and 12 ideal-fixture tests pass.

## Fixture policy

Fixtures should be understandable, not necessarily narrow. Covering interacting features is valuable. Maintain complete expected HTML, independent expected Markdown, and an explicit feature inventory. Focused assertions are supplementary diagnostics, not the definition of a fixture. Use large real-world PDFs to discover defects and design reviewable examples. See ../fixtures/semantic/expected/README.md for normalization, promotion and update rules.

## Complete fixture promotion decisions

The user approved promoting rich-content and product cards to complete fixtures after reviewing source/current/target previews. These decisions supersede the earlier open questions in this chronological log.

- **Rich-content:** retain the entire long-token paragraph and inset, with normal text resuming afterward. Preserve mixed inline emphasis and source annotation destinations, table column/row relationships, and the three-column footer. The in-cell link is bold in the source; no invented aria-label belongs in the expectation. HTML keeps neutral inset grouping; Markdown's indented block representation was accepted. The complete expectations and feature inventory live under `fixtures/semantic/expected`.
- **Order-confirmation:** retain the thank-you, order metadata, product cards represented as the accepted table, complete shipping/billing sections, and delivery/returns footer. Subtotal/shipping/tax/total are label/value pairs, rendered as bold-colon labels in Markdown. The user explicitly accepted that relationship. There is no additional “Order total” heading in the promoted expectation. Preserve tracking/support links and product row-label semantics.
- **Figure 2 draft:** retain the user-requested divider, bold figure number and italic caption. This is a semantic presentation preference, not a claim that the PDF contains an identical horizontal rule. The reference crop remains a visual review aid; it is not a machine-readable transcript of every diagram label.


## Semantic-flow fixture promotions

The follow-up promotes wrapped-notes, column-code and spanning-rows to complete fixtures. Their independently authored HTML and Markdown targets cover the complete source text, with feature inventories in expected/manifest.json. The original Notes PDF has explicit label/value geometry, a following section and a real table. The new column/code PDF and middle/footer-row PDF were rendered and visually inspected, then reviewed in current/oracle preview views. The maintainer-approved Markdown policy represents full-width rows as italic boundary paragraphs, repeating established column headers when data resumes; HTML retains precise spans. The [decision record](semantic-flow-and-markdown.md) records scope and regression evidence. Large research/municipal documents remain selected-check/advisory references rather than complete oracles.
