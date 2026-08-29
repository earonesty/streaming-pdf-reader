import type { ExtractedPage } from "@boxpdf/reader";
import {
  type SemanticBlock,
  type StructuredPage,
  structurePage,
  type Table,
  tableToRows,
} from "@boxpdf/reader/structure";
import { clearMediaCaptionAssociations } from "./semantic-caption.js";
import { dominantTextColor, semanticTextHtml, semanticTextMarkdown } from "./semantic-inline.js";
import {
  type HtmlImageAsset,
  type HtmlImageOptions,
  prepareSemanticMedia,
  type SemanticMedia,
  withoutSemanticMediaSpans,
} from "./semantic-media.js";

export interface SemanticDocumentStats {
  pagesProcessed: number;
  peakBufferedPages: number;
  peakBufferedLines: number;
  mergedTables: number;
  suppressedFurniture: number;
}

export type SemanticDocumentFormat = "html" | "markdown";

interface BufferedPage {
  width: number;
  height: number;
  structured: StructuredPage;
  media: SemanticMedia[];
}

interface ActiveTable {
  table: Table;
  header: string[] | undefined;
}

export async function writeSemanticDocument(
  pages: AsyncIterable<ExtractedPage> | Iterable<ExtractedPage>,
  write: (chunk: string) => void | Promise<void>,
  lookaheadPages: number,
  imageOptions: HtmlImageOptions,
  onImage?: (image: Readonly<HtmlImageAsset>) => void | Promise<void>,
  format: SemanticDocumentFormat = "html",
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
  const pendingMedia: string[] = [];
  let headerOpen = false;
  let headerHasParagraph = false;
  let contentStarted = false;
  let employmentOpen = false;
  let pendingParagraph:
    | {
        block: Extract<SemanticBlock, { type: "paragraph" }>;
        height: number;
        defaultColor: string;
      }
    | undefined;
  const markdown = format === "markdown";
  const output = (html: string, markdownValue = "") => write(markdown ? markdownValue : html);
  const inlineText = (
    text: string,
    lines: Parameters<typeof semanticTextHtml>[1],
    defaultColor: string,
    preserveWeight = true,
  ) =>
    markdown
      ? semanticTextMarkdown(text, lines, defaultColor, preserveWeight)
      : semanticTextHtml(text, lines, defaultColor, preserveWeight);
  await output('<article class="pdf-semantic-document">');

  const closeTable = async () => {
    if (!activeTable) return;
    await output("</table>", "\n");
    activeTable = undefined;
    while (pendingMedia.length > 0) await write(pendingMedia.shift() ?? "");
  };

  const closeSections = async (minimumLevel = 0) => {
    while ((sectionLevels.at(-1) ?? -1) >= minimumLevel && sectionLevels.length > 0) {
      await output("</section>");
      sectionLevels.pop();
    }
  };

  const flushPendingParagraph = async () => {
    if (!pendingParagraph) return;
    await write(semanticBlockOutput(pendingParagraph.block, pendingParagraph.defaultColor, format));
    pendingParagraph = undefined;
  };

  const closeEmployment = async () => {
    if (!employmentOpen) return;
    await output("</section>");
    employmentOpen = false;
  };

  const emitPage = async (page: BufferedPage, future: BufferedPage[]) => {
    const defaultColor = dominantTextColor(page.structured.lines);
    let mediaIndex = 0;
    const captions = clearMediaCaptionAssociations(
      page.media,
      page.structured.blocks,
      page.width,
      page.height,
      page.structured.lines,
    );
    const captionedMedia = new Set(captions.values());
    const emittedMedia = new Set<SemanticMedia>();
    const futureFurniture = new Set(future.flatMap((candidate) => marginSignatures(candidate)));
    const repeatedFurniture = new Set([...seenFurniture, ...futureFurniture]);
    for (const [blockIndex, block] of page.structured.blocks.entries()) {
      const nextBlock = page.structured.blocks[blockIndex + 1];
      const blockY = semanticBlockY(block);
      let emittedAsCaption = false;
      while (page.media[mediaIndex] && emittedMedia.has(page.media[mediaIndex] as SemanticMedia)) {
        mediaIndex += 1;
      }
      while ((page.media[mediaIndex]?.bounds.y ?? -Infinity) >= blockY) {
        await flushPendingParagraph();
        const item = page.media[mediaIndex];
        if (item && captions.get(block) === item && block.type === "paragraph") {
          const html = markdown
            ? `${item.markdown}\n\n*${inlineText(block.text, block.lines, defaultColor)}*\n\n`
            : `<figure class="pdf-semantic-figure">${item.html}<figcaption>${inlineText(block.text, block.lines, defaultColor)}</figcaption></figure>`;
          if (activeTable) pendingMedia.push(html);
          else await write(html);
          emittedMedia.add(item);
          mediaIndex += 1;
          emittedAsCaption = true;
          break;
        }
        if (item && captionedMedia.has(item)) break;
        const html = markdown
          ? `${item?.markdown ?? ""}\n\n`
          : `<div class="pdf-semantic-visual">${item?.html}</div>`;
        if (activeTable) pendingMedia.push(html);
        else await write(html);
        mediaIndex += 1;
      }
      const associatedMedia = captions.get(block);
      if (!emittedAsCaption && associatedMedia && block.type === "paragraph") {
        await flushPendingParagraph();
        const html = markdown
          ? `${associatedMedia.markdown}\n\n*${inlineText(block.text, block.lines, defaultColor)}*\n\n`
          : `<figure class="pdf-semantic-figure">${associatedMedia.html}<figcaption>${inlineText(block.text, block.lines, defaultColor)}</figcaption></figure>`;
        if (activeTable) pendingMedia.push(html);
        else await write(html);
        emittedMedia.add(associatedMedia);
        emittedAsCaption = true;
      }
      if (emittedAsCaption) continue;
      if (isRepeatedFurniture(block, page, repeatedFurniture)) {
        stats.suppressedFurniture += 1;
        continue;
      }
      await flushPendingParagraph();
      if (employmentOpen && block.type !== "list") await closeEmployment();
      if (!contentStarted && !headerOpen && block.type === "heading" && block.level === 1) {
        await output(
          `<header><h1>${inlineText(block.text, block.lines, defaultColor, false)}</h1>`,
          `# ${inlineText(block.text, block.lines, defaultColor, false)}\n\n`,
        );
        headerOpen = true;
        continue;
      }
      if (headerOpen) {
        if (block.type === "paragraph") {
          const tag = isContactBlock(block) ? "address" : "p";
          await output(
            `<${tag}>${inlineText(block.text, block.lines, defaultColor)}</${tag}>`,
            `${inlineText(block.text, block.lines, defaultColor)}\n\n`,
          );
          headerHasParagraph = true;
          continue;
        }
        if (
          block.type === "heading" &&
          !headerHasParagraph &&
          (block.level === 1 ||
            block.text.trimStart().startsWith("#") ||
            (block.level === 4 && nextBlock?.type === "paragraph" && isContactBlock(nextBlock)))
        ) {
          await output(
            `<h${block.level}>${inlineText(block.text, block.lines, defaultColor, false)}</h${block.level}>`,
            `${"#".repeat(block.level)} ${inlineText(block.text, block.lines, defaultColor, false)}\n\n`,
          );
          continue;
        }
        await output("</header>");
        headerOpen = false;
        contentStarted = true;
      }
      if (block.type === "table") {
        const rows = tableToRows(block.table);
        if (activeTable && tablesContinue(activeTable.table, block.table, page.width)) {
          const continuationRows = sameRow(activeTable.header, rows[0]) ? rows.slice(1) : rows;
          for (const row of continuationRows)
            await write(markdown ? markdownTableRow(row) : tableRow(row, false));
          activeTable.table = block.table;
          stats.mergedTables += 1;
          continue;
        }
        await closeTable();
        const header = tableHeader(rows);
        await output("<table>", markdownTableStart(rows, header));
        const markdownRows = markdown ? (header ? rows.slice(1) : rows) : rows;
        for (const [index, row] of markdownRows.entries())
          await write(
            markdown ? markdownTableRow(row) : tableRow(row, Boolean(header && index === 0)),
          );
        activeTable = { table: block.table, header };
        continue;
      }
      if (activeTable && block.type === "definitionList" && isFinancialSummary(block)) {
        const columns = activeTable.table.columns.length;
        await output(
          `<tfoot>${block.entries.map((entry) => financialSummaryRow(entry, columns)).join("")}</tfoot>`,
          block.entries
            .map((entry) =>
              markdownTableRow([
                entry.term,
                ...Array(Math.max(0, columns - 2)).fill(""),
                entry.description,
              ]),
            )
            .join(""),
        );
        await closeTable();
        continue;
      }
      await closeTable();
      if (block.type === "heading") {
        const level = contentStarted && block.level === 1 ? 2 : block.level;
        await closeSections(level);
        await output(
          `<section data-level="${level}"><h${level}>${inlineText(block.text, block.lines, defaultColor, false)}</h${level}>`,
          `${"#".repeat(level)} ${inlineText(block.text, block.lines, defaultColor, false)}\n\n`,
        );
        sectionLevels.push(level);
        continue;
      }
      if (block.type === "paragraph") {
        if (isTitledRecord(block)) {
          const [institution, ...details] = block.lines;
          if (institution)
            await output(
              `<h3>${escapeHtml(institution.text)}</h3>`,
              `### ${escapeMarkdown(institution.text)}\n\n`,
            );
          for (const detail of details)
            await output(`<p>${escapeHtml(detail.text)}</p>`, `${escapeMarkdown(detail.text)}\n\n`);
          continue;
        }
        if (isUnmarkedList(block)) {
          await output(
            `<ul>${block.lines.map((line) => `<li>${escapeHtml(line.text)}</li>`).join("")}</ul>`,
            `${block.lines.map((line) => `- ${escapeMarkdown(line.text)}`).join("\n")}\n\n`,
          );
          continue;
        }
        pendingParagraph = { block, height: page.height, defaultColor };
        continue;
      }
      if (block.type === "employment") {
        await output(
          `<section><h3>${escapeHtml(block.role)}</h3><p>${escapeHtml(block.organization)}</p><p>${escapeHtml(block.date)}</p>`,
          `### ${escapeMarkdown(block.role)}\n\n${escapeMarkdown(block.organization)}\n\n${escapeMarkdown(block.date)}\n\n`,
        );
        employmentOpen = true;
        continue;
      }
      await write(semanticBlockOutput(block, defaultColor, format));
    }
    while (mediaIndex < page.media.length) {
      const item = page.media[mediaIndex];
      if (item && !emittedMedia.has(item)) {
        await flushPendingParagraph();
        const html = markdown
          ? `${item.markdown}\n\n`
          : `<div class="pdf-semantic-visual">${item.html}</div>`;
        if (activeTable) pendingMedia.push(html);
        else await write(html);
      }
      mediaIndex += 1;
    }
    for (const signature of marginSignatures(page)) seenFurniture.add(signature);
  };

  for await (const page of pages) {
    const media = await prepareSemanticMedia(page, imageOptions, onImage);
    const structured = structurePage(withoutSemanticMediaSpans(page, media));
    buffer.push({ width: page.width, height: page.height, structured, media });
    restoreObservedHyphens(buffer);
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
  if (headerOpen) await output("</header>");
  await closeTable();
  await closeEmployment();
  if (pendingParagraph && isFooterParagraph(pendingParagraph.block, pendingParagraph.height)) {
    await closeSections();
    await output(
      `<footer>${semanticBlockHtml(pendingParagraph.block, pendingParagraph.defaultColor)}</footer>`,
      `---\n\n${semanticBlockMarkdown(pendingParagraph.block, pendingParagraph.defaultColor)}`,
    );
    pendingParagraph = undefined;
  } else {
    await flushPendingParagraph();
    await closeSections();
  }
  await output("</article>");
  return stats;
}

function restoreObservedHyphens(buffer: BufferedPage[]): void {
  const terms = new Set(
    buffer.flatMap((page) =>
      page.structured.lines.flatMap(
        (line) => line.text.match(/[\p{L}\p{N}]+(?:[-‐‑][\p{L}\p{N}]+)+/gu) ?? [],
      ),
    ),
  );
  for (const page of buffer) {
    for (const block of page.structured.blocks) restoreBlockHyphens(block, terms);
  }
}

function restoreBlockHyphens(block: SemanticBlock, terms: Set<string>): void {
  const restore = (value: string) => restoreTextHyphens(value, terms);
  if (block.type === "insetGroup") {
    for (const nested of block.blocks) restoreBlockHyphens(nested, terms);
  } else if (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "preformatted"
  ) {
    block.text = restore(block.text);
  } else if (block.type === "list") {
    for (const item of block.items) item.text = restore(item.text);
  } else if (block.type === "definitionList") {
    for (const entry of block.entries) {
      entry.term = restore(entry.term);
      entry.description = restore(entry.description);
    }
  } else if (block.type === "cardList") {
    for (const item of block.items) {
      item.title = restore(item.title);
      item.details = item.details.map(restore);
    }
  } else if (block.type === "sectionGroup") {
    for (const item of block.items) {
      item.label = restore(item.label);
      item.content = item.content.map(restore);
    }
  } else if (block.type === "employment") {
    block.role = restore(block.role);
    block.organization = restore(block.organization);
    block.date = restore(block.date);
  }
}

function restoreTextHyphens(value: string, terms: Set<string>): string {
  let output = value;
  for (const term of terms) {
    const collapsed = term.replace(/[-‐‑]/gu, "");
    if (collapsed === term || !output.includes(collapsed)) continue;
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegularExpression(collapsed)}(?![\\p{L}\\p{N}])`,
      "gu",
    );
    output = output.replace(pattern, term);
  }
  return output;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isContactBlock(block: Extract<SemanticBlock, { type: "paragraph" }>): boolean {
  const text = block.text;
  const signals = [
    /@/.test(text),
    /\+?\d[\d().\s-]{7,}/.test(text),
    /\bhttps?:\/\//i.test(text),
    /\b\w+\.\w{2,}\b/i.test(text),
  ];
  return signals.filter(Boolean).length >= 2;
}

function isTitledRecord(block: Extract<SemanticBlock, { type: "paragraph" }>): boolean {
  if (block.lines.length < 2) return false;
  const [first, ...rest] = block.lines;
  if (!first || rest.length === 0) return false;
  const firstSize = Math.max(...first.spans.map((span) => span.fontSize));
  const restSize = Math.max(...rest.flatMap((line) => line.spans.map((span) => span.fontSize)));
  const emphasized = first.spans.some((span) =>
    /(?:bold|semibold|demi)/i.test(span.fontFamily ?? ""),
  );
  return emphasized || firstSize >= restSize * 1.08;
}

function isUnmarkedList(block: Extract<SemanticBlock, { type: "paragraph" }>): boolean {
  if (block.lines.length < 3) return false;
  const first = block.lines[0];
  if (!first) return false;
  const aligned = block.lines.every(
    (line) => Math.abs(line.bounds.x - first.bounds.x) <= Math.max(8, first.bounds.height),
  );
  const separated = block.lines.slice(1).every((line, index) => {
    const previous = block.lines[index];
    if (!previous) return false;
    const gap = previous.bounds.y - (line.bounds.y + line.bounds.height);
    return gap >= Math.min(previous.bounds.height, line.bounds.height) * 0.55;
  });
  return aligned && separated;
}

function isFooterParagraph(
  block: Extract<SemanticBlock, { type: "paragraph" }>,
  pageHeight: number,
): boolean {
  const inBottomMargin = block.lines.every(
    (line) => line.bounds.y + line.bounds.height <= pageHeight * 0.15,
  );
  return inBottomMargin || /^(?:thanks|thank you)\b/i.test(block.text.trim());
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
  const later = rows.slice(1).flat();
  return first.every((value) => /\p{L}/u.test(value) && !isNumericValue(value)) &&
    later.some(isNumericValue)
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

function markdownTableStart(rows: string[][], header: string[] | undefined): string {
  const columns = rows[0]?.length ?? 0;
  if (columns === 0) return "";
  const heading = header ?? Array(columns).fill("");
  return `${markdownTableRow(heading)}${markdownTableRow(Array(columns).fill("---"), false)}`;
}

function markdownTableRow(row: string[], shouldEscape = true): string {
  const cells = row.map((value) => (shouldEscape ? escapeMarkdownTableCell(value) : value));
  return `| ${cells.join(" | ")} |\n`;
}

function escapeMarkdownTableCell(value: string): string {
  return escapeMarkdown(value)
    .replaceAll("|", "\\|")
    .replace(/\s*\n\s*/g, "<br>");
}

function isFinancialSummary(block: Extract<SemanticBlock, { type: "definitionList" }>): boolean {
  return (
    block.entries.length > 0 &&
    block.entries.every((entry) => isNumericValue(entry.description)) &&
    block.entries.some((entry) => /\p{Sc}|%/u.test(entry.description))
  );
}

function isNumericValue(value: string): boolean {
  return /^(?:\p{Sc}\s*)?[\d.,'’\s]+(?:\s*%)?$/u.test(value.trim());
}

function financialSummaryRow(
  entry: Extract<SemanticBlock, { type: "definitionList" }>["entries"][number],
  columns: number,
): string {
  const colspan = columns > 2 ? ` colspan="${columns - 1}"` : "";
  return `<tr><th scope="row"${colspan}>${escapeHtml(entry.term)}</th><td>${escapeHtml(entry.description)}</td></tr>`;
}

function semanticBlockHtml(block: SemanticBlock, defaultColor = "#000000"): string {
  if (block.type === "insetGroup") {
    return `<div class="pdf-semantic-inset" style="margin-inline-start:${block.indentEm}em">${block.blocks.map((item) => semanticBlockHtml(item, defaultColor)).join("")}</div>`;
  }
  if (block.type === "table") {
    const rows = tableToRows(block.table);
    const header = tableHeader(rows);
    return `<table>${rows.map((row, index) => tableRow(row, Boolean(header && index === 0))).join("")}</table>`;
  }
  if (block.type === "heading")
    return `<h${block.level}>${semanticTextHtml(block.text, block.lines, defaultColor, false)}</h${block.level}>`;
  if (block.type === "paragraph")
    return `<p>${semanticTextHtml(block.text, block.lines, defaultColor)}</p>`;
  if (block.type === "preformatted") return `<pre>${escapeHtml(block.text)}</pre>`;
  if (block.type === "definitionList") {
    if (
      block.entries.length <= 3 &&
      block.entries.some((entry) => entry.description.trim().split(/\s+/).length >= 5) &&
      block.entries.every((entry) => /^[A-Z][A-Z\s/-]*$/.test(entry.term.trim()))
    ) {
      return block.entries
        .map(
          (entry) =>
            `<section><h2>${escapeHtml(titleCase(entry.term))}</h2><p>${escapeHtml(entry.description)}</p></section>`,
        )
        .join("");
    }
    const list = `<dl>${block.entries
      .map(
        (entry) =>
          `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`,
      )
      .join("")}</dl>`;
    return isFinancialSummary(block) ? `<section>${list}</section>` : list;
  }
  if (block.type === "cardList") {
    return `<section><h2>Items ordered</h2><table><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Amount</th></tr></thead><tbody>${block.items.map(cardTableRow).join("")}</tbody></table></section>`;
  }
  if (block.type === "sectionGroup") {
    return block.items.map(labeledSectionHtml).join("");
  }
  if (block.type === "employment") {
    return `<section><h3>${escapeHtml(block.role)}</h3><p>${escapeHtml(block.organization)}</p><p>${escapeHtml(block.date)}</p></section>`;
  }
  const tag = block.ordered ? "ol" : "ul";
  return `<${tag}>${block.items.map((item) => `<li>${semanticTextHtml(item.text, item.lines, defaultColor)}</li>`).join("")}</${tag}>`;
}

function semanticBlockOutput(
  block: SemanticBlock,
  defaultColor: string,
  format: SemanticDocumentFormat,
): string {
  return format === "markdown"
    ? semanticBlockMarkdown(block, defaultColor)
    : semanticBlockHtml(block, defaultColor);
}

function semanticBlockMarkdown(block: SemanticBlock, defaultColor = "#000000"): string {
  if (block.type === "insetGroup") {
    const content = block.blocks.map((item) => semanticBlockMarkdown(item, defaultColor)).join("");
    return `${content
      .trimEnd()
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}\n\n`;
  }
  if (block.type === "table") {
    const rows = tableToRows(block.table);
    const header = tableHeader(rows);
    return `${markdownTableStart(rows, header)}${(header ? rows.slice(1) : rows)
      .map((row) => markdownTableRow(row))
      .join("")}\n`;
  }
  if (block.type === "heading") {
    return `${"#".repeat(block.level)} ${semanticTextMarkdown(block.text, block.lines, defaultColor, false)}\n\n`;
  }
  if (block.type === "paragraph") {
    return `${semanticTextMarkdown(block.text, block.lines, defaultColor)}\n\n`;
  }
  if (block.type === "preformatted") {
    const fence = block.text.includes("```") ? "````" : "```";
    return `${fence}\n${block.text}\n${fence}\n\n`;
  }
  if (block.type === "definitionList") {
    return `${block.entries
      .map((entry) => `**${escapeMarkdown(entry.term)}:** ${escapeMarkdown(entry.description)}`)
      .join("\n\n")}\n\n`;
  }
  if (block.type === "cardList") {
    const rows = [
      ["Item", "Quantity", "Amount"],
      ...block.items.map((item) => {
        const trailing = item.details.at(-1) ?? "";
        const match = /^\s*[×x]\s*(\d+)\s+(.+)$/u.exec(trailing);
        const detail = item.details.slice(0, -1).join(" ");
        return [
          `${item.title}${detail ? ` — ${detail}` : ""}`,
          match?.[1] ?? "",
          match?.[2] ?? trailing,
        ];
      }),
    ];
    return `## Items ordered\n\n${markdownTableStart(rows, rows[0])}${rows
      .slice(1)
      .map((row) => markdownTableRow(row))
      .join("")}\n`;
  }
  if (block.type === "sectionGroup") {
    return block.items
      .map(
        (item) =>
          `## ${escapeMarkdown(titleCase(item.label))}\n\n${item.content
            .map((content, index) =>
              index === 0 ? `**${escapeMarkdown(content)}**` : escapeMarkdown(content),
            )
            .join("\n\n")}\n\n`,
      )
      .join("");
  }
  if (block.type === "employment") {
    return `### ${escapeMarkdown(block.role)}\n\n${escapeMarkdown(block.organization)}\n\n${escapeMarkdown(block.date)}\n\n`;
  }
  return `${block.items
    .map(
      (item, index) =>
        `${block.ordered ? `${index + 1}.` : "-"} ${semanticTextMarkdown(item.text, item.lines, defaultColor)}`,
    )
    .join("\n")}\n\n`;
}

function semanticBlockY(block: SemanticBlock): number {
  const lines = block.type === "list" ? block.items.flatMap((item) => item.lines) : block.lines;
  return Math.max(...lines.map((line) => line.bounds.y + line.bounds.height));
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
    .map(
      (content, index) =>
        `<p>${index === 0 ? `<strong>${escapeHtml(content)}</strong>` : escapeHtml(content)}</p>`,
    )
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

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}
