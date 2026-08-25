# PDF.js oracle tests

This suite compares `@boxpdf/reader` page output with PDF.js. Corpus tests cover
normalized decoded characters, page geometry, and first-span position. Focused
generated cases compare complete single-span geometry, including width, height,
font size, and transformed position. Span boundaries across general PDFs are
not an exact oracle because readers may combine adjacent glyphs differently.
