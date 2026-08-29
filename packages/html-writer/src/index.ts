import type {
  EmbeddedType3Font,
  ExtractedPage,
  RasterImage,
  TextSpan,
  Type3Glyph,
} from "@boxpdf/reader";
import { type SemanticBlock, structurePage, tableToHtml } from "@boxpdf/reader/structure";
import { clearMediaCaptionAssociations } from "./semantic-caption.js";
import { type SemanticDocumentStats, writeSemanticDocument } from "./semantic-document.js";
import { dominantTextColor, semanticTextHtml } from "./semantic-inline.js";
import {
  type HtmlImageAsset,
  type HtmlImageOptions,
  prepareSemanticMedia,
  type SemanticMedia,
  withoutSemanticMediaSpans,
} from "./semantic-media.js";
import {
  isSvgPath,
  vectorFillSvg,
  vectorPathClipDefinitions,
  vectorPathSvg,
} from "./vector-svg.js";
import { base64, visualFontAliases, visualFontFace, visualFontStyles } from "./visual-font.js";

export type { SemanticDocumentStats } from "./semantic-document.js";
export type { HtmlImageAsset, HtmlImageOptions } from "./semantic-media.js";

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
  /** Maximum extracted page models retained for document-level semantic decisions. */
  semanticLookaheadPages?: number;
  /** Receives bounded-buffer and document-inference statistics after semantic output completes. */
  onSemanticStats?: (stats: Readonly<SemanticDocumentStats>) => void;
  /** Semantic defaults to excluded; visual defaults to embedded. */
  imageOptions?: HtmlImageOptions;
  /** Receives each named asset when imageOptions is references. */
  onImage?: (image: Readonly<HtmlImageAsset>) => void | Promise<void>;
}

export interface MarkdownWriterOptions {
  semanticLookaheadPages?: number;
  onSemanticStats?: (stats: Readonly<SemanticDocumentStats>) => void;
  /** Defaults to excluded. */
  imageOptions?: HtmlImageOptions;
  onImage?: (image: Readonly<HtmlImageAsset>) => void | Promise<void>;
}

const styles = `.pdf-document{margin:0 auto}.pdf-page{box-sizing:border-box;margin:1rem auto;background:#fff;color:#000}.pdf-page--visual,.pdf-page--positioned{position:relative;overflow:hidden}.pdf-page-content{position:absolute;transform-origin:0 0}.pdf-span{position:absolute;white-space:pre;transform-origin:left bottom;unicode-bidi:isolate}.pdf-span[data-direction=ttb]{writing-mode:vertical-rl}.pdf-page--semantic,.pdf-page--flow{max-width:60rem;padding:1rem}.pdf-page--semantic p,.pdf-page--flow p{white-space:pre-wrap;unicode-bidi:plaintext}.pdf-semantic-document h1,.pdf-page--semantic h1{font-size:1.7em}.pdf-semantic-document h2,.pdf-page--semantic h2{font-size:1.5em}.pdf-semantic-document h3,.pdf-page--semantic h3{font-size:1.35em}.pdf-semantic-document h4,.pdf-page--semantic h4{font-size:1.1em}.pdf-page table{border-collapse:collapse}.pdf-page td{padding:.15rem .4rem;vertical-align:top}`;

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
  const profile = resolveProfile(options);
  const imageOptions = resolveImageOptions(profile, options);
  validateImageOptions(imageOptions, options);
  if (profile === "semantic") {
    const lookahead = semanticLookahead(options.semanticLookaheadPages);
    const stats = await writeSemanticDocument(
      pages,
      write,
      lookahead,
      imageOptions,
      options.onImage,
    );
    options.onSemanticStats?.(stats);
  } else {
    for await (const page of pages) await writePage(page, write, options);
  }
  await write("</main>");
  if (includeDocument) await write("</body></html>");
}

