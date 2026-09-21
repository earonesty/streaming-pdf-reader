import type { ExtractedPage, Rect, TextSpan, VectorFill } from "../types.js";
import type { Table, TableCell, TextLine } from "./index.js";

/** Infer tables whose horizontal rules define rows even when columns have no borders. */
export function inferRuledTables(page: ExtractedPage, lines: TextLine[]): Table[] {
  const rules = horizontalRules(page);
  if (rules.length < 3) return [];
  const bands = rules
    .slice(0, -1)
    .map((top, index) => ({ top, bottom: rules[index + 1] ?? top }))
    .filter(({ top, bottom }) => top - bottom > 2)
    .map((band) => ({
      ...band,
      lines: lines.filter((line) => {
        const center = line.bounds.y + line.bounds.height / 2;
        return center < band.top && center > band.bottom;
      }),
    }))
    .filter((band) => band.lines.length > 0);
  if (bands.length < 2) return [];

  const columns = headerColumnStarts(bands[0]?.lines ?? []);
  if (columns.length < 2) return [];
  const cells = bands.flatMap((band, row) => rowCells(band.lines, row, columns));
  if (cells.length < columns.length + 1) return [];
  return [
    {
      type: "table",
      page: page.number,
      bounds: union(cells.map((cell) => cell.bounds)),
      columns,
      cells,
      confidence: 0.98,
      reasons: ["horizontal-row-rules", "header-column-alignment"],
    },
  ];
}

function horizontalRules(page: ExtractedPage): number[] {
  const maximumThickness = Math.max(2, page.height * 0.003);
  const minimumWidth = page.width * 0.5;
  const candidates = (page.fills ?? [])
    .map(fillBounds)
    .filter((bounds) => bounds.width >= minimumWidth && bounds.height <= maximumThickness)
    .map((bounds) => bounds.y + bounds.height / 2)
    .sort((left, right) => right - left);
  const output: number[] = [];
  for (const value of candidates) {
    if (!output.some((existing) => Math.abs(existing - value) <= maximumThickness))
      output.push(value);
  }
  return output;
}

function headerColumnStarts(lines: TextLine[]): number[] {
  const starts: number[] = [];
  for (const line of lines) {
    const spans = [...line.spans].sort((left, right) => left.bounds.x - right.bounds.x);
    for (const [index, span] of spans.entries()) {
      const previous = spans[index - 1];
      const gap = previous
        ? span.bounds.x - previous.bounds.x - previous.bounds.width
        : Number.POSITIVE_INFINITY;
      if (!previous || gap > Math.max(6, span.fontSize * 0.5)) starts.push(span.bounds.x);
    }
  }
  starts.sort((left, right) => left - right);
  const merged: number[] = [];
  for (const start of starts) {
    if (!merged.some((existing) => Math.abs(existing - start) <= 8)) merged.push(start);
  }
  return merged;
}

function rowCells(lines: TextLine[], row: number, columns: number[]): TableCell[] {
  const cellLines = columns.map(() => [] as TextSpan[][]);
  for (const line of lines) {
    const grouped = columns.map(() => [] as TextSpan[]);
    for (const span of line.spans) grouped[columnIndex(span.bounds.x, columns)]?.push(span);
    for (const [column, spans] of grouped.entries()) {
      if (spans.length > 0) cellLines[column]?.push(spans);
    }
  }
  return cellLines.flatMap((parts, column) => {
    if (parts.length === 0) return [];
    parts.sort(
      (left, right) =>
        (right[0]?.bounds.y ?? 0) - (left[0]?.bounds.y ?? 0) ||
        (left[0]?.bounds.x ?? 0) - (right[0]?.bounds.x ?? 0),
    );
    const spans = parts.flatMap((part) =>
      [...part].sort((left, right) => left.bounds.x - right.bounds.x),
    );
    const text = parts
      .map((part) => joinSpans([...part].sort((left, right) => left.bounds.x - right.bounds.x)))
      .join(" ");
    return [
      {
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        bounds: union(spans.map((span) => span.bounds)),
        text,
        spans,
        confidence: 0.98,
        reasons: ["bounded-by-horizontal-rules", "header-column-alignment"],
      },
    ];
  });
}

function columnIndex(x: number, columns: number[]): number {
  let column = 0;
  for (let index = 1; index < columns.length; index += 1) {
    if (x >= (columns[index] ?? 0) - 2) column = index;
  }
  return column;
}

function fillBounds(fill: VectorFill): Rect {
  return union(fill.points.map(([x, y]) => ({ x, y, width: 0, height: 0 })));
}

function joinSpans(spans: TextSpan[]): string {
  let output = "";
  let previous: TextSpan | undefined;
  for (const span of spans) {
    const gap = previous ? span.bounds.x - previous.bounds.x - previous.bounds.width : 0;
    if (
      previous &&
      !/\s$/u.test(previous.text) &&
      !/^\s/u.test(span.text) &&
      gap > span.fontSize * 0.18
    )
      output += " ";
    output += span.text;
    previous = span;
  }
  return output.trim();
}

function union(rectangles: Rect[]): Rect {
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const bottom = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const top = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}
