# Semantic reading columns

Semantic extraction must derive rows and reading regions from page geometry. PDF content-stream
order is useful as a tie-breaker, but it is not evidence that separately painted fragments belong
to separate rows or that side-by-side text should be interleaved.

## Evidence hierarchy

1. Vector rulings or filled cell rectangles enclosing aligned text are strong table evidence.
2. Repeated horizontal row association and stable cell starts are borderless-table evidence.
3. Sustained vertical whitespace bands separating recurring text starts are reading-column
   evidence.
4. Sparse shared baselines with three or more cells are record-row evidence.
5. Content-stream order is retained when geometry remains ambiguous.

Table detection runs before presentation-column traversal so confirmed table rows remain associated.
The reader currently applies automatic column-major traversal only when three or four sustained
regions remain after known table spans are excluded. Two-region pages are deliberately conservative:
label/value sections, borderless tables, cards, and prose columns can share the same geometry. More
than four presentation columns are treated as implausible for a readable page and left unresolved
rather than inventing an order.

The three-column adversarial fixture is generated with `@boxpdf/writer` by
`scripts/generate-three-column-fixture.mjs`. The writer paints each horizontal band from left to
right, producing row-major content-stream order. Semantic output must instead traverse the two
sustained gutters as three top-to-bottom reading regions.

Border-aware scoring can strengthen table classification without changing this ordering contract.
When borders exist, path geometry should increase table confidence; their absence must never be
treated as evidence against a table.
