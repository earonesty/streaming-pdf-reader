# PDF.js oracle tests

This suite compares normalized `@boxpdf/reader` page output with PDF.js. It
will compare decoded characters, positioned characters, page geometry, raw
content order, bytes read, and peak memory. Span boundaries are not an exact
oracle because readers may combine adjacent glyphs differently.
