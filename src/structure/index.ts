import type { ExtractedPage, Rect, TextSpan } from "../types.js";
import { inferSemanticBlocks, type SemanticBlock } from "./semantic.js";

export type { SemanticBlock } from "./semantic.js";

export interface StructureInference {
  confidence: number;
  reasons: string[];
}

export interface TextLine extends StructureInference {
  type: "line";
  bounds: Rect;
  text: string;
  spans: TextSpan[];
}

export interface TableCell extends StructureInference {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  bounds: Rect;
  text: string;
  spans: TextSpan[];
}

export interface Table extends StructureInference {
  type: "table";
  page: number;
  bounds: Rect;
  columns: number[];
  cells: TableCell[];
}

export interface StructuredPage {
  page: number;
  lines: TextLine[];
  tables: Table[];
  blocks: SemanticBlock[];
}

export interface StructureOptions {
  lineTolerance?: number;
  columnTolerance?: number;
  minimumTableRows?: number;
  minimumTableColumns?: number;
}

export function structurePage(page: ExtractedPage, options: StructureOptions = {}): StructuredPage {
  const lineTolerance = options.lineTolerance ?? 2;
  const lines = groupLines(page.spans, lineTolerance);
  const tables = inferTables(page.number, lines, options);
  return {
    page: page.number,
    lines,
    tables,
    blocks: inferSemanticBlocks(lines, tables),
  };
}

export function tableToRows(table: Table): string[][] {
  const rowCount = Math.max(0, ...table.cells.map((cell) => cell.row + cell.rowSpan));
  const columnCount = Math.max(0, ...table.cells.map((cell) => cell.column + cell.columnSpan));
  const rows = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ""),
  );
  for (const cell of table.cells) {
    const row = rows[cell.row];
    if (row) row[cell.column] = cell.text;
  }
  return rows;
}