/** Streams reflowed Markdown from the same bounded semantic inference used by semantic HTML. */
export async function writeMarkdownDocument(
  pages: AsyncIterable<ExtractedPage> | Iterable<ExtractedPage>,
  write: HtmlWrite,
  options: MarkdownWriterOptions = {},
): Promise<void> {
  const imageOptions = options.imageOptions ?? "excluded";
  validateImageOptions(imageOptions, options);
  const lookahead = semanticLookahead(options.semanticLookaheadPages);
  const stats = await writeSemanticDocument(
    pages,
    write,
    lookahead,
    imageOptions,
    options.onImage,
    "markdown",
  );
  options.onSemanticStats?.(stats);
}

function semanticLookahead(value: number | undefined): number {
  const lookahead = value ?? 4;
  if (!Number.isSafeInteger(lookahead) || lookahead < 1 || lookahead > 16) {
    throw new RangeError("semanticLookaheadPages must be an integer between 1 and 16");
  }
  return lookahead;
}

export async function writePage(
  page: ExtractedPage,
  write: HtmlWrite,
  options: HtmlWriterOptions = {},
): Promise<void> {
  const profile = resolveProfile(options);
  validateImageOptions(resolveImageOptions(profile, options), options);
  if (profile === "semantic") await writeFlowPage(page, write, options);
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
  const imageOptions = resolveImageOptions("visual", options);
  const visualImages = await prepareVisualImages(page, imageOptions, options.onImage);
  const visualSpans = coalesceVisualSpans(page.visualSpans ?? page.spans);
  const reflectedOverlay = usesReflectedVisualOverlay(page, visualSpans);
  const quarterTurn = page.rotate === 90 || page.rotate === 270;
  const displayWidth = quarterTurn ? page.height : page.width;
  const displayHeight = quarterTurn ? page.width : page.height;
  await write(
    `<section class="pdf-page pdf-page--visual pdf-page--positioned" data-page="${page.number}" data-rotate="${page.rotate}" style="width:${number(displayWidth)}pt;height:${number(displayHeight)}pt">`,
  );
  const fontAliases = visualFontAliases(page.number, page.fonts ?? []);
  const type3Fonts = new Map(
    (page.fonts ?? [])
      .filter((font): font is EmbeddedType3Font => font.format === "type3")
      .map((font) => [font.id, font]),
  );
  const textClasses =
    (options.includeStyles ?? true)
      ? visualTextClasses(page.number, visualSpans, fontAliases)
      : undefined;
  if ((options.includeStyles ?? true) && page.fonts?.length) {
    await write(
      `<style>${page.fonts.map((font) => visualFontFace(font, fontAliases)).join("")}</style>`,
    );
  }
  if (textClasses?.css) await write(`<style>${textClasses.css}</style>`);
  await write(
    `<div class="pdf-page-content pdf-page-content--${page.rotate}" style="width:${number(page.width)}pt;height:${number(page.height)}pt${rotationTransform(page)}">`,
  );
  await write(
    `<svg class="pdf-visual-text" xmlns="http://www.w3.org/2000/svg" width="${number(page.width)}pt" height="${number(page.height)}pt" viewBox="0 0 ${number(page.width)} ${number(page.height)}">`,
  );
  const clipDefinitions =
    imageClipDefinitions(
      imageOptions === "excluded" ? [] : (page.images ?? []),
      page.number,
      page.height,
    ) +
    vectorPathClipDefinitions(
      (page.paths ?? []).map((path, index) => ({ path, index })),
      page.number,
    );
  if (clipDefinitions) await write(`<defs>${clipDefinitions}</defs>`);
  if (reflectedOverlay) {
    for (const [index, image] of (page.images ?? []).entries()) {
      const source = visualImages[index];
      if (source) await write(visualImage(image, page.height, page.number, index, source));
    }
  }
  if (page.fills?.length || page.paths?.length) {
    await write(`<g transform="translate(0 ${number(page.height)}) scale(1 -1)">`);
    for (const fill of page.fills ?? []) await write(vectorFillSvg(fill));
    for (const [pathIndex, path] of (page.paths ?? []).entries()) {
      await write(vectorPathSvg(path, page.number, pathIndex));
    }
    await write("</g>");
  }
  if (!reflectedOverlay) {
    for (const [index, image] of (page.images ?? []).entries()) {
      const source = visualImages[index];
      if (source) await write(visualImage(image, page.height, page.number, index, source));
    }
  }
  for (const span of visualSpans) {
    if (!usesPositionedSpan(span)) {
      const type3 = span.fontAssetId ? type3Fonts.get(span.fontAssetId) : undefined;
      await write(
        type3
          ? visualType3Text(span, type3, page.height)
          : visualText(
              span,
              page.height,
              fontAliases,
              reflectedOverlay && page.rotate === 180,
              textClasses?.names,
            ),
      );
    }
  }
  await write("</svg>");
  for (const span of visualSpans) {
    if (usesPositionedSpan(span)) await write(positionedSpan(span, fontAliases));
  }
  await write("</div></section>");
}

