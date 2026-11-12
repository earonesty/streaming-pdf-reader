import { type Table, type TableCell, type TextLine, tableToRows } from "@boxpdf/reader/structure";
import { semanticTextHtml, semanticTextMarkdown } from "./semantic-inline.js";

export function boldTableHeader(table: Table): boolean {
  const first = table.cells.filter((cell) => cell.row === 0);
  return (
    first.length === table.columns.length &&
    first.every(
      (cell) =>
        cell.spans.length > 0 &&
        cell.spans.every((span) => /bold|semibold|demi/i.test(span.fontFamily ?? "")),
    ) &&
    table.cells.some(
      (cell) =>
        cell.row > 0 &&
        cell.spans.some((span) => !/bold|semibold|demi/i.test(span.fontFamily ?? "")),
    )
  );
}
function cellLines(cell: TableCell): TextLine[] {
  return [
    {
      type: "line",
      text: cell.text,
      spans: cell.spans,
      bounds: cell.bounds,
      confidence: cell.confidence,
      reasons: cell.reasons,
    },
  ];
}
export function styledTableRow(
  table: Table,
  row: number,
  header: boolean,
  color: string,
  markdown: boolean,
  rowGroupStart = 0,
): string {
  const cells = table.cells.filter((cell) => cell.row === row).sort((a, b) => a.column - b.column);
  const columns = Math.max(
    table.columns.length,
    ...table.cells.map((cell) => cell.column + cell.columnSpan),
  );
  if (markdown) {
    const values = Array.from({ length: columns }, (_, column) => {
      const cell = cells.find((cell) => cell.column === column);
      return cell
        ? semanticTextMarkdown(cell.text, cellLines(cell), color, !header).replaceAll("|", "\\|")
        : "";
    });
    return `| ${values.join(" | ")} |\n`;
  }
  const tag = header ? "th" : "td";
  let result = "<tr>";
  for (let column = 0; column < columns; column++) {
    const cell = cells.find((cell) => cell.column === column);
    if (!cell) {
      if (
        table.cells.some(
          (previous) =>
            previous.row >= rowGroupStart &&
            previous.row < row &&
            previous.row + previous.rowSpan > row &&
            column >= previous.column &&
            column < previous.column + previous.columnSpan,
        )
      )
        continue;
      result += `<${tag}></${tag}>`;
      continue;
    }
    result += `<${tag}${header ? ' scope="col"' : ""}${cell.columnSpan > 1 ? ` colspan="${cell.columnSpan}"` : ""}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ""}>${semanticTextHtml(cell.text, cellLines(cell), color, !header)}</${tag}>`;
    column += cell.columnSpan - 1;
  }
  return `${result}</tr>`;
}
export function panelTableHtml(table: Table, color: string): string {
  const header = Boolean(inferTableHeader(table));
  const last = Math.max(...table.cells.map((cell) => cell.row));
  const footer = spanningFooterRow(table) !== undefined;
  const caption = table.caption?.map((line) => line.text).join(" ");
  let result = `<table>${caption ? `<caption>${semanticTextHtml(caption, table.caption ?? [], color, false)}</caption>` : ""}`;
  if (header) result += `<thead>${styledTableRow(table, 0, true, color, false)}</thead>`;
  result += "<tbody>";
  for (let row = header ? 1 : 0; row <= last - (footer ? 1 : 0); row++) {
    // Descriptive first-column labels in a comparison matrix identify each row.
    let html = styledTableRow(table, row, false, color, false, header ? 1 : 0);
    const cells = table.cells.filter((cell) => cell.row === row);
    if (
      header &&
      cells.length === table.columns.length &&
      cells[0]?.column === 0 &&
      cells[0].text.split(/\s+/).length >= 2 &&
      cells.slice(1).every((cell) => cell.text.split(/\s+/).length <= 2)
    )
      html = html.replace(/^<tr><td>/, '<tr><th scope="row">').replace("</td>", "</th>");
    result += html;
  }
  result += "</tbody>";
  if (footer) result += `<tfoot>${styledTableRow(table, last, false, color, false, last)}</tfoot>`;
  return `${result}</table>`;
}

export function inferTableHeader(table: Table): string[] | undefined {
  const rows = tableToRows(table);
  const first = rows[0];
  const numeric = (value: string) => /^(?:\p{Sc}\s*)?[\d.,'’\s]+(?:\s*%)?$/u.test(value.trim());
  return first &&
    (boldTableHeader(table) ||
      (first.every((value) => /\p{L}/u.test(value) && !numeric(value)) &&
        rows.slice(1).flat().some(numeric)))
    ? first
    : undefined;
}

/** Render a complete semantic table for page and nested document output. */
export function semanticTableHtml(table: Table, color: string): string {
  if (table.caption || table.cells.some((cell) => cell.columnSpan > 1))
    return panelTableHtml(table, color);
  const header = inferTableHeader(table);
  return `<table>${tableToRows(table)
    .map((_, index) => styledTableRow(table, index, Boolean(header && index === 0), color, false))
    .join("")}</table>`;
}

export function spanningFooterRow(table: Table): number | undefined {
  const last = Math.max(...table.cells.map((cell) => cell.row));
  return table.cells.some((cell) => cell.row === last && cell.columnSpan === table.columns.length)
    ? last
    : undefined;
}
