import type {
  EmbeddedFont,
  EmbeddedType3Font,
  ExtractedPage,
  RasterImage,
  TextSpan,
  Type3Glyph,
  VectorPath,
} from "@boxpdf/reader";
import { structurePage, tableToHtml } from "@boxpdf/reader/structure";
import { type SemanticDocumentStats, writeSemanticDocument } from "./semantic-document.js";

export type { SemanticDocumentStats } from "./semantic-document.js";

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
}

const styles = `.pdf-document{margin:0 auto}.pdf-page{box-sizing:border-box;margin:1rem auto;background:#fff;color:#000}.pdf-page--visual,.pdf-page--positioned{position:relative;overflow:hidden}.pdf-page-content{position:absolute;transform-origin:0 0}.pdf-span{position:absolute;white-space:pre;transform-origin:left bottom;unicode-bidi:isolate}.pdf-span[data-direction=ttb]{writing-mode:vertical-rl}.pdf-page--semantic,.pdf-page--flow{max-width:60rem;padding:1rem}.pdf-page--semantic p,.pdf-page--flow p{white-space:pre-wrap;unicode-bidi:plaintext}.pdf-page table{border-collapse:collapse}.pdf-page td{padding:.15rem .4rem;vertical-align:top}`;

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
  if (resolveProfile(options) === "semantic") {
    const lookahead = semanticLookahead(options.semanticLookaheadPages);
    const stats = await writeSemanticDocument(pages, write, lookahead);
    options.onSemanticStats?.(stats);
  } else {
    for await (const page of pages) await writePage(page, write, options);
  }
  await write("</main>");
  if (includeDocument) await write("</body></html>");
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
  const visualSpans = page.visualSpans ?? page.spans;
  const reflectedOverlay = usesReflectedVisualOverlay(page, visualSpans);
  const quarterTurn = page.rotate === 90 || page.rotate === 270;
  const displayWidth = quarterTurn ? page.height : page.width;
  const displayHeight = quarterTurn ? page.width : page.height;
  await write(
    `<section class="pdf-page pdf-page--visual pdf-page--positioned" data-page="${page.number}" data-rotate="${page.rotate}" style="width:${number(displayWidth)}pt;height:${number(displayHeight)}pt">`,
  );
  const fontAliases = new Map(
    (page.fonts ?? [])
      .filter((font) => font.format === "truetype" && !/(?:courier|^TTE)/i.test(font.family ?? ""))
      .map((font) => [font.id, `boxpdf-${page.number}-${font.id}`]),
  );
  const type3Fonts = new Map(
    (page.fonts ?? [])
      .filter((font): font is EmbeddedType3Font => font.format === "type3")
      .map((font) => [font.id, font]),
  );
  if ((options.includeStyles ?? true) && page.fonts?.length) {
    await write(`<style>${page.fonts.map((font) => fontFace(font, fontAliases)).join("")}</style>`);
  }
  await write(
    `<div class="pdf-page-content pdf-page-content--${page.rotate}" style="width:${number(page.width)}pt;height:${number(page.height)}pt${rotationTransform(page)}">`,
  );
  await write(
    `<svg class="pdf-visual-text" xmlns="http://www.w3.org/2000/svg" width="${number(page.width)}pt" height="${number(page.height)}pt" viewBox="0 0 ${number(page.width)} ${number(page.height)}">`,
  );
  const clipDefinitions =
    imageClipDefinitions(page.images ?? [], page.number, page.height) +
    pathClipDefinitions(page.paths ?? [], page.number);
  if (clipDefinitions) await write(`<defs>${clipDefinitions}</defs>`);
  if (reflectedOverlay) {
    for (const [index, image] of (page.images ?? []).entries()) {
      await write(visualImage(image, page.height, page.number, index));
    }
  }
  for (const fill of page.fills ?? []) {
    const points = fill.points.map(([x, y]) => `${number(x)},${number(page.height - y)}`).join(" ");
    if (isCssHexColor(fill.color)) {
      const opacity = isUnitInterval(fill.opacity) ? ` fill-opacity="${number(fill.opacity)}"` : "";
      await write(`<polygon points="${points}" fill="${fill.color}"${opacity}/>`);
    }
  }
  if (page.paths?.length) {
    await write(`<g transform="translate(0 ${number(page.height)}) scale(1 -1)">`);
    for (const [pathIndex, path] of page.paths.entries()) {
      if (!isSvgPath(path.d)) continue;
      const fill = isCssHexColor(path.fill) ? path.fill : "none";
      const stroke = isCssHexColor(path.stroke) ? path.stroke : "none";
      const strokeWidth =
        path.strokeWidth !== undefined && Number.isFinite(path.strokeWidth) && path.strokeWidth >= 0
          ? ` stroke-width="${number(path.strokeWidth)}"`
          : "";
      const fillRule = path.fillRule ? ` fill-rule="${path.fillRule}"` : "";
      const fillOpacity = isUnitInterval(path.fillOpacity)
        ? ` fill-opacity="${number(path.fillOpacity)}"`
        : "";
      const strokeOpacity = isUnitInterval(path.strokeOpacity)
        ? ` stroke-opacity="${number(path.strokeOpacity)}"`
        : "";
      const dasharray = path.strokeDasharray?.every((value) => Number.isFinite(value) && value >= 0)
        ? ` stroke-dasharray="${path.strokeDasharray.map(number).join(" ")}"`
        : "";
      const dashoffset = Number.isFinite(path.strokeDashoffset)
        ? ` stroke-dashoffset="${number(path.strokeDashoffset ?? 0)}"`
        : "";
      const linecap = path.strokeLinecap ? ` stroke-linecap="${path.strokeLinecap}"` : "";
      const linejoin = path.strokeLinejoin ? ` stroke-linejoin="${path.strokeLinejoin}"` : "";
      let output = `<path d="${path.d}" fill="${fill}" stroke="${stroke}"${strokeWidth}${fillOpacity}${strokeOpacity}${dasharray}${dashoffset}${linecap}${linejoin}${fillRule}/>`;
      for (let index = (path.clips?.length ?? 0) - 1; index >= 0; index -= 1) {
        output = `<g clip-path="url(#${pathClipId(page.number, pathIndex, index)})">${output}</g>`;
      }
      await write(output);
    }
    await write("</g>");
  }
  if (!reflectedOverlay) {
    for (const [index, image] of (page.images ?? []).entries()) {
      await write(visualImage(image, page.height, page.number, index));
    }
  }
  for (const span of visualSpans) {
    if (!usesPositionedSpan(span)) {
      const type3 = span.fontAssetId ? type3Fonts.get(span.fontAssetId) : undefined;
      await write(
        type3
          ? visualType3Text(span, type3, page.height)
          : visualText(span, page.height, fontAliases, reflectedOverlay && page.rotate === 180),
      );
    }
  }
  await write("</svg>");
  for (const span of visualSpans) {
    if (usesPositionedSpan(span)) await write(positionedSpan(span, fontAliases));
  }
  await write("</div></section>");
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
): string {
  const [a, b, c, d, e, f] = image.transform;
  const transform = [a, -b, -c, d, c + e, pageHeight - d - f].map(number).join(" ");
  const opacity = isUnitInterval(image.opacity) ? ` opacity="${number(image.opacity)}"` : "";
  const mime = image.format === "jpeg" ? "image/jpeg" : "image/bmp";
  const data = image.format === "jpeg" ? image.data : rgbBmp(image);
  let output = `<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${transform})" href="data:${mime};base64,${base64(data)}"${opacity}/>`;
  for (let index = (image.clips?.length ?? 0) - 1; index >= 0; index -= 1) {
    output = `<g clip-path="url(#${imageClipId(pageNumber, imageIndex, index)})">${output}</g>`;
  }
  return output;
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

function pathClipDefinitions(paths: VectorPath[], pageNumber: number): string {
  return paths
    .flatMap((path, pathIndex) =>
      (path.clips ?? []).map((clip, clipIndex) => {
        if (!isSvgPath(clip.d)) return "";
        const fillRule = clip.fillRule ? ` clip-rule="${clip.fillRule}"` : "";
        return `<clipPath id="${pathClipId(pageNumber, pathIndex, clipIndex)}" clipPathUnits="userSpaceOnUse"><path d="${clip.d}"${fillRule}/></clipPath>`;
      }),
    )
    .join("");
}

function pathClipId(pageNumber: number, pathIndex: number, clipIndex: number): string {
  return `boxpdf-path-clip-${pageNumber}-${pathIndex}-${clipIndex}`;
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
    ...fontStyles(
      span.fontFamily,
      span.fontAssetId ? fontAliases.get(span.fontAssetId) : undefined,
    ),
  ].join(";");
  return `<span class="pdf-span"${direction} style="${style}">${escapeHtml(span.text)}</span>`;
}