/**
 * PDF producers commonly show every word with a separate text operator. Keeping
 * those operators as separate SVG elements is needlessly expensive for browsers,
 * so join only the spans whose combined geometry can still be represented by one
 * SVG textLength. Anything unusual keeps the original lossless representation.
 */
function coalesceVisualSpans(spans: TextSpan[]): TextSpan[] {
  const output: TextSpan[] = [];
  for (const span of spans) {
    const previous = output.at(-1);
    if (!previous || !canCoalesceVisualSpans(previous, span)) {
      output.push(span);
      continue;
    }
    output[output.length - 1] = {
      ...previous,
      text: previous.text + (span.hasLeadingSpace ? " " : "") + span.text,
      bounds: {
        ...previous.bounds,
        width: span.bounds.x + span.bounds.width - previous.bounds.x,
        height: Math.max(previous.bounds.height, span.bounds.height),
      },
    };
  }
  return output;
}

function canCoalesceVisualSpans(left: TextSpan, right: TextSpan): boolean {
  if (usesPositionedSpan(left) || usesPositionedSpan(right)) return false;
  if (left.direction !== "ltr" || right.direction !== "ltr") return false;
  // Guardian fallback text sits just outside the safe whole-span width model.
  if (/guardian/i.test(left.fontFamily ?? "")) return false;
  if (left.glyphCodes || right.glyphCodes) return false;
  if (!sameVisualTextState(left, right)) return false;
  const tolerance = Math.max(0.02, left.fontSize * 0.015);
  if (Math.abs(left.bounds.y - right.bounds.y) > tolerance) return false;
  const gap = right.bounds.x - (left.bounds.x + left.bounds.width);
  if (gap < -tolerance || gap > left.fontSize * 0.65) return false;
  return Boolean(right.hasLeadingSpace) || gap <= tolerance;
}

function sameVisualTextState(left: TextSpan, right: TextSpan): boolean {
  return (
    Math.abs(left.fontSize - right.fontSize) <= 0.001 &&
    left.fontName === right.fontName &&
    left.fontFamily === right.fontFamily &&
    left.fontAssetId === right.fontAssetId &&
    left.color === right.color &&
    left.fillOpacity === right.fillOpacity &&
    left.strokeColor === right.strokeColor &&
    left.strokeWidth === right.strokeWidth &&
    left.strokeOpacity === right.strokeOpacity &&
    left.renderingMode === right.renderingMode &&
    sameTransform(left.transform, right.transform)
  );
}

function sameTransform(left: TextSpan["transform"], right: TextSpan["transform"]): boolean {
  if (!left || !right) return left === right;
  return left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= 0.000_001);
}

function visualTextClasses(
  pageNumber: number,
  spans: TextSpan[],
  fontAliases: Map<string, string>,
): { css: string; names: Map<string, string> } {
  const names = new Map<string, string>();
  let css = "";
  for (const span of spans) {
    if (usesPositionedSpan(span) || span.glyphCodes) {
      continue;
    }
    const style = visualTextStyle(span, fontAliases);
    if (!style || names.has(style)) continue;
    const name = `boxpdf-p${number(pageNumber)}-t${names.size + 1}`;
    names.set(style, name);
    css += `.${name}{${style}}`;
  }
  return { css, names };
}

