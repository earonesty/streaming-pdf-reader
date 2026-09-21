import type { ExtractedPage, Rect, TextSpan, VectorFill, VectorPath } from "../types.js";
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

  const ruledColumns = verticalRuleColumnStarts(page.paths ?? [], rules[0] ?? 0, rules.at(-1) ?? 0);
  const columns =
    ruledColumns.length >= 2 ? ruledColumns : headerColumnStarts(bands[0]?.lines ?? []);
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
  const filledCandidates = (page.fills ?? [])
    .map(fillBounds)
    .filter((bounds) => bounds.width >= minimumWidth && bounds.height <= maximumThickness)
    .map((bounds) => bounds.y + bounds.height / 2);
  const strokedCandidates = groupedHorizontalPathRules(
    page.paths ?? [],
    minimumWidth,
    maximumThickness,
  );
  const candidates = [...filledCandidates, ...strokedCandidates].sort(
    (left, right) => right - left,
  );
  const output: number[] = [];
  for (const value of candidates) {
    if (!output.some((existing) => Math.abs(existing - value) <= maximumThickness))
      output.push(value);
  }
  return output;
}

function groupedHorizontalPathRules(
  paths: VectorPath[],
  minimumWidth: number,
  tolerance: number,
): number[] {
  const segments = paths.flatMap((path) => {
    if (!path.stroke || (path.strokeOpacity ?? 1) === 0) return [];
    const segment = simpleLineSegment(path.d);
    if (!segment || Math.abs(segment.y1 - segment.y2) > tolerance) return [];
    return [
      {
        y: (segment.y1 + segment.y2) / 2,
        left: Math.min(segment.x1, segment.x2),
        right: Math.max(segment.x1, segment.x2),
      },
    ];
  });
  const groups: Array<typeof segments> = [];
  for (const segment of segments) {
    const group = groups.find(
      (candidate) => Math.abs((candidate[0]?.y ?? 0) - segment.y) <= tolerance,
    );
    if (group) group.push(segment);
    else groups.push([segment]);
  }
  return groups
    .filter(
      (group) => coveredWidth(group.map(({ left, right }) => ({ left, right }))) >= minimumWidth,
    )
    .map((group) => group.reduce((sum, segment) => sum + segment.y, 0) / group.length);
}

function verticalRuleColumnStarts(paths: VectorPath[], top: number, bottom: number): number[] {
  const tolerance = 2;
  const segments = paths.flatMap((path) => {
    if (!path.stroke || (path.strokeOpacity ?? 1) === 0) return [];
    const segment = simpleLineSegment(path.d);
    if (!segment || Math.abs(segment.x1 - segment.x2) > tolerance) return [];
    return [
      {
        x: (segment.x1 + segment.x2) / 2,
        left: Math.min(segment.y1, segment.y2),
        right: Math.max(segment.y1, segment.y2),
      },
    ];
  });
  const groups: Array<typeof segments> = [];
  for (const segment of segments) {
    const group = groups.find(
      (candidate) => Math.abs((candidate[0]?.x ?? 0) - segment.x) <= tolerance,
    );
    if (group) group.push(segment);
    else groups.push([segment]);
  }
  const tableHeight = Math.abs(top - bottom);
  const boundaries = groups
    .filter(
      (group) =>
        coveredWidth(group.map(({ left, right }) => ({ left, right }))) >= tableHeight - tolerance,
    )
    .map((group) => group.reduce((sum, segment) => sum + segment.x, 0) / group.length)
    .sort((left, right) => left - right);
  return boundaries.slice(0, -1);
}

function simpleLineSegment(
  d: string,
): { x1: number; y1: number; x2: number; y2: number } | undefined {
  const match = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)$/u.exec(d);
  if (!match) return undefined;
  const [, x1, y1, x2, y2] = match;
  return { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) };
}

function coveredWidth(intervals: Array<{ left: number; right: number }>): number {
  const ordered = [...intervals].sort((left, right) => left.left - right.left);
  let width = 0;
  let start = 0;
  let end = 0;
  for (const interval of ordered) {
    if (interval.left > end + 2) {
      width += Math.max(0, end - start);
      start = interval.left;
      end = interval.right;
    } else {
      end = Math.max(end, interval.right);
    }
  }
  return width + Math.max(0, end - start);
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
