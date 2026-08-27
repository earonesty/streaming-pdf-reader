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
  const sectionLevels: number[] = [];
  let activeTable: ActiveTable | undefined;
  await write('<article class="pdf-semantic-document">');

  const closeTable = async () => {
    if (!activeTable) return;
    await write("</table>");
    activeTable = undefined;
  };

  const closeSections = async (minimumLevel = 0) => {
    while ((sectionLevels.at(-1) ?? -1) >= minimumLevel && sectionLevels.length > 0) {
      await write("</section>");
      sectionLevels.pop();
    }
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
      if (activeTable && block.type === "definitionList" && isFinancialSummary(block)) {
        const columns = activeTable.table.columns.length;
        await write(
          `<tfoot>${block.entries.map((entry) => financialSummaryRow(entry, columns)).join("")}</tfoot>`,
        );
        await closeTable();
        continue;
      }
      await closeTable();
      if (block.type === "heading") {
        await closeSections(block.level);
        await write(
          `<section data-level="${block.level}"><h${block.level}>${escapeHtml(block.text)}</h${block.level}>`,
        );
        sectionLevels.push(block.level);
        continue;
      }
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
  await closeSections();
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

function isFinancialSummary(block: Extract<SemanticBlock, { type: "definitionList" }>): boolean {
  return (
    block.entries.length > 0 &&
    block.entries.every((entry) =>
      /^(?:sub\s*total|tax|shipping|discount|tip|fee|amount due|balance due|total)(?:\s*\([^)]*\))?$/i.test(
        entry.term.trim(),
      ),
    )
  );
}

function financialSummaryRow(
  entry: Extract<SemanticBlock, { type: "definitionList" }>["entries"][number],
  columns: number,
): string {
  const colspan = columns > 2 ? ` colspan="${columns - 1}"` : "";
  return `<tr><th scope="row"${colspan}>${escapeHtml(entry.term)}</th><td>${escapeHtml(entry.description)}</td></tr>`;
}

function semanticBlockHtml(block: Exclude<SemanticBlock, { type: "table" }>): string {
  if (block.type === "heading")
    return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
  if (block.type === "paragraph") return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === "definitionList") {
    const list = `<dl>${block.entries
      .map(
        (entry) =>
          `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`,
      )
      .join("")}</dl>`;
    return isFinancialSummary(block) ? `<section><h2>Order total</h2>${list}</section>` : list;
  }
  if (block.type === "cardList") {
    return `<section><h2>Items ordered</h2><table><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Amount</th></tr></thead><tbody>${block.items.map(cardTableRow).join("")}</tbody></table></section>`;
  }
  if (block.type === "sectionGroup") {
    return block.items.map(labeledSectionHtml).join("");
  }
  const tag = block.ordered ? "ol" : "ul";
  return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</${tag}>`;
}

function cardTableRow(item: Extract<SemanticBlock, { type: "cardList" }>["items"][number]): string {
  const trailing = item.details.at(-1) ?? "";
  const match = /^\s*[×x]\s*(\d+)\s+(.+)$/u.exec(trailing);
  const description = item.details.slice(0, -1).join(" ");
  const detail = description ? `<br><span>${escapeHtml(description)}</span>` : "";
  const quantity = match?.[1] ?? "";
  const amount = match?.[2] ?? trailing;
  return `<tr><th scope="row">${escapeHtml(item.title)}${detail}</th><td>${escapeHtml(quantity)}</td><td>${escapeHtml(amount)}</td></tr>`;
}

function labeledSectionHtml(
  item: Extract<SemanticBlock, { type: "sectionGroup" }>["items"][number],
): string {
  const heading = titleCase(item.label);
  const postal = /\b(?:ship|deliver|mail)(?:ed)?\b/i.test(item.label);
  if (postal) {
    const [name, ...address] = item.content;
    const content = [name ? `<strong>${escapeHtml(name)}</strong>` : "", ...address.map(escapeHtml)]
      .filter(Boolean)
      .join("<br>");
    return `<section><h2>${escapeHtml(heading)}</h2><address>${content}</address></section>`;
  }
  return `<section><h2>${escapeHtml(heading)}</h2>${item.content
    .map((content, index) => `<p>${index === 0 ? `<strong>${escapeHtml(content)}</strong>` : escapeHtml(content)}</p>`)
    .join("")}</section>`;
}

function titleCase(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en");
  return normalized.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("en"));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