export function tableToCsv(table: Table): string {
  return tableToRows(table)
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

export function tableToHtml(table: Table): string {
  const rows = tableToRows(table);
  const header = tableHasHeader(table);
  return `<table>${rows
    .map((row, index) => {
      const cell = header && index === 0 ? "th" : "td";
      return `<tr>${row.map((value) => `<${cell}>${escapeHtml(value)}</${cell}>`).join("")}</tr>`;
    })
    .join("")}</table>`;
}

function tableHasHeader(table: Table): boolean {
  const rows = tableToRows(table);
  const first = rows[0] ?? [];
  const rest = rows.slice(1).flat();
  return (
    first.length > 0 &&
    first.every((value) => /\p{L}/u.test(value) && !isNumericField(value)) &&
    rest.some(isNumericField)
  );
}

function isNumericField(value: string): boolean {
  return /^(?:\p{Sc}\s*)?[\d.,'’\s]+(?:\s*%)?$/u.test(value.trim());
}

function groupLines(spans: TextSpan[], tolerance: number): TextLine[] {
  const horizontal = groupHorizontalLines(
    spans.filter((span) => span.direction !== "ttb"),
    tolerance,
  );
  const vertical = groupVerticalLines(
    spans.filter((span) => span.direction === "ttb"),
    tolerance,
  );
  return [...horizontal, ...vertical];
}

function groupHorizontalLines(spans: TextSpan[], tolerance: number): TextLine[] {
  const rows: TextSpan[][] = [];
  for (const span of spans) {
    const row = rows.at(-1);
    const previous = row?.at(-1);
    const sameBaseline = Math.abs((row?.[0]?.bounds.y ?? Number.NaN) - span.bounds.y) <= tolerance;
    const continuesForward =
      !previous ||
      span.bounds.x >= previous.bounds.x - Math.max(tolerance, previous.fontSize * 0.25);
    if (row && sameBaseline && continuesForward) row.push(span);
    else rows.push([span]);
  }

  return rows.map((row) => {
    row.sort((left, right) => left.bounds.x - right.bounds.x);
    return {
      type: "line",
      bounds: union(row.map((span) => span.bounds)),
      text: joinSpans(row),
      spans: row,
      confidence: 1,
      reasons: ["shared-baseline"],
    };
  });
}

function groupVerticalLines(spans: TextSpan[], tolerance: number): TextLine[] {
  const columns: TextSpan[][] = [];
  for (const span of [...spans].sort(
    (left, right) => right.bounds.x - left.bounds.x || right.bounds.y - left.bounds.y,
  )) {
    const column = columns.find(
      (candidate) => Math.abs((candidate[0]?.bounds.x ?? 0) - span.bounds.x) <= tolerance,
    );
    if (column) column.push(span);
    else columns.push([span]);
  }
  return columns.map((column) => {
    column.sort((left, right) => right.bounds.y - left.bounds.y);
    return {
      type: "line",
      bounds: union(column.map((span) => span.bounds)),
      text: column.map((span) => span.text).join(""),
      spans: column,
      confidence: 1,
      reasons: ["shared-vertical-axis"],
    };
  });
}

function inferTables(page: number, lines: TextLine[], options: StructureOptions): Table[] {
  const minimumRows = options.minimumTableRows ?? 2;
  const minimumColumns = options.minimumTableColumns ?? 2;
  const columnTolerance = options.columnTolerance ?? 16;
  const rowCandidates = lines.map((line) => ({ line, cells: splitCells(line) }));
  const runs: Array<typeof rowCandidates> = [];
  let run: typeof rowCandidates = [];
  for (const candidate of rowCandidates) {
    const first = run[0];
    const compatible = !first || compatibleRows(first, candidate, columnTolerance);
    if (candidate.cells.length >= minimumColumns && compatible) run.push(candidate);
    else {
      if (run.length >= minimumRows) runs.push(run);
      run = candidate.cells.length >= minimumColumns ? [candidate] : [];
    }
  }
  if (run.length >= minimumRows) runs.push(run);

  return runs.map((rows) => {
    const columns = (rows[0]?.cells ?? []).map((cell) => cell.bounds.x);
    const cells = rows.flatMap((candidate, row) =>
      candidate.cells.map((cell, column) => ({
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        bounds: cell.bounds,
        text: joinSpans(cell.spans),
        spans: cell.spans,
        confidence: 0.9,
        reasons: ["repeated-column-alignment"],
      })),
    );
    return {
      type: "table",
      page,
      bounds: union(cells.map((cell) => cell.bounds)),
      columns,
      cells,
      confidence: 0.9,
      reasons: ["consecutive-rows", "repeated-column-alignment"],
    };
  });
}

function splitCells(line: TextLine): Array<{ bounds: Rect; spans: TextSpan[] }> {
  const cells: TextSpan[][] = [];
  for (const span of line.spans) {
    const current = cells.at(-1);
    const previous = current?.at(-1);
    const gap = previous ? span.bounds.x - previous.bounds.x - previous.bounds.width : 0;
    if (current && previous && gap <= Math.max(18, span.fontSize * 2)) current.push(span);
    else cells.push([span]);
  }
  return cells.map((spans) => ({ bounds: union(spans.map((span) => span.bounds)), spans }));
}

function compatibleRows(
  first: { cells: Array<{ bounds: Rect }> },
  next: { cells: Array<{ bounds: Rect }> },
  tolerance: number,
): boolean {
  return (
    first.cells.length === next.cells.length &&
    first.cells.every((cell, index) => {
      const other = next.cells[index]?.bounds;
      if (!other) return false;
      const leftAligned = Math.abs(cell.bounds.x - other.x) <= tolerance;
      const rightAligned =
        Math.abs(cell.bounds.x + cell.bounds.width - other.x - other.width) <= tolerance;
      return leftAligned || rightAligned;
    })
  );
}

function joinSpans(spans: TextSpan[]): string {
  let output = "";
  let previous: TextSpan | undefined;
  for (const span of spans) {
    if (previous && shouldInsertSpace(previous, span)) output += " ";
    output += span.text;
    previous = span;
  }
  return output.trim();
}

function shouldInsertSpace(previous: TextSpan, current: TextSpan): boolean {
  if (/\s$/u.test(previous.text) || /^\s/u.test(current.text)) return false;
  if (current.hasLeadingSpace) return true;
  const continuation = /[-‐‑‒–—([{/]$/u.test(previous.text);
  const closingPunctuation = /^[,.;:!?%)\]}]/u.test(current.text);
  if (continuation || closingPunctuation) return false;
  const gap = current.bounds.x - (previous.bounds.x + previous.bounds.width);
  if (gap > current.fontSize) return true;
  const tokenBoundary = [...previous.text].length > 1 || [...current.text].length > 1;
  return gap > current.fontSize * 0.2 && tokenBoundary;
}

function union(rectangles: Rect[]): Rect {
  if (rectangles.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const bottom = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const top = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
