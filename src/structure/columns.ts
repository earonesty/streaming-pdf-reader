import type { ExtractedPage, Rect, TextSpan } from "../types.js";
import type { Table, TextLine } from "./index.js";

const MAX_READING_COLUMNS = 4;

interface ReadingColumnLayout {
  starts: number[];
  bottom: number;
  top: number;
}

interface ColumnCandidate {
  bounds: Rect;
}

export function orderReadingColumns(
  page: ExtractedPage,
  lines: TextLine[],
  tables: Table[],
  lineFromSpans: (spans: TextSpan[]) => TextLine,
): TextLine[] {
  const tableSpans = new Set(tables.flatMap((table) => table.cells.flatMap((cell) => cell.spans)));
  const candidates = lines
    .filter((line) => !line.spans.some((span) => tableSpans.has(span)))
    .flatMap((line) => columnCandidates(line, page.width));
  const layout = sustainedColumnLayout(candidates, page.width);
  // Two-region pages remain deliberately conservative because label/value
  // sections and borderless two-column tables are geometrically ambiguous.
  // Three or four sustained regions are rare and provide much stronger
  // presentation-column evidence once known tables have been excluded.
  if (!layout || layout.starts.length < 3 || layout.starts.length > MAX_READING_COLUMNS)
    return lines;
  const { starts } = layout;

  const gutters = starts.slice(1).map((start, index) => {
    const previous = starts[index] ?? 0;
    const rightEdges = candidates
      .filter((line) => nearestColumn(line.bounds.x, starts) === index)
      .map((line) => Math.min(start, line.bounds.x + line.bounds.width));
    const right = Math.max(previous, ...rightEdges.filter((edge) => edge < start));
    return (right + start) / 2;
  });

  const output: TextLine[] = [];
  let region: TextLine[] = [];
  const flush = () => {
    if (region.length === 0) return;
    const columns = starts.map(() => [] as TextLine[]);
    for (const line of region) {
      for (const segment of splitLineAtColumns(line, starts, lineFromSpans)) {
        columns[nearestColumn(segment.bounds.x, starts)]?.push(segment);
      }
    }
    for (const column of columns) {
      column.sort(
        (left, right) => right.bounds.y - left.bounds.y || left.bounds.x - right.bounds.x,
      );
      output.push(...column);
    }
    region = [];
  };

  for (const line of lines) {
    const centerY = line.bounds.y + line.bounds.height / 2;
    const isTableLine = line.spans.some((span) => tableSpans.has(span));
    const isOutsideColumnBand = centerY < layout.bottom || centerY > layout.top;
    const crossesGutter = line.spans.some((span) =>
      gutters.some((gutter) => crossesX(span.bounds, gutter)),
    );
    if (isTableLine || isOutsideColumnBand || crossesGutter) {
      flush();
      output.push(line);
    } else {
      region.push(line);
    }
  }
  flush();
  return output;
}

function columnCandidates(line: TextLine, pageWidth: number): ColumnCandidate[] {
  const spans = [...line.spans].sort((left, right) => left.bounds.x - right.bounds.x);
  const typicalHeight = median(spans.map((span) => span.bounds.height));
  const minimumRunGap = Math.max(8, pageWidth * 0.015, typicalHeight * 1.25);
  const runs: TextSpan[][] = [];
  for (const span of spans) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    const gap = previous ? span.bounds.x - previous.bounds.x - previous.bounds.width : 0;
    if (run && gap < minimumRunGap) run.push(span);
    else runs.push([span]);
  }
  return runs.map((run) => ({ bounds: union(run.map((span) => span.bounds)) }));
}

function sustainedColumnLayout(
  lines: ColumnCandidate[],
  pageWidth: number,
): ReadingColumnLayout | undefined {
  const tolerance = Math.max(4, pageWidth * 0.015);
  const minimumGap = pageWidth * 0.12;
  const minimumSupport = Math.max(4, Math.ceil(lines.length * 0.12));
  const clusters: Array<{ x: number; lines: ColumnCandidate[] }> = [];
  for (const line of lines) {
    const match = clusters.find((cluster) => Math.abs(cluster.x - line.bounds.x) <= tolerance);
    if (match) {
      match.lines.push(line);
      match.x = median(match.lines.map((item) => item.bounds.x));
    } else clusters.push({ x: line.bounds.x, lines: [line] });
  }
  const supported = clusters
    .filter((cluster) => cluster.lines.length >= minimumSupport)
    .sort((left, right) => left.x - right.x);
  const separated: typeof supported = [];
  for (const cluster of supported) {
    const previous = separated.at(-1);
    if (!previous || cluster.x - previous.x >= minimumGap) separated.push(cluster);
    else if (cluster.lines.length > previous.lines.length)
      separated[separated.length - 1] = cluster;
  }
  if (separated.length < 2 || separated.length > MAX_READING_COLUMNS) return undefined;
  const overlapBottom = Math.max(
    ...separated.map((cluster) => Math.min(...cluster.lines.map((line) => line.bounds.y))),
  );
  const overlapTop = Math.min(
    ...separated.map((cluster) =>
      Math.max(...cluster.lines.map((line) => line.bounds.y + line.bounds.height)),
    ),
  );
  const lineHeight = median(
    separated.flatMap((cluster) => cluster.lines.map((line) => line.bounds.height)),
  );
  if (overlapTop - overlapBottom < lineHeight * 3) return undefined;
  const minimumGutter = Math.max(8, pageWidth * 0.015);
  for (let index = 1; index < separated.length; index += 1) {
    const left = separated[index - 1];
    const right = separated[index];
    if (!left || !right) return undefined;
    const rightEdges = left.lines
      .map((line) => line.bounds.x + line.bounds.width)
      .filter((edge) => edge < right.x)
      .sort((a, b) => a - b);
    const sustainedRightEdge = rightEdges[Math.floor(rightEdges.length * 0.8)];
    if (sustainedRightEdge === undefined || right.x - sustainedRightEdge < minimumGutter)
      return undefined;
  }
  return {
    starts: separated.map((cluster) => cluster.x),
    // Wrapped final lines do not always occur in every column. Keep a small
    // line-height margin around the shared core without admitting distant
    // headers and footers into the traversal region.
    bottom: overlapBottom - lineHeight * 1.5,
    top: overlapTop + lineHeight * 1.5,
  };
}

function splitLineAtColumns(
  line: TextLine,
  starts: number[],
  lineFromSpans: (spans: TextSpan[]) => TextLine,
): TextLine[] {
  const groups = starts.map(() => [] as TextSpan[]);
  for (const span of line.spans) groups[nearestColumn(span.bounds.x, starts)]?.push(span);
  return groups.filter((spans) => spans.length > 0).map(lineFromSpans);
}

function nearestColumn(x: number, starts: number[]): number {
  let nearest = 0;
  for (let index = 1; index < starts.length; index += 1) {
    if (Math.abs(x - (starts[index] ?? 0)) < Math.abs(x - (starts[nearest] ?? 0))) nearest = index;
  }
  return nearest;
}

function crossesX(bounds: Rect, x: number): boolean {
  return bounds.x < x && bounds.x + bounds.width > x;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function union(rectangles: Rect[]): Rect {
  if (rectangles.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const bottom = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const top = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}
