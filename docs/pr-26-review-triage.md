# PR 26 automated review triage

Review comments were checked against code and the user's accepted semantics. Duplicate findings from Cubic and CodeRabbit are grouped here. Automated recommendations are not acceptance criteria.

## Confirmed and addressed

- Optional annotations/actions: null and non-dictionary values are skipped; dangling xref entries are ignored for optional link data, while unrelated resource/I/O errors still propagate. Rectangle members resolve indirectly. Link geometry uses the text transform and attachment precedes bidi relocation. Mixed RTL citation normalization retains its established text ordering; when collapsing differently linked chunks, it omits the URI instead of applying one chunk’s link to the whole line.
- Link formatting: Markdown escapes entity-like ampersands and backslashes. Table headers use the same span-aware formatter as body cells. Panel and ordinary tables share header inference.
- Table panels: use the original page rotation guard, ignore invisible strokes, evaluate separate closed subpaths, reserve caption ownership in reading order, require a horizontal separator before absorbing a footer, and retain captioned tables instead of converting them into definition lists. Captioned HTML tables remain open for compatible continuation; Markdown tables that start with a panel remain HTML for that continuation.
- Complete comparisons: preserve inline word spacing and all preformatted whitespace, while ignoring layout whitespace between block elements. Promoted target HTML is also parsed for structural errors. Fixture acquisition now closes its file if PDF opening fails.
- Review checks: inline fragments remain adjacent; label/value checks cannot match across unrelated paragraphs/divs; C1 controls are rejected; definition values retain interior spaces; table snapshots include caption association.
- Draft Markdown: irregular row widths, rowspan, and unsupported body header positions fall back to raw HTML. Added adversarial cases.
- Preview: remove only the current fixture's old numbered PNGs, match exact page names, and omit full document snapshots from the findings payload.
- Documentation: distinguish enforced complete fixtures and verified contracts from advisory drafts; build before baseline capture; record 22 preview documents and fixture-specific approval decisions. Remove Figure 2's stale media-required marker and avoid claiming SVG fidelity from caption tests alone. The skipped Notes reproduction now requires the entire value before the next section. Reproduction uses a portable Node launcher.

## Deliberately retained or deferred

- **Figure 2 divider and styling:** retained. The user explicitly preferred the horizontal divider, bold figure number and italic caption. Removing it would reverse an accepted semantic presentation decision. The research reference remains advisory.
- **Full diagram transcript:** deferred. The user rejected treating a complex research-paper draft as a complete authoritative oracle. The crop and summary alt text remain a visual aid; no claim of complete machine-readable diagram content is made.
- **Generic bold first-column text as row headers:** not adopted. Bold text alone is insufficient evidence of a row-label relationship. Product cards already use explicit row headers in their dedicated renderer, and complete expectations cover both output formats.
- **Glyph-level partial-span link splitting:** deferred. Accurate splitting needs character geometry across encodings and ligatures; proportional slicing would invent precision. This release conservatively leaves a partially covered chunk unlinked rather than linking neighboring words. Full-chunk annotations allow small font-metric tolerance, covered by the existing product fixture.
- **Wrapped spanning footers:** deferred. The supported case is a single line with enclosure and separator evidence. Grouping adjacent lines is a new inference rule requiring its own reviewed fixture, not an automatic extension of this bounded fix.
- **Markdown table representation changing mid-continuation:** GFM cannot express a later colspan. Such a continuation remains separate when the initial table was already streamed as native GFM; tables beginning in raw HTML continue in HTML. HTML output preserves compatible continuations. Converting an already-emitted GFM table requires buffering or a broader output-policy change.

The release's previously skipped column/page/Notes reproductions remain skipped; review fixes do not waive any additional existing checks.

## Second review pass

- Reproduced and fixed financial summaries emitted as literal GFM pipe rows inside an open raw-HTML table. Such summaries now emit HTML tfoot rows; native GFM tables retain their existing representation.
- Reproduced partly linked mixed-RTL citations bypassing the established text reorder. Restored the reorder while conservatively omitting ambiguous link ownership on the collapsed line. This is the same bounded policy as deferred glyph-level link splitting, not a claim of complete partly linked RTL support.
- Fixed the gate-policy pronoun and empty-caption definition-list condition. Scoped the source-literal anchor lint exception to its table cell.
- Deferred sharing header inference across packages. The writer deliberately adds bold-header evidence to the numeric-content rule, while the older structure serializer retains its existing behavior. The duplicated numeric predicate is a maintainability concern, not a demonstrated new output defect; changing public structure exports or broadening the legacy serializer is outside this correction. Existing writer tests cover regular-weight inferred and bold nonnumeric headers.

Both runtime cases have regression tests that failed before these fixes. CI's full quality pipeline passed on 8a818ce before this follow-up.