function usesReflectedVisualOverlay(page: ExtractedPage, spans: TextSpan[]): boolean {
  return (
    Boolean(page.images?.length) &&
    Boolean(page.paths?.length || page.fills?.length) &&
    spans.length > 0 &&
    spans.every(
      (span) =>
        span.transform !== undefined &&
        Math.abs(span.transform[0] + 1) < 0.000_001 &&
        Math.abs(span.transform[1]) < 0.000_001 &&
        Math.abs(span.transform[2]) < 0.000_001 &&
        Math.abs(span.transform[3] - 1) < 0.000_001,
    )
  );
}

function visualImage(
  image: RasterImage,
  pageHeight: number,
  pageNumber: number,
  imageIndex: number,
  source: string,
): string {
  const [a, b, c, d, e, f] = image.transform;
  const transform = [a, -b, -c, d, c + e, pageHeight - d - f].map(number).join(" ");
  const opacity = isUnitInterval(image.opacity) ? ` opacity="${number(image.opacity)}"` : "";
  let output = `<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${transform})" href="${source}"${opacity}/>`;
  for (let index = (image.clips?.length ?? 0) - 1; index >= 0; index -= 1) {
    output = `<g clip-path="url(#${imageClipId(pageNumber, imageIndex, index)})">${output}</g>`;
  }
  return output;
}

async function prepareVisualImages(
  page: ExtractedPage,
  imageOptions: HtmlImageOptions,
  onImage: HtmlWriterOptions["onImage"],
): Promise<string[]> {
  if (imageOptions === "excluded") return [];
  const sources: string[] = [];
  for (const [index, image] of (page.images ?? []).entries()) {
    const mimeType = image.format === "jpeg" ? "image/jpeg" : "image/bmp";
    const data = image.format === "jpeg" ? image.data : rgbBmp(image);
    if (imageOptions === "embedded") {
      sources.push(`data:${mimeType};base64,${base64(data)}`);
      continue;
    }
    const extension = image.format === "jpeg" ? "jpg" : "bmp";
    const name = `page-${page.number}-image-${index + 1}.${extension}`;
    await onImage?.({ name, mimeType, data });
    sources.push(name);
  }
  return sources;
}

function imageClipDefinitions(
  images: RasterImage[],
  pageNumber: number,
  pageHeight: number,
): string {
  return images
    .flatMap((image, imageIndex) =>
      (image.clips ?? []).map((clip, clipIndex) => {
        if (!isSvgPath(clip.d)) return "";
        const fillRule = clip.fillRule ? ` clip-rule="${clip.fillRule}"` : "";
        return `<clipPath id="${imageClipId(pageNumber, imageIndex, clipIndex)}" clipPathUnits="userSpaceOnUse"><path d="${clip.d}" transform="translate(0 ${number(pageHeight)}) scale(1 -1)"${fillRule}/></clipPath>`;
      }),
    )
    .join("");
}

function imageClipId(pageNumber: number, imageIndex: number, clipIndex: number): string {
  return `boxpdf-clip-${pageNumber}-${imageIndex}-${clipIndex}`;
}

function rgbBmp(image: RasterImage): Uint8Array {
  const stride = Math.ceil((image.width * 3) / 4) * 4;
  const output = new Uint8Array(54 + stride * image.height);
  const view = new DataView(output.buffer);
  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, output.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, -image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * image.height, true);
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      const source = (row * image.width + column) * 3;
      const target = 54 + row * stride + column * 3;
      output[target] = image.data[source + 2] ?? 0;
      output[target + 1] = image.data[source + 1] ?? 0;
      output[target + 2] = image.data[source] ?? 0;
    }
  }
  return output;
}

