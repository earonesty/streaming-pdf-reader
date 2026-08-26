import type { ExtractedPage, Rect, TextSpan } from "../types.js";

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
  return {
    page: page.number,
    lines,
    tables: inferTables(page.number, lines, options),
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
  return `<table>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</table>`;
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
  return [...horizontal, ...vertical].sort((left, right) => {
    const baseline = right.bounds.y - left.bounds.y;
    return Math.abs(baseline) > tolerance ? baseline : right.bounds.x - left.bounds.x;
  });
}

function groupHorizontalLines(spans: TextSpan[], tolerance: number): TextLine[] {
  const rows: TextSpan[][] = [];
  for (const span of [...spans].sort((left, right) => {
    const vertical = right.bounds.y - left.bounds.y;
    return Math.abs(vertical) > tolerance ? vertical : left.bounds.x - right.bounds.x;
  })) {
    const row = rows.find(
      (candidate) => Math.abs((candidate[0]?.bounds.y ?? 0) - span.bounds.y) <= tolerance,
    );
    if (row) row.push(span);
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
  const columnTolerance = options.columnTolerance ?? 8;
  const candidates = lines.filter(
    (line) =>
      line.spans.length >= minimumColumns && line.spans.every((span) => span.direction !== "ttb"),
  );
  if (candidates.length < minimumRows) return [];

  const columns: number[] = [];
  for (const line of candidates) {
    for (const span of line.spans) {
      const existing = columns.findIndex(
        (column) => Math.abs(column - span.bounds.x) <= columnTolerance,
      );
      if (existing < 0) columns.push(span.bounds.x);
      else columns[existing] = ((columns[existing] ?? span.bounds.x) + span.bounds.x) / 2;
    }
  }
  columns.sort((left, right) => left - right);
  if (columns.length < minimumColumns) return [];

  const aligned = candidates.filter((line) =>
    line.spans.every((span) =>
      columns.some((column) => Math.abs(column - span.bounds.x) <= columnTolerance),
    ),
  );
  if (aligned.length < minimumRows) return [];

  const cells: TableCell[] = [];
  aligned.forEach((line, row) => {
    for (const span of line.spans) {
      cells.push({
        row,
        column: closestColumn(columns, span.bounds.x),
        rowSpan: 1,
        columnSpan: 1,
        bounds: span.bounds,
        text: span.text.trim(),
        spans: [span],
        confidence: 0.9,
        reasons: ["repeated-column-alignment"],
      });
    }
  });
  return [
    {
      type: "table",
      page,
      bounds: union(cells.map((cell) => cell.bounds)),
      columns,
      cells,
      confidence: 0.9,
      reasons: ["multiple-rows", "repeated-column-alignment"],
    },
  ];
}

function closestColumn(columns: number[], x: number): number {
  let closest = 0;
  let distance = Number.POSITIVE_INFINITY;
  columns.forEach((column, index) => {
    const candidate = Math.abs(column - x);
    if (candidate < distance) {
      closest = index;
      distance = candidate;
    }
  });
  return closest;
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
