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

  attachSuperscriptRows(rows, tolerance);

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

function attachSuperscriptRows(rows: TextSpan[][], tolerance: number): void {
  for (let index = 1; index < rows.length; index += 1) {
    const base = rows[index - 1];
    const superscript = rows[index];
    if (!base || !superscript || !isAttachedSuperscript(base, superscript, tolerance)) continue;
    base.push(...superscript);
    rows.splice(index, 1);
    const continuation = rows[index];
    if (continuation && continuesSuperscriptLine(base, continuation, tolerance)) {
      base.push(...continuation);
      rows.splice(index, 1);
    }
    index -= 1;
  }
}

function isAttachedSuperscript(
  base: TextSpan[],
  superscript: TextSpan[],
  tolerance: number,
): boolean {
  const baseBounds = union(base.map((span) => span.bounds));
  const superscriptBounds = union(superscript.map((span) => span.bounds));
  const sourceIsSmaller = superscriptBounds.height <= baseBounds.height * 0.85;
  const center = superscriptBounds.y + superscriptBounds.height / 2;
  const verticallyAttached =
    center >= baseBounds.y - tolerance && center <= baseBounds.y + baseBounds.height + tolerance;
  const gap = superscriptBounds.x - baseBounds.x - baseBounds.width;
  return (
    sourceIsSmaller && verticallyAttached && gap >= -tolerance && gap <= baseBounds.height * 1.5
  );
}

function continuesSuperscriptLine(
  base: TextSpan[],
  continuation: TextSpan[],
  tolerance: number,
): boolean {
  const regularBase = base.filter(
    (span) => span.bounds.height >= Math.max(...base.map((item) => item.bounds.height)) * 0.85,
  );
  const baseBounds = union(base.map((span) => span.bounds));
  const regularBounds = union(regularBase.map((span) => span.bounds));
  const continuationBounds = union(continuation.map((span) => span.bounds));
  const sameBaseline = Math.abs(regularBounds.y - continuationBounds.y) <= tolerance;
  const gap = continuationBounds.x - baseBounds.x - baseBounds.width;
  return sameBaseline && gap >= -tolerance && gap <= Math.max(18, regularBounds.height * 1.5);
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

  const tables: Table[] = runs.map((rows) => {
    const repeatedColumns = repeatedColumnStarts(rows, columnTolerance);
    const refinedRows =
      repeatedColumns.length > (rows[0]?.cells.length ?? 0)
        ? rows.map((candidate) => ({
            line: candidate.line,
            cells: cellsAtColumns(candidate.line, repeatedColumns),
          }))
        : rows;
    const columns =
      repeatedColumns.length > (rows[0]?.cells.length ?? 0)
        ? repeatedColumns
        : (rows[0]?.cells ?? []).map((cell) => cell.bounds.x);
    const cells = refinedRows.flatMap((candidate, row) =>
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
  attachWrappedTableCells(tables, lines, columnTolerance);
  return tables;
}

function attachWrappedTableCells(tables: Table[], lines: TextLine[], tolerance: number): void {
  const assigned = new Set(tables.flatMap((table) => table.cells.flatMap((cell) => cell.spans)));
  for (const table of tables) {
    const rowHeight = median(table.cells.map((cell) => cell.bounds.height));
    for (const line of lines) {
      if (line.spans.some((span) => assigned.has(span))) continue;
      const gap = table.bounds.y - (line.bounds.y + line.bounds.height);
      if (gap < -2 || gap > Math.max(4, rowHeight * 0.6)) continue;
      const column = table.columns.findIndex(
        (x, index) => index > 0 && Math.abs(line.bounds.x - x) <= tolerance * 0.35,
      );
      if (column < 1) continue;
      const lastRow = Math.max(...table.cells.map((cell) => cell.row));
      const cell = table.cells.find(
        (candidate) => candidate.row === lastRow && candidate.column === column,
      );
      if (!cell) continue;
      cell.text = `${cell.text} ${line.text}`;
      cell.spans.push(...line.spans);
      cell.bounds = union([cell.bounds, line.bounds]);
      table.bounds = union([table.bounds, line.bounds]);
      for (const span of line.spans) assigned.add(span);
    }
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function repeatedColumnStarts(
  rows: Array<{ line: TextLine; cells: Array<{ bounds: Rect; spans: TextSpan[] }> }>,
  tolerance: number,
): number[] {
  const candidates: Array<{ x: number; rows: Set<number> }> = [];
  for (const [row, candidate] of rows.entries()) {
    for (const [index, span] of candidate.line.spans.entries()) {
      const previous = candidate.line.spans[index - 1];
      if (previous && !shouldInsertSpace(previous, span)) continue;
      const match = candidates.find((item) => Math.abs(item.x - span.bounds.x) <= tolerance * 0.2);
      if (match) match.rows.add(row);
      else candidates.push({ x: span.bounds.x, rows: new Set([row]) });
    }
  }
  const minimumSupport = Math.max(2, Math.ceil(rows.length * 0.6));
  return candidates
    .filter((candidate) => candidate.rows.size >= minimumSupport)
    .map((candidate) => candidate.x)
    .sort((left, right) => left - right);
}

function cellsAtColumns(
  line: TextLine,
  columns: number[],
): Array<{ bounds: Rect; spans: TextSpan[] }> {
  const cells = columns.map(() => [] as TextSpan[]);
  for (const span of line.spans) {
    let column = 0;
    for (let index = 1; index < columns.length; index += 1) {
      if (span.bounds.x >= ((columns[index - 1] ?? 0) + (columns[index] ?? 0)) / 2) column = index;
    }
    cells[column]?.push(span);
  }
  return cells
    .filter((spans) => spans.length > 0)
    .map((spans) => ({ bounds: union(spans.map((span) => span.bounds)), spans }));
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
  const gap = current.bounds.x - (previous.bounds.x + previous.bounds.width);
  if (/^[.!?]$/u.test(previous.text) && /^\p{Lu}/u.test(current.text)) {
    return gap > current.fontSize * 0.18;
  }
  if (/\p{L}[.!?]$/u.test(previous.text) && /^\p{Lu}/u.test(current.text)) {
    return gap > -current.fontSize * 0.1;
  }
  const continuation = /[-‐‑‒–—([{/]$/u.test(previous.text);
  const closingPunctuation = /^[,.;:!?%)\]}]/u.test(current.text);
  if (continuation || closingPunctuation) return false;
  if (gap > current.fontSize) return true;
  const tokenBoundary =
    [...previous.text].length > 1 ||
    [...current.text].length > 1 ||
    (/\p{L}$/u.test(previous.text) && /^\p{L}/u.test(current.text));
  return gap > current.fontSize * 0.18 && tokenBoundary;
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