function rotationTransform(page: ExtractedPage): string {
  switch (page.rotate) {
    case 90:
      return `;transform:translate(${number(page.height)}pt,0) rotate(90deg)`;
    case 180:
      return `;transform:translate(${number(page.width)}pt,${number(page.height)}pt) rotate(180deg)`;
    case 270:
      return `;transform:translate(0,${number(page.width)}pt) rotate(270deg)`;
    default:
      return "";
  }
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
    ...(isUnitInterval(span.fillOpacity) ? [`opacity:${number(span.fillOpacity)}`] : []),
    ...visualFontStyles(
      span.fontFamily,
      span.fontAssetId ? fontAliases.get(span.fontAssetId) : undefined,
    ),
  ].join(";");
  return `<span class="pdf-span"${direction} style="${style}">${escapeHtml(span.text)}</span>`;
}

async function writeFlowPage(
  page: ExtractedPage,
  write: HtmlWrite,
  options: HtmlWriterOptions,
): Promise<void> {
  const imageOptions = resolveImageOptions("semantic", options);
  const media = await prepareSemanticMedia(page, imageOptions, options.onImage);
  const structured = structurePage(withoutSemanticMediaSpans(page, media));
  const defaultColor = dominantTextColor(structured.lines);
  let mediaIndex = 0;
  const captions = clearMediaCaptionAssociations(
    media,
    structured.blocks,
    page.width,
    page.height,
    structured.lines,
  );
  const captionedMedia = new Set(captions.values());
  const emittedMedia = new Set<SemanticMedia>();
  await write(
    `<section class="pdf-page pdf-page--semantic pdf-page--flow" data-page="${page.number}">`,
  );
  for (const block of structured.blocks) {
    const blockY = semanticBlockY(block);
    let emittedAsCaption = false;
    while (media[mediaIndex] && emittedMedia.has(media[mediaIndex] as SemanticMedia))
      mediaIndex += 1;
    while ((media[mediaIndex]?.bounds.y ?? -Infinity) >= blockY) {
      const item = media[mediaIndex];
      if (item && captions.get(block) === item && block.type === "paragraph") {
        await write(
          `<figure class="pdf-semantic-figure">${item.html}<figcaption>${semanticTextHtml(block.text, block.lines, defaultColor)}</figcaption></figure>`,
        );
        emittedMedia.add(item);
        mediaIndex += 1;
        emittedAsCaption = true;
        break;
      }
      if (item && captionedMedia.has(item)) break;
      await write(`<div class="pdf-semantic-visual">${item?.html}</div>`);
      mediaIndex += 1;
    }
    const associatedMedia = captions.get(block);
    if (!emittedAsCaption && associatedMedia && block.type === "paragraph") {
      await write(
        `<figure class="pdf-semantic-figure">${associatedMedia.html}<figcaption>${semanticTextHtml(block.text, block.lines, defaultColor)}</figcaption></figure>`,
      );
      emittedMedia.add(associatedMedia);
      emittedAsCaption = true;
    }
    if (emittedAsCaption) continue;
    if (block.type === "table") await write(tableToHtml(block.table));
    else if (block.type === "heading") {
      await write(
        `<h${block.level}>${semanticTextHtml(block.text, block.lines, defaultColor, false)}</h${block.level}>`,
      );
    } else if (block.type === "paragraph") {
      await write(
        `<p${directionAttribute(block.lines.flatMap((line) => line.spans))}>${semanticTextHtml(block.text, block.lines, defaultColor)}</p>`,
      );
    } else if (block.type === "preformatted") {
      await write(`<pre>${escapeHtml(block.text)}</pre>`);
    } else if (block.type === "definitionList") {
      await write("<dl>");
      for (const entry of block.entries) {
        await write(
          `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`,
        );
      }
      await write("</dl>");
    } else if (block.type === "cardList") {
      await write('<div class="pdf-semantic-cards">');
      for (const item of block.items) {
        await write(`<article><h3>${escapeHtml(item.title)}</h3>`);
        for (const detail of item.details) await write(`<p>${escapeHtml(detail)}</p>`);
        await write("</article>");
      }
      await write("</div>");
    } else if (block.type === "sectionGroup") {
      await write('<div class="pdf-semantic-sections">');
      for (const item of block.items) {
        await write(`<section><h3>${escapeHtml(item.label)}</h3>`);
        for (const content of item.content) await write(`<p>${escapeHtml(content)}</p>`);
        await write("</section>");
      }
      await write("</div>");
    } else if (block.type === "employment") {
      await write(
        `<section><h3>${escapeHtml(block.role)}</h3><p>${escapeHtml(block.organization)}</p><p>${escapeHtml(block.date)}</p></section>`,
      );
    } else if (block.type === "insetGroup") {
      await write(
        `<div class="pdf-semantic-inset" style="margin-inline-start:${number(block.indentEm)}em">${block.blocks.map((item) => nestedSemanticBlockHtml(item, defaultColor)).join("")}</div>`,
      );
    } else {
      const tag = block.ordered ? "ol" : "ul";
      await write(`<${tag}>`);
      for (const item of block.items) {
        await write(`<li>${semanticTextHtml(item.text, item.lines, defaultColor)}</li>`);
      }
      await write(`</${tag}>`);
    }
  }
  while (mediaIndex < media.length) {
    const item = media[mediaIndex];
    if (item && !emittedMedia.has(item)) {
      await write(`<div class="pdf-semantic-visual">${item.html}</div>`);
    }
    mediaIndex += 1;
  }
  await write("</section>");
}

