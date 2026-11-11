# Complete semantic fixtures

A fixture should be understandable, not necessarily narrow. Interacting features are valuable. Large real-world documents guide us toward examples whose complete semantics we can reason about.

Every fixture in manifest.json has complete expected HTML, separately maintained expected Markdown, a feature inventory, and recorded review evidence. The inventory explains what must survive future changes; it does not limit comparison coverage. Focused assertions may supplement complete comparisons to explain failures. Never automatically update expectations from converter output.

`pnpm semantic:report` includes these fixtures; `pnpm semantic:gate` fails on their differences. The preview calls them **Fixture** and their references **Expected**, rather than Draft. Complete expectations compare parsed trees, preserving all content, ordering, semantic tags, emphasis, links and table relationships. Presentation classes/styles, IDs, generic main/span wrappers, attribute order and ordinary whitespace are ignored; preformatted whitespace is preserved. Markdown is parsed independently, allowing equivalent Markdown syntax but not missing semantics.

Initial promotion: rich-content and order-confirmation (product cards). The existing source review and accepted output informed these expectations; the former draft targets were not simply declared authoritative. The cards retain the accepted table representation and definition-list totals, without an invented Order total heading. Markdown uses bold-colon totals and bold row labels. Rich content preserves the inset, long token, table roles, inline content and spanning footer. Its Markdown uses a blockquote for visual indentation and embedded HTML for the spanning table. Source links must remain links in both formats.

These complete assertions now pass after the links/table fixes and remain active release checks via `pnpm test:semantic-complete`. Large research and municipal documents retain evidence-backed selected checks and advisory drafts. New boundary reproductions still have selected assertions only: they are explicitly labeled Bounded fixture, not a complete expected-output fixture. Add complete expectations and a feature inventory before promoting them to this manifest.

During implementation, the rich-content cell link expectation was corrected to retain its source bold font and omit an invented aria-label that the PDF does not carry. This is a reviewed expectation correction, not an automatic snapshot update.
