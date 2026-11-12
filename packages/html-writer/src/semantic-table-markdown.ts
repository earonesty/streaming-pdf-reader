import type { Table, TableCell } from "@boxpdf/reader/structure";
import { semanticTextMarkdown } from "./semantic-inline.js";
import { inferTableHeader, panelTableHtml, styledTableRow } from "./semantic-table.js";

export function fullWidthRow(table: Table, row: number): TableCell | undefined {
  const cells = table.cells.filter((cell) => cell.row === row);
  const cell = cells[0];
  return cells.length === 1 &&
    cell?.column === 0 &&
    cell.columnSpan === table.columns.length &&
    cell.columnSpan > 1 &&
    cell.rowSpan === 1
    ? cell
    : undefined;
}

export function canStreamMarkdownTable(table: Table): boolean {
  return table.cells.every(
    (cell) =>
      cell.rowSpan === 1 && (cell.columnSpan === 1 || Boolean(fullWidthRow(table, cell.row))),
  );
}

/** Yield page-local rows; full-width content separates tables without rewriting output. */
export function* markdownTableChunks(
  table: Table,
  color: string,
  headerTable: Table = table,
  continuing = false,
  knownHeader?: string[],
): Generator<string> {
  if (!canStreamMarkdownTable(table)) {
    yield `${panelTableHtml(table, color)}\n\n`;
    return;
  }
  if (table.caption?.length && !continuing) {
    const text = table.caption.map((line) => line.text).join(" ");
    yield `**${semanticTextMarkdown(text, table.caption, color, false)}**\n\n`;
  }
  const header = knownHeader ?? inferTableHeader(headerTable);
  const ownHeader = inferTableHeader(table);
  const first = table.cells.filter((cell) => cell.row === 0).sort((a, b) => a.column - b.column);
  const repeatsHeader =
    header &&
    first.length === header.length &&
    first.every(
      (cell, index) =>
        cell.columnSpan === 1 &&
        cell.text.trim().toLowerCase() === header[index]?.trim().toLowerCase(),
    );
  const skipHeader = continuing ? repeatsHeader : ownHeader || repeatsHeader;
  const columns = Math.max(
    table.columns.length,
    ...table.cells.map((cell) => cell.column + cell.columnSpan),
  );
  let open = continuing;
  const last = Math.max(...table.cells.map((cell) => cell.row));
  for (let row = skipHeader ? 1 : 0; row <= last; row++) {
    const spanning = fullWidthRow(table, row);
    if (spanning) {
      if (open) yield "\n";
      const lines = [
        {
          type: "line" as const,
          text: spanning.text,
          spans: spanning.spans.map((span) => ({
            ...span,
            fontFamily: span.fontFamily?.replace(/italic|oblique|slanted|slant|ital/gi, ""),
          })),
          bounds: spanning.bounds,
          confidence: spanning.confidence,
          reasons: spanning.reasons,
        },
      ];
      // Underscores wrap existing strong/link markup without *** ambiguity.
      yield `_${semanticTextMarkdown(spanning.text, lines, color)}_\n\n`;
      open = false;
      continue;
    }
    if (!open) {
      yield header
        ? styledTableRow(headerTable, 0, true, color, true)
        : `| ${Array(columns).fill("").join(" | ")} |\n`;
      yield `| ${Array(columns).fill("---").join(" | ")} |\n`;
      open = true;
    }
    yield styledTableRow(table, row, false, color, true);
  }
}