function nestedSemanticBlockHtml(block: SemanticBlock, defaultColor: string): string {
  if (block.type === "insetGroup") {
    return `<div class="pdf-semantic-inset" style="margin-inline-start:${number(block.indentEm)}em">${block.blocks.map((item) => nestedSemanticBlockHtml(item, defaultColor)).join("")}</div>`;
  }
  if (block.type === "table") return tableToHtml(block.table);
  if (block.type === "heading") {
    return `<h${block.level}>${semanticTextHtml(block.text, block.lines, defaultColor, false)}</h${block.level}>`;
  }
  if (block.type === "paragraph") {
    return `<p>${semanticTextHtml(block.text, block.lines, defaultColor)}</p>`;
  }
  if (block.type === "preformatted") return `<pre>${escapeHtml(block.text)}</pre>`;
  if (block.type === "definitionList") {
    return `<dl>${block.entries.map((entry) => `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`).join("")}</dl>`;
  }
  if (block.type === "cardList") {
    return `<div class="pdf-semantic-cards">${block.items.map((item) => `<article><h3>${escapeHtml(item.title)}</h3>${item.details.map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}</article>`).join("")}</div>`;
  }
  if (block.type === "sectionGroup") {
    return `<div class="pdf-semantic-sections">${block.items.map((item) => `<section><h3>${escapeHtml(item.label)}</h3>${item.content.map((content) => `<p>${escapeHtml(content)}</p>`).join("")}</section>`).join("")}</div>`;
  }
  if (block.type === "employment") {
    return `<section><h3>${escapeHtml(block.role)}</h3><p>${escapeHtml(block.organization)}</p><p>${escapeHtml(block.date)}</p></section>`;
  }
  const tag = block.ordered ? "ol" : "ul";
  return `<${tag}>${block.items.map((item) => `<li>${semanticTextHtml(item.text, item.lines, defaultColor)}</li>`).join("")}</${tag}>`;
}

function semanticBlockY(block: SemanticBlock): number {
  const lines = block.type === "list" ? block.items.flatMap((item) => item.lines) : block.lines;
  return Math.max(...lines.map((line) => line.bounds.y + line.bounds.height));
}