async function writeFlowPage(page: ExtractedPage, write: HtmlWrite): Promise<void> {
  const structured = structurePage(page);
  await write(
    `<section class="pdf-page pdf-page--semantic pdf-page--flow" data-page="${page.number}">`,
  );
  for (const block of structured.blocks) {
    if (block.type === "table") await write(tableToHtml(block.table));
    else if (block.type === "heading") {
      await write(`<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`);
    } else if (block.type === "paragraph") {
      await write(
        `<p${directionAttribute(block.lines.flatMap((line) => line.spans))}>${escapeHtml(block.text)}</p>`,
      );
    } else if (block.type === "definitionList") {
      await write("<dl>");
      for (const entry of block.entries) {
        await write(
          `<div><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.description)}</dd></div>`,
        );
      }
      await write("</dl>");
    } else {
      const tag = block.ordered ? "ol" : "ul";
      await write(`<${tag}>`);
      for (const item of block.items) await write(`<li>${escapeHtml(item.text)}</li>`);
      await write(`</${tag}>`);
    }
  }
  await write("</section>");
}

function visualText(
  span: TextSpan,
  pageHeight: number,
  fontAliases: Map<string, string>,
  counterRotateReflectedText = false,
): string {
  if (span.renderingMode === 3 || span.renderingMode === 7) return "";
  if (!span.fontAssetId && isAdobeCjkFont(span.fontFamily)) return "";
  const direction = directionAttribute([span]);
  const font = fontStyles(
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
  const style = [
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
  return `<text${direction}${position} font-size="${number(span.fontSize)}"${textLength}${style ? ` style="${style}"` : ""}>${escapeHtml(span.text)}</text>`;
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
    content += `<g transform="translate(${number(offset)} 0)">${type3Glyph(glyph)}</g>`;
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

function type3Glyph(glyph: Type3Glyph): string {
  let output = "";
  for (const fill of glyph.fills ?? []) {
    if (!isCssHexColor(fill.color)) continue;
    const points = fill.points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
    const opacity = isUnitInterval(fill.opacity) ? ` fill-opacity="${number(fill.opacity)}"` : "";
    output += `<polygon points="${points}" fill="${fill.color}"${opacity}/>`;
  }
  for (const path of glyph.paths ?? []) {
    if (!isSvgPath(path.d)) continue;
    const fill = isCssHexColor(path.fill) ? path.fill : "none";
    const stroke = isCssHexColor(path.stroke) ? path.stroke : "none";
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

function isSvgPath(value: string): boolean {
  return value.length <= 1_000_000 && /^[\d\s.,+\-eEMmLlCcZz]+$/.test(value);
}

function fontStyles(fontFamily: string | undefined, alias?: string): string[] {
  const normalized = fontFamily?.toLowerCase() ?? "";
  const styles: string[] = [];
  let fallback: string | undefined;
  if (/courier|mono|nimbusmono|^cmtt/.test(normalized)) {
    fallback = "Courier New,Courier,monospace";
  } else if (
    /times|minion|serif|baskerville|georgia|nimbusrom|guardian.*egyp|^cm[rs]y?\d/.test(normalized)
  ) {
    fallback = "Times New Roman,Times,serif";
  } else if (/helvetica|arial|sans|nimbussan|calibre|myriad|panton|^tte/.test(normalized)) {
    fallback = "Arial,Helvetica,sans-serif";
  } else if (/^mstt/.test(normalized)) {
    fallback = "Arial,Helvetica,sans-serif";
  }
  if (alias || fallback) styles.push(`font-family:${[alias, fallback].filter(Boolean).join(",")}`);
  if (/bold|black|semibold|demi|medi|^tte/.test(normalized)) styles.push("font-weight:700");
  if (/italic|oblique|slant|ital(?:$|[_-])/.test(normalized)) styles.push("font-style:italic");
  return styles;
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

function fontFace(font: EmbeddedFont, aliases: Map<string, string>): string {
  if (font.format !== "truetype") return "";
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
