import { writeFile } from "node:fs/promises";
import { cleanTheme, flowToPdf, hstack, standardFonts, text, vstack } from "@boxpdf/writer";

const pageWidth = 515;
const gap = 18;
const columnWidth = (pageWidth - gap * 2) / 3;
const columns = [
  [
    "ALPHA ONE opens the first narrative.",
    "ALPHA TWO continues directly below it.",
    "ALPHA THREE preserves the left flow.",
    "ALPHA FOUR remains ahead of the center.",
    "ALPHA FIVE approaches the conclusion.",
    "ALPHA SIX closes the first column.",
  ],
  [
    "BRAVO ONE starts only after Alpha ends.",
    "BRAVO TWO continues the center narrative.",
    "BRAVO THREE stays inside its own region.",
    "BRAVO FOUR must not interleave with Alpha.",
    "BRAVO FIVE remains ahead of Charlie.",
    "BRAVO SIX closes the second column.",
  ],
  [
    "CHARLIE ONE begins the final narrative.",
    "CHARLIE TWO follows inside the right region.",
    "CHARLIE THREE remains geometrically separate.",
    "CHARLIE FOUR must follow every Bravo line.",
    "CHARLIE FIVE approaches the document end.",
    "CHARLIE SIX closes the third column.",
  ],
];

const bytes = await flowToPdf(
  async (pdf) => {
    const theme = cleanTheme(await standardFonts(pdf));
    return [
      vstack(
        { gap: 18, width: pageWidth },
        text("Three-column reading-flow adversary", theme.type.h1),
        text(
          "The PDF paints each horizontal band left-to-right, while semantic reading order must traverse each sustained visual column top-to-bottom.",
          { ...theme.type.body, width: pageWidth },
        ),
        vstack(
          { gap: 8, width: pageWidth },
          ...columns[0].map((_, row) =>
            hstack(
              { gap, width: pageWidth, align: "start" },
              ...columns.map((column) =>
                text(column[row], { ...theme.type.bodySmall, width: columnWidth }),
              ),
            ),
          ),
        ),
      ),
    ];
  },
  {
    margin: 40,
    title: "Three-column reading-flow adversary",
    author: "BoxPDF semantic fixture generator",
    creator: "@boxpdf/writer",
    producer: "@boxpdf/writer",
  },
);

await writeFile(new URL("../fixtures/semantic/three-column-flow.pdf", import.meta.url), bytes);
console.log(`wrote fixtures/semantic/three-column-flow.pdf (${bytes.byteLength} bytes)`);