function visualText(
  span: TextSpan,
  pageHeight: number,
  fontAliases: Map<string, string>,
  counterRotateReflectedText = false,
  styleClasses?: Map<string, string>,
): string {
  if (span.renderingMode === 3 || span.renderingMode === 7) return "";
  if (!span.fontAssetId && isAdobeCjkFont(span.fontFamily)) return "";
  const direction = directionAttribute([span]);
  const style = visualTextStyle(span, fontAliases);
  const styleClass = styleClasses?.get(style);
  const presentation = styleClass ? ` class="${styleClass}"` : style ? ` style="${style}"` : "";
  const textExtent = span.direction === "ttb" ? span.bounds.height : span.bounds.width;
  const textLength =
    textExtent > 0 && !isHebrewPaintOrder(span)
      ? ` textLength="${number(textExtent)}" lengthAdjust="${span.direction === "ttb" || usesSpacingAdjustment(span) ? "spacing" : "spacingAndGlyphs"}"`
      : "";
  const transform =
    counterRotateReflectedText && span.transform
      ? ([
          span.transform[0],
          span.transform[1],
          span.transform[2],
          -span.transform[3],
        ] as TextSpan["transform"])
      : span.transform;
  const transformed = hasNonIdentityTransform(transform);
  const rtlOffset = span.direction === "rtl" ? span.bounds.width : 0;
  const basisX = transform?.[0] ?? 1;
  const basisY = transform?.[1] ?? 0;
  const anchorX = span.bounds.x + basisX * rtlOffset;
  const anchorY = pageHeight - span.bounds.y + basisY * rtlOffset;
  const position = transformed
    ? ` x="0" y="0" transform="matrix(${transform?.map(number).join(" ")} ${number(anchorX)} ${number(anchorY)})"`
    : ` x="${number(anchorX)}" y="${number(anchorY)}"`;
  return `<text${direction}${position} font-size="${number(span.fontSize)}"${textLength}${presentation}>${escapeHtml(span.text)}</text>`;
}

function visualTextStyle(span: TextSpan, fontAliases: Map<string, string>): string {
  const font = visualFontStyles(
    span.fontFamily,
    span.fontAssetId ? fontAliases.get(span.fontAssetId) : undefined,
  ).join(";");
  const stroke = isCssHexColor(span.strokeColor) ? `stroke:${span.strokeColor}` : "";
  const strokeWidth =
    stroke && Number.isFinite(span.strokeWidth) && (span.strokeWidth ?? -1) >= 0
      ? `stroke-width:${number(span.strokeWidth ?? 0)}`
      : "";
  const strokeOnly = span.renderingMode === 1 || span.renderingMode === 5;
  const fillOpacity = isUnitInterval(span.fillOpacity)
    ? `fill-opacity:${number(span.fillOpacity)}`
    : "";
  const strokeOpacity = isUnitInterval(span.strokeOpacity)
    ? `stroke-opacity:${number(span.strokeOpacity)}`
    : "";
  return [
    isHebrewPaintOrder(span) ? "unicode-bidi:bidi-override;direction:ltr" : "",
    span.direction === "ttb" ? "writing-mode:vertical-rl" : "",
    strokeOnly ? "fill:none" : isCssHexColor(span.color) ? `fill:${span.color}` : "",
    stroke,
    strokeWidth,
    fillOpacity,
    strokeOpacity,
    font,
  ]
    .filter(Boolean)
    .join(";");
}

function isAdobeCjkFont(fontFamily: string | undefined): boolean {
  return /^Adobe(?:Heiti|Song|Kaiti|Ming|Gothic|Mincho)Std-/i.test(fontFamily ?? "");
}

function visualType3Text(span: TextSpan, font: EmbeddedType3Font, pageHeight: number): string {
  if (span.renderingMode === 3 || span.renderingMode === 7) return "";
  const glyphs = new Map(font.glyphs.map((glyph) => [glyph.code, glyph]));
  const sequence = (span.glyphCodes ?? []).map((code) => glyphs.get(code));
  const totalAdvance = sequence.reduce((total, glyph) => total + (glyph?.advance ?? 0), 0);
  if (totalAdvance <= 0 || span.bounds.width <= 0 || span.fontSize <= 0) return "";
  const transform = span.transform ?? [1, 0, 0, 1];
  const outer = `matrix(${transform.map(number).join(" ")} ${number(span.bounds.x)} ${number(pageHeight - span.bounds.y)})`;
  const xScale = span.bounds.width / totalAdvance;
  let offset = 0;
  let content = "";
  for (const glyph of sequence) {
    if (!glyph) continue;
    content += `<g transform="translate(${number(offset)} 0)">${type3Glyph(glyph, span.color)}</g>`;
    offset += glyph.advance;
  }
  return `<g transform="${outer}"><g transform="scale(${number(xScale)} ${number(-span.fontSize)})">${content}</g></g>`;
}

