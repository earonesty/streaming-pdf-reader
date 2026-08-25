import type { ExtractedPage, TextSpan } from "@boxpdf/reader";
import { structurePage, type Table, tableToHtml } from "@boxpdf/reader/structure";

export type HtmlLayout = "positioned" | "flow";
export type HtmlWrite = (chunk: string) => void | Promise<void>;

export interface HtmlWriterOptions {
  layout?: HtmlLayout;
  title?: string;
  language?: string;
  includeDocument?: boolean;
  includeStyles?: boolean;
}

const styles = `.pdf-document{margin:0 auto}.pdf-page{box-sizing:border-box;margin:1rem auto;background:#fff;color:#000}.pdf-page--positioned{position:relative;overflow:hidden}.pdf-span{position:absolute;white-space:pre;transform-origin:left bottom}.pdf-page--flow{max-width:60rem;padding:1rem}.pdf-page--flow p{white-space:pre-wrap}.pdf-page table{border-collapse:collapse}.pdf-page td{padding:.15rem .4rem;vertical-align:top}`;

export async function writeHtmlDocument(
  pages: AsyncIterable<ExtractedPage> | Iterable<ExtractedPage>,
  write: HtmlWrite,
  options: HtmlWriterOptions = {},
): Promise<void> {
  const includeDocument = options.includeDocument ?? true;
  if (includeDocument) {
    await write("<!doctype html><html");
    await write(
      ` lang="${escapeAttribute(options.language ?? "en")}"><head><meta charset="utf-8">`,
    );
    await write('<meta name="viewport" content="width=device-width,initial-scale=1">');
    await write(`<title>${escapeHtml(options.title ?? "PDF document")}</title>`);
    if (options.includeStyles ?? true) await write(`<style>${styles}</style>`);
    await write("</head><body>");
  }
  await write('<main class="pdf-document">');
  for await (const page of pages) await writePage(page, write, options);
  await write("</main>");
  if (includeDocument) await write("</body></html>");
}

export async function writePage(
  page: ExtractedPage,
  write: HtmlWrite,
  options: HtmlWriterOptions = {},
): Promise<void> {
  if ((options.layout ?? "positioned") === "flow") await writeFlowPage(page, write);
  else await writePositionedPage(page, write);
}

export async function pageToHtml(
  page: ExtractedPage,
  options: HtmlWriterOptions = {},
): Promise<string> {
  let output = "";
  await writePage(
    page,
    (chunk) => {
      output += chunk;
    },
    options,
  );
  return output;
}

async function writePositionedPage(page: ExtractedPage, write: HtmlWrite): Promise<void> {
  await write(
    `<section class="pdf-page pdf-page--positioned" data-page="${page.number}" style="width:${number(page.width)}pt;height:${number(page.height)}pt">`,
  );
  for (const span of page.spans) await write(positionedSpan(span));
  await write("</section>");
}

async function writeFlowPage(page: ExtractedPage, write: HtmlWrite): Promise<void> {
  const structured = structurePage(page);
  const tables = [...structured.tables].sort((left, right) => right.bounds.y - left.bounds.y);
  const emittedTables = new Set<Table>();
  await write(`<section class="pdf-page pdf-page--flow" data-page="${page.number}">`);
  for (const line of structured.lines) {
    const table = tables.find((candidate) => containsY(candidate, line.bounds.y));
    if (table) {
      if (!emittedTables.has(table)) {
        await write(tableToHtml(table));
        emittedTables.add(table);
      }
      continue;
    }
    await write(`<p>${escapeHtml(line.text)}</p>`);
  }
  for (const table of tables) {
    if (!emittedTables.has(table)) await write(tableToHtml(table));
  }
  await write("</section>");
}

function positionedSpan(span: TextSpan): string {
  const direction = span.direction === "rtl" ? ' dir="rtl"' : "";
  const style = [
    `left:${number(span.bounds.x)}pt`,
    `bottom:${number(span.bounds.y)}pt`,
    `width:${number(span.bounds.width)}pt`,
    `height:${number(span.bounds.height)}pt`,
    `font-size:${number(span.fontSize)}pt`,
  ].join(";");
  return `<span class="pdf-span"${direction} style="${style}">${escapeHtml(span.text)}</span>`;
}

function containsY(table: Table, y: number): boolean {
  return y >= table.bounds.y && y <= table.bounds.y + table.bounds.height;
}

function number(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0";
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
