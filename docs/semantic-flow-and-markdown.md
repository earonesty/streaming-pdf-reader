# Semantic flow and streaming Markdown decisions

This follow-up to PR #26 addresses the bounded Notes, column, page and spanning-table cases together. The aim of Markdown is primarily to feed language models: preserve text, associations and reading order without retroactive rewriting or extra document buffering.

## Spanning rows

A full-width row splits a Markdown table. Emit its content as an italic paragraph, then start another table for later data rows, repeating established headers. This applies in the middle and at the end of a table; do not invent a “footer” or “Table note” label. Captions precede native Markdown tables as bold paragraphs. Existing inline links and emphasis remain; the outer italic wrapper makes an already-italic span redundant. Partial-width spans and rowspans still fall back to HTML because splitting does not express their relationships.

HTML retains the original table, colspan and tfoot. A wrapped ruled band can become a full-width row only when text crosses a column boundary, its lines align, and no visible vertical divider crosses that band. Enclosed panel footers may have up to four tightly spaced, aligned lines, retaining the existing enclosure, width and separator requirements. Unrelated indented or separated paragraphs remain outside.

The former streamed-GFM deferral is resolved by choosing a different output representation, not by buffering or rewriting output. Financial totals still render as data rows. A separate header-row snapshot carries the established column names across headerless page continuations; it does not retain earlier data rows.

Rich-content's complete Markdown expectation deliberately changes from raw HTML to this representation. Its HTML expectation is unchanged. Markdown no longer expresses HTML caption/row-header roles as exact DOM attributes; the caption text, column relationships, original emphasis and footer association remain explicit. This is an accepted representation difference, not a reason to weaken HTML checks.

## Flow boundaries

- **Wrapped Notes:** the reproduction already recovered all value lines into a cell. The defect was representing the short, uniformly bold labels and unbold wrapped values as a borderless data table. Convert that evidenced case to a definition list. Ruled tables and tables with styled value/header cells retain their table interpretation.
- **Two columns:** only reclassify a sustained two-column inferred table when both columns contain long unbold prose and the final left line can continue into a lowercase right-column opening. Ruled tables remain tables. Existing three/four-column behavior is preserved. Body-sized candidate lines establish the column band so figure captions and footnotes do not interrupt its prose. A marked column seam permits joining compatible sentence fragments; it does not permit arbitrary distant paragraph joins.
- **Pages:** join only adjacent physical pages, from an unfinished paragraph near the bottom to a compatible lowercase paragraph near the top, with matching font and left edge. New headings, lists, completed sentences and gaps remain boundaries. Repeated furniture is ignored using the existing bounded lookahead/signature behavior. With lookahead 1 the first occurrence of running furniture may remain; later known repetitions do not interrupt continuation.
- **Memory:** a pending paragraph contains only the current page's block. At a confirmed continuation its previous text is streamed immediately and the pending block is replaced. A 50-page regression requires output before page 3, a single paragraph, and peak page buffering of 1. No complete cross-page paragraph or table is accumulated.

## Fixtures and review

The formerly skipped ten Notes/column/page assertions now run normally. The control fixture still protects distinct paragraphs and real tables. New column-code coverage checks one-flow prose, exact code indentation and no duplicated comment. Spanning-rows covers wrapped middle content, header repetition, a wrapped footer and a following paragraph. Complete, independently authored HTML and Markdown targets cover spanning-rows, column-code and wrapped-notes as well as the existing rich-content and product fixtures. Fixtures can cover many interacting features; their manifests list those features, and targeted assertions aid diagnosis.

The critical real-document corpus is a regression guide, not a complete oracle. The changes solve the bounded reproductions; they do not claim to fix every corresponding seam in the original municipal or research PDFs. In the current corpus comparison, existing output changes for the accepted rich-content Markdown representation and retention of four standalone dashes previously dropped from the research paper; new complete fixtures appear as new documents. Existing research code, Figure 2 styling, product output and municipal table checks remain active.

During development, broad two-column reordering disrupted a research list and broad recognition of repeated PDF move commands altered unrelated table inference. Those expansions were removed. The new inference rules use the existing supported ruled-path representation; general path normalization remains separate work.

## Review follow-up

Verified review findings tightened the bounded implementation:

- If height-filtered column traversal cannot be established, retain the inferred table instead of emitting interleaved prose. Candidate word counts use the existing geometry-aware span joiner. Code lines must not be joined across a paragraph's column seam; inline monospace text does not by itself make a prose line code.
- Full-width ruled bands use contiguous combined line geometry with the same column-start tolerance as ordinary cells. Separate later-column values keep their cells. Divider scans are gated by the cheap spanning checks.
- Wrapped footer candidates reject list markers and intervening rules. Their bounds cover all joined lines. Wrapped words and page seams use the established lexical/nonlexical hyphen policy.
- A page-ending Markdown spanning row closes the table but may carry only its header row to an adjacent, matching, headerless fragment. That fragment starts a new table with the established headers. Intervening content or a new header prevents inheritance.
- Rowspan tables take the HTML fallback before any Markdown continuation; occupied columns beneath rowspans are not padded with extra cells. Repeated carried headers are suppressed even when the new page has only nonnumeric data.
- Preview entries are deduplicated, stale skip messaging and environment wiring are removed, and complete-fixture documentation explicitly describes the Markdown-specific italic boundary marker.

Deliberately retained limits: a four-line inference ceiling avoids treating arbitrary regions as a single spanning paragraph; broadening it needs further evidence. Sentence-ending punctuation alone does not imply a new paragraph, so it does not break a geometrically coherent wrapped footer. The Notes rule remains based on combined borderless/short-bold-label/unbold-wrapped-value evidence; we did not add vocabulary-specific labels or turn arbitrary bold first columns into definitions. The complete fixture and ruled/header counterexamples define its current scope.

Second review: standalone dashes are retained; the older short-tail repair stays confined to its existing paragraph path, while new footer joins use explicit hyphen evidence only. Panel ownership is computed once after table fallback decisions. Media captions clear carried table headers. Page-seam hyphen trimming updates semantic span metadata so inline formatting survives.

Final review: a prose table is removed only when all its original spans actually enter the reordered region; retained tables are restored before re-evaluating the remaining candidates. This protects a table outside a separate accepted three-column band. Marked column seams use explicit hyphen evidence rather than the older short-tail repair. HTML rowspan occupancy is restricted to its rendered row group so a header span cannot shift body values left.

A short string can still occupy a full-width cell. Text reaching the final column is not required when a contiguous ruled-band paragraph has no vertical divider anywhere across the band and no independent later-column value. Requiring the text itself to reach the final column would confuse content width with cell width; the existing divider and independent-cell controls remain the relevant boundaries.
