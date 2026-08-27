import type { EmbeddedFont, ExtractedPage, TextSpan } from "@boxpdf/reader";
import { structurePage, type Table, tableToHtml } from "@boxpdf/reader/structure";

export type HtmlLayout = "positioned" | "flow";
export type HtmlProfile = "visual" | "semantic";
export type HtmlWrite = (chunk: string) => void | Promise<void>;

export interface HtmlWriterOptions {
  /** Output intent. Visual preserves page presentation; semantic prioritizes reading order. */
  profile?: HtmlProfile;
  /** @deprecated Use `profile: "visual"` or `profile: "semantic"`. */
  layout?: HtmlLayout;
  title?: string;
  language?: string;
  includeDocument?: boolean;
  includeStyles?: boolean;
}

const styles = `.pdf-document{margin:0 auto}.pdf-page{box-sizing:border-box;margin:1rem auto;background:#fff;color:#000}.pdf-page--visual,.pdf-page--positioned{position:relative;overflow:hidden}.pdf-page-content{position:absolute;transform-origin:0 0}.pdf-page-content--90{transform:translateX(100%) rotate(90deg)}.pdf-page-content--180{transform:translate(100%,100%) rotate(180deg)}.pdf-page-content--270{transform:translateY(100%) rotate(270deg)}.pdf-span{position:absolute;white-space:pre;transform-origin:left bottom;unicode-bidi:isolate}.pdf-span[data-direction=ttb]{writing-mode:vertical-rl}.pdf-page--semantic,.pdf-page--flow{max-width:60rem;padding:1rem}.pdf-page--semantic p,.pdf-page--flow p{white-space:pre-wrap;unicode-bidi:plaintext}.pdf-page table{border-collapse:collapse}.pdf-page td{padding:.15rem .4rem;vertical-align:top}`;

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
  if (resolveProfile(options) === "semantic") await writeFlowPage(page, write);
  else await writePositionedPage(page, write, options);
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

async function writePositionedPage(
  page: ExtractedPage,
  write: HtmlWrite,
  options: HtmlWriterOptions,
): Promise<void> {
  const quarterTurn = page.rotate === 90 || page.rotate === 270;
  const displayWidth = quarterTurn ? page.height : page.width;
  const displayHeight = quarterTurn ? page.width : page.height;
  await write(
    `<section class="pdf-page pdf-page--visual pdf-page--positioned" data-page="${page.number}" data-rotate="${page.rotate}" style="width:${number(displayWidth)}pt;height:${number(displayHeight)}pt">`,
  );
  const fontAliases = new Map(
    (page.fonts ?? []).map((font) => [font.id, `boxpdf-${page.number}-${font.id}`]),
  );
  if ((options.includeStyles ?? true) && page.fonts?.length) {
    await write(`<style>${page.fonts.map((font) => fontFace(font, fontAliases)).join("")}</style>`);
  }
  await write(
    `<div class="pdf-page-content pdf-page-content--${page.rotate}" style="width:${number(page.width)}pt;height:${number(page.height)}pt">`,
  );
  for (const span of page.spans) await write(positionedSpan(span, fontAliases));
  await write("</div></section>");
}

async function writeFlowPage(page: ExtractedPage, write: HtmlWrite): Promise<void> {
  const structured = structurePage(page);
  const tables = [...structured.tables].sort((left, right) => right.bounds.y - left.bounds.y);
  const emittedTables = new Set<Table>();
  await write(
    `<section class="pdf-page pdf-page--semantic pdf-page--flow" data-page="${page.number}">`,
  );
  for (const line of structured.lines) {
    const table = tables.find((candidate) => containsY(candidate, line.bounds.y));
    if (table) {
      if (!emittedTables.has(table)) {
        await write(tableToHtml(table));
        emittedTables.add(table);
      }
      continue;
    }
    await write(`<p${directionAttribute(line.spans)}>${escapeHtml(line.text)}</p>`);
  }
  for (const table of tables) {
    if (!emittedTables.has(table)) await write(tableToHtml(table));
  }
  await write("</section>");
}

function positionedSpan(span: TextSpan, fontAliases: Map<string, string>): string {
  const direction = directionAttribute([span]);
  const style = [
    `left:${number(span.bounds.x)}pt`,
    `bottom:${number(span.bounds.y)}pt`,
    `width:${number(span.bounds.width)}pt`,
    `height:${number(span.bounds.height)}pt`,
    `font-size:${number(span.fontSize)}pt`,
    ...(isCssHexColor(span.color) ? [`color:${span.color}`] : []),
    ...fontStyles(
      span.fontFamily,
      span.fontAssetId ? fontAliases.get(span.fontAssetId) : undefined,
    ),
  ].join(";");
  return `<span class="pdf-span"${direction} style="${style}">${escapeHtml(span.text)}</span>`;
}

function isCssHexColor(value: string | undefined): value is string {
  return /^#[\da-f]{6}$/i.test(value ?? "");
}

function fontStyles(fontFamily: string | undefined, alias?: string): string[] {
  const normalized = fontFamily?.toLowerCase() ?? "";
  const styles: string[] = [];
  let fallback: string | undefined;
  if (/courier|mono/.test(normalized)) {
    fallback = "Courier New,Courier,monospace";
  } else if (/times|minion|serif|baskerville|georgia/.test(normalized)) {
    fallback = "Times New Roman,Times,serif";
  } else if (/helvetica|arial|sans/.test(normalized)) {
    fallback = "Arial,Helvetica,sans-serif";
  }
  if (alias || fallback) styles.push(`font-family:${[alias, fallback].filter(Boolean).join(",")}`);
  if (/bold|black|semibold|demi/.test(normalized)) styles.push("font-weight:700");
  if (/italic|oblique/.test(normalized)) styles.push("font-style:italic");
  return styles;
}

function fontFace(font: EmbeddedFont, aliases: Map<string, string>): string {
  const alias = aliases.get(font.id);
  if (!alias) return "";
  const styles = fontStyles(font.family, alias).filter(
    (style) => !style.startsWith("font-family:"),
  );
  return `@font-face{font-family:${alias};src:url(data:font/ttf;base64,${base64(font.data)}) format("truetype");${styles.join(";")}}`;
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[third & 63] : "=";
  }
  return output;
}

function directionAttribute(spans: TextSpan[]): string {
  const rtl = spans.filter((span) => span.direction === "rtl").length;
  const vertical = spans.filter((span) => span.direction === "ttb").length;
  if (vertical > rtl && vertical * 2 >= spans.length) return ' data-direction="ttb"';
  return rtl * 2 >= spans.length && spans.length > 0 ? ' dir="rtl"' : "";
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
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 13) return "\n";
      return isForbiddenControl(codePoint) ? "�" : character;
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isForbiddenControl(codePoint: number): boolean {
  return (
    codePoint <= 8 ||
    codePoint === 11 ||
    codePoint === 12 ||
    (codePoint >= 14 && codePoint <= 31) ||
    codePoint === 127
  );
}

function resolveProfile(options: HtmlWriterOptions): HtmlProfile {
  const legacyProfile = options.layout === "flow" ? "semantic" : "visual";
  if (options.profile && options.layout && options.profile !== legacyProfile) {
    throw new Error(
      `conflicting HTML output options: profile "${options.profile}" does not match layout "${options.layout}"`,
    );
  }
  return options.profile ?? legacyProfile;
}
