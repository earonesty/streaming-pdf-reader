# Independently rendered oracle media

`research-figure-2.png` is a reference crop of Figure 2 from page 2 of
`../../research-paper.pdf` (the TraceMonkey paper). It replaces a target placeholder
that listed diagram labels but omitted the arrows, nodes and visual grouping.
It is not taken from reader output and is not a rasterization of the reader SVG.
The original caption remains in the ideal HTML.

Reproduce from the repository root with Poppler:

```sh
pdftoppm -f 2 -singlefile -scale-to 2400 -x 950 -y 575 -W 755 -H 590 -png \
  fixtures/semantic/research-paper.pdf \
  fixtures/semantic/ideal/assets/research-figure-2
```

The crop includes the whole state machine and its legend, excluding the caption
(which remains semantic text). The report and preview copy this local asset so
both HTML and Markdown targets display it. A PNG reference does not require the
converter to emit PNG: its current SVG is a valid representation of the diagram.
