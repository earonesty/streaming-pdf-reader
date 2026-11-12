import type { ExtractedPage, Rect } from "../types.js";
import type { Table, TextLine } from "./index.js";
import { joinWrappedText } from "./text-join.js";

/** Attach caption/footer only when a closed, stroked panel encloses the table. */
export function attachTablePanels(page: ExtractedPage, tables: Table[], lines: TextLine[]): void {
  if (page.rotate !== 0) return;
  const panels = (page.paths ?? [])
    .filter((path) => path.stroke && (path.strokeOpacity ?? 1) > 0 && /Z$/i.test(path.d))
    .flatMap((path) => (path.d.match(/M[^M]*Z/gi) ?? []).map((d) => ({ d })))
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
  for (const table of [...tables].sort(
    (a, b) => b.bounds.y + b.bounds.height - a.bounds.y - a.bounds.height,
  )) {
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
    const below = extras
      .filter((line) => line.bounds.y + line.bounds.height <= table.bounds.y)
      .sort((a, b) => b.bounds.y - a.bounds.y);
    if (
      above.length === 1 &&
      above[0]?.spans.every((span) => /bold/i.test(span.fontFamily ?? ""))
    ) {
      table.caption = above;
      for (const span of above[0].spans) assigned.add(span);
    }
    // A wide line with up to three tightly aligned continuation lines is a footer,
    // not a cell in whichever column its final inline run happens to reach.
    if (
      below.length >= 1 &&
      below.every((line) => !/^\s*(?:[•●▪◦]|\d+[.)]\s)/u.test(line.text)) &&
      below.length <= 4 &&
      below.every(
        (line, index) =>
          index === 0 ||
          (!separatedFooter(
            page,
            { ...table, bounds: { ...table.bounds, y: below[index - 1]?.bounds.y ?? 0 } },
            line,
          ) &&
            Math.abs(line.bounds.x - (below[0]?.bounds.x ?? 0)) <= 4 &&
            Math.abs(line.bounds.height - (below[0]?.bounds.height ?? 0)) <= 1 &&
            (below[index - 1]?.bounds.y ?? 0) - line.bounds.y - line.bounds.height >= -1 &&
            (below[index - 1]?.bounds.y ?? 0) - line.bounds.y - line.bounds.height <=
              line.bounds.height * 0.8),
      ) &&
      below[0] &&
      below[0].bounds.width > table.bounds.width * 0.6 &&
      separatedFooter(page, table, below[0])
    ) {
      const first = below[0];
      const last = below.at(-1) as TextLine;
      const line = {
        ...first,
        text: below.map((item) => item.text).reduce(joinWrappedText),
        spans: below.flatMap((item) => item.spans),
        bounds: {
          x: Math.min(...below.map((item) => item.bounds.x)),
          y: last.bounds.y,
          width:
            Math.max(...below.map((item) => item.bounds.x + item.bounds.width)) -
            Math.min(...below.map((item) => item.bounds.x)),
          height: first.bounds.y + first.bounds.height - last.bounds.y,
        },
      };
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

function separatedFooter(page: ExtractedPage, table: Table, line: TextLine): boolean {
  return (page.paths ?? []).some((path) => {
    if (
      !path.stroke ||
      (path.strokeOpacity ?? 1) <= 0 ||
      !/^(?:M[-\d., ]+)+L[-\d., ]+$/.test(path.d)
    )
      return false;
    const points = [...path.d.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map((match) => [
      Number(match[1]),
      Number(match[2]),
    ]);
    const a = points.at(-2),
      b = points.at(-1);
    if (!a || !b) return false;
    const [x1 = 0, y1 = 0] = a,
      [x2 = 0, y2 = 0] = b;
    return (
      Math.abs(y1 - y2) <= 1 &&
      Math.min(x1, x2) <= table.bounds.x &&
      Math.max(x1, x2) >= table.bounds.x + table.bounds.width &&
      y1 >= line.bounds.y + line.bounds.height &&
      y1 <= table.bounds.y
    );
  });
}