function isHebrewPaintOrder(span: TextSpan): boolean {
  return span.direction === "ltr" && /[\u0590-\u05ff]/u.test(span.text);
}

function usesSpacingAdjustment(span: TextSpan): boolean {
  return !span.fontAssetId && /arial/i.test(span.fontFamily ?? "");
}

function type3Glyph(glyph: Type3Glyph, textColor?: string): string {
  let output = "";
  for (const fill of glyph.fills ?? []) {
    const color = glyph.usesTextColor && isCssHexColor(textColor) ? textColor : fill.color;
    if (!isCssHexColor(color)) continue;
    const points = fill.points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
    const opacity = isUnitInterval(fill.opacity) ? ` fill-opacity="${number(fill.opacity)}"` : "";
    output += `<polygon points="${points}" fill="${color}"${opacity}/>`;
  }
  for (const path of glyph.paths ?? []) {
    if (!isSvgPath(path.d)) continue;
    const fill =
      glyph.usesTextColor && isCssHexColor(textColor)
        ? textColor
        : isCssHexColor(path.fill)
          ? path.fill
          : "none";
    const stroke =
      glyph.usesTextColor && isCssHexColor(textColor) && path.stroke
        ? textColor
        : isCssHexColor(path.stroke)
          ? path.stroke
          : "none";
    const width =
      path.strokeWidth !== undefined && Number.isFinite(path.strokeWidth) && path.strokeWidth >= 0
        ? ` stroke-width="${number(path.strokeWidth)}"`
        : "";
    output += `<path d="${path.d}" fill="${fill}" stroke="${stroke}"${width}/>`;
  }
  return (glyph.fills?.length ?? 0) > 64 && glyph.advance > 2
    ? `<g shape-rendering="crispEdges">${output}</g>`
    : output;
}

function isCssHexColor(value: string | undefined): value is string {
  return /^#[\da-f]{6}$/i.test(value ?? "");
}

function isUnitInterval(value: number | undefined): value is number {
  return Number.isFinite(value) && (value ?? -1) >= 0 && (value ?? 2) <= 1;
}

function isMonospace(fontFamily: string | undefined): boolean {
  return /courier|mono/i.test(fontFamily ?? "");
}

function usesPositionedSpan(span: TextSpan): boolean {
  return (
    !span.glyphCodes && isMonospace(span.fontFamily) && !hasNonIdentityTransform(span.transform)
  );
}

function hasNonIdentityTransform(transform: TextSpan["transform"]): boolean {
  if (!transform) return false;
  const identity: [number, number, number, number] = [1, 0, 0, 1];
  return transform.some((value, index) => Math.abs(value - (identity[index] ?? 0)) > 0.000_001);
}

function directionAttribute(spans: TextSpan[]): string {
  const rtl = spans.filter((span) => span.direction === "rtl").length;
  const vertical = spans.filter((span) => span.direction === "ttb").length;
  if (vertical > rtl && vertical * 2 >= spans.length) return ' data-direction="ttb"';
  return rtl * 2 >= spans.length && spans.length > 0 ? ' dir="rtl"' : "";
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

function resolveImageOptions(profile: HtmlProfile, options: HtmlWriterOptions): HtmlImageOptions {
  return options.imageOptions ?? (profile === "semantic" ? "excluded" : "embedded");
}

function validateImageOptions(
  imageOptions: HtmlImageOptions,
  options: Pick<HtmlWriterOptions, "onImage">,
): void {
  if (imageOptions === "references" && !options.onImage) {
    throw new Error('imageOptions "references" requires an onImage callback');
  }
}
