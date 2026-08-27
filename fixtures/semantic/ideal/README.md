# Ideal semantic HTML oracles

These files describe the lossless semantic HTML a high-quality PDF-to-HTML
converter should produce. They are the semantic target; they are not snapshots
of the current extractor.

Each oracle was authored by a fresh reviewer from rendered PDF pages without
seeing reader output, source code, tests, or the older assertion manifest. The
reviewer was asked to preserve meaningful content and reading order, use native
HTML elements, and omit repeated page furniture.

Lossless means every meaningful word and relationship survives: reading order,
section nesting, list membership, table rows, labels and values, code lines,
figures, and captions. An oracle may add short accessible labels that are
implicit in the design. It must never summarize, condense, paraphrase, or invent
document content. The only intentional omissions are repeated page furniture
and purely decorative marks.

Raster content belongs in an `img` with a real `src` and useful `alt`. PDF
vector artwork belongs in inline
`svg`. Until the visual asset itself is checked in, a figure is explicitly
marked `data-visual-required="true"`; this is a failing implementation target,
not permission to emit a broken or empty image.

The legacy `../manifest.json` remains a narrow extraction smoke contract while
the renderer is migrated to DOM-level comparison against these oracles. New
semantic capabilities must be specified here first.
