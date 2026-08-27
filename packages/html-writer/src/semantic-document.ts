import type { ExtractedPage } from "@boxpdf/reader";
import {
  type SemanticBlock,
  type StructuredPage,
  structurePage,
  type Table,
  tableToRows,
} from "@boxpdf/reader/structure";

export interface SemanticDocumentStats {
  pagesProcessed: number;
  peakBufferedPages: number;
  peakBufferedLines: number;
  mergedTables: number;
  suppressedFurniture: number;
}

interface BufferedPage {
  width: number;
  height: number;
  structured: StructuredPage;
}

interface ActiveTable {
  table: Table;
  header: string[] | undefined;
}

export async function writeSemanticDocument(
  pages: AsyncIterable<ExtractedPage> | Iterable<ExtractedPage>,
  write: (chunk: string) => void | Promise<void>,
  lookaheadPages: number,
): Promise<SemanticDocumentStats> {
  const stats: SemanticDocumentStats = {
    pagesProcessed: 0,
    peakBufferedPages: 0,
    peakBufferedLines: 0,
    mergedTables: 0,
    suppressedFurniture: 0,
  };
  const buffer: BufferedPage[] = [];
  const seenFurniture = new Set<string>();
  let activeTable: ActiveTable | undefined;
  await write('<article class="pdf-semantic-document">');

  const closeTable = async () => {
    if (!activeTable) return;
    await write("</table>");
    activeTable = undefined;
  };

  const emitPage = async (page: BufferedPage, future: BufferedPage[]) => {
    const futureFurniture = new Set(future.flatMap((candidate) => marginSignatures(candidate)));
    const repeatedFurniture = new Set([...seenFurniture, ...futureFurniture]);
    for (const block of page.structured.blocks) {
      if (isRepeatedFurniture(block, page, repeatedFurniture)) {
        stats.suppressedFurniture += 1;
        continue;
      }
      if (block.type === "table") {
        const rows = tableToRows(block.table);
        if (activeTable && tablesContinue(activeTable.table, block.table, page.width)) {
          const continuationRows = sameRow(activeTable.header, rows[0]) ? rows.slice(1) : rows;
          for (const row of continuationRows) await write(tableRow(row, false));
          activeTable.table = block.table;
          stats.mergedTables += 1;
          continue;
        }
        await closeTable();
        const header = tableHeader(rows);
        await write("<table>");
        for (const [index, row] of rows.entries())
          await write(tableRow(row, Boolean(header && index === 0)));
        activeTable = { table: block.table, header };
        continue;
      }
      await closeTable();
      await write(semanticBlockHtml(block));
    }
    for (const signature of marginSignatures(page)) seenFurniture.add(signature);
  };

  for await (const page of pages) {
    const structured = structurePage(page);
    buffer.push({ width: page.width, height: page.height, structured });
    stats.pagesProcessed += 1;
    stats.peakBufferedPages = Math.max(stats.peakBufferedPages, buffer.length);
    stats.peakBufferedLines = Math.max(
      stats.peakBufferedLines,
      buffer.reduce((total, item) => total + item.structured.lines.length, 0),
    );
    if (buffer.length >= lookaheadPages) {
      const ready = buffer.shift();
      if (ready) await emitPage(ready, buffer);
    }
  }
  while (buffer.length > 0) {
    const ready = buffer.shift();
    if (ready) await emitPage(ready, buffer);
  }
  await closeTable();
  await write("</article>");
  return stats;
}

function marginSignatures(page: BufferedPage): string[] {
  return page.structured.blocks.flatMap((block) =>
    blockLines(block)
      .filter((line) => isMarginLine(line.bounds.y, line.bounds.height, page.height))
      .map((line) => furnitureSignature(line.text)),
  );
}

function isRepeatedFurniture(
  block: SemanticBlock,
  page: BufferedPage,
  futureFurniture: Set<string>,
): boolean {
  const lines = blockLines(block);
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        isMarginLine(line.bounds.y, line.bounds.height, page.height) &&
        futureFurniture.has(furnitureSignature(line.text)),
    )
  );
}

function blockLines(block: SemanticBlock) {
  return block.type === "list" ? block.items.flatMap((item) => item.lines) : block.lines;
}

function isMarginLine(y: number, height: number, pageHeight: number): boolean {
  return y + height <= pageHeight * 0.12 || y >= pageHeight * 0.88;
}

function furnitureSignature(value: string): string {
  return value.toLocaleLowerCase("en").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function tablesContinue(previous: Table, next: Table, pageWidth: number): boolean {
  if (previous.columns.length !== next.columns.length || previous.columns.length < 2) return false;
  return previous.columns.every(
    (column, index) =>
      Math.abs(column - (next.columns[index] ?? Number.POSITIVE_INFINITY)) / pageWidth <= 0.04,
  );
}

function tableHeader(rows: string[][]): string[] | undefined {
  const first = rows[0];
  if (!first) return undefined;
  return first.some((value) => /^(?:item|description|feature|qty|unit|amount|total)$/i.test(value))
    ? first
    : undefined;
}

function sameRow(left: string[] | undefined, right: string[] | undefined): boolean {
  return Boolean(
    left &&
      right &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]),
  );
}

function tableRow(row: string[], header: boolean): string {
  const cell = header ? "th" : "td";
  return `<tr>${row.map((value) => `<${cell}>${escapeHtml(value)}</${cell}>`).join("")}</tr>`;
}

function semanticBlockHtml(block: Exclude<SemanticBlock, { type: "table" }>): string {
  if (block.type === "heading")
    return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
  if (block.type === "paragraph") return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === "definitionList") {
    return `<dl>${block.entries
      .map(
        (entry) =>
          `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`,
      )
      .join("")}</dl>`;
  }
  const tag = block.ordered ? "ol" : "ul";
  return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</${tag}>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
