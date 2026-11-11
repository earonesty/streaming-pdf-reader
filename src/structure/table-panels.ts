import type { ExtractedPage, Rect } from "../types.js";
import type { Table, TextLine } from "./index.js";

/** Attach caption/footer only when a closed, stroked panel encloses the table. */
export function attachTablePanels(page: ExtractedPage, tables: Table[], lines: TextLine[]): void {
  if (page.rotate !== 0) return;
  const panels = (page.paths ?? [])
    .filter((path) => path.stroke && /Z$/i.test(path.d))
    .flatMap((path) => {
      const numbers = path.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      if (numbers.length < 8 || numbers.length % 2) return [];
      const xs = numbers.filter((_, i) => i % 2 === 0);
      const ys = numbers.filter((_, i) => i % 2 === 1);
      return [
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
      ];
    });
  const assigned = new Set(tables.flatMap((table) => table.cells.flatMap((cell) => cell.spans)));
  for (const table of tables) {
    const panel = panels
      .filter(
        (panel) =>
          contains(panel, table.bounds) &&
          panel.width < table.bounds.width * 1.3 &&
          panel.height < table.bounds.height * 2.5,
      )
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (!panel) continue;
    const extras = lines.filter(
      (line) => contains(panel, line.bounds) && !line.spans.some((span) => assigned.has(span)),
    );
    const above = extras.filter((line) => line.bounds.y >= table.bounds.y + table.bounds.height);
    const below = extras.filter((line) => line.bounds.y + line.bounds.height <= table.bounds.y);
    if (above.length === 1 && above[0]?.spans.every((span) => /bold/i.test(span.fontFamily ?? "")))
      table.caption = above;
    // A single wide line inside the same panel is a spanning footer,
    // not a cell in whichever column its final inline run happens to reach.
    if (below.length === 1 && below[0] && below[0].bounds.width > table.bounds.width * 0.6) {
      const line = below[0];
      table.cells.push({
        row: Math.max(...table.cells.map((cell) => cell.row)) + 1,
        column: 0,
        rowSpan: 1,
        columnSpan: table.columns.length,
        bounds: line.bounds,
        text: line.text,
        spans: line.spans,
        confidence: 0.9,
        reasons: ["enclosed-spanning-footer"],
      });
      for (const span of line.spans) assigned.add(span);
    }
  }
}
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
