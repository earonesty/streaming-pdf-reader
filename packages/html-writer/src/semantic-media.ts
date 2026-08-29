import type {
  ExtractedPage,
  RasterImage,
  Rect,
  TextSpan,
  VectorFill,
  VectorPath,
} from "@boxpdf/reader";
import {
  vectorFillBounds,
  vectorFillSvg,
  vectorPathBounds,
  vectorPathClipDefinitions,
  vectorPathSvg,
} from "./vector-svg.js";
import { base64, visualFontAliases, visualFontFace, visualFontStyles } from "./visual-font.js";

export interface SemanticMedia {
  bounds: Rect;
  html: string;
  markdown: string;
  consumedSpans?: TextSpan[];
  kind?: "raster" | "vector" | "composite";
  assets?: HtmlImageAsset[];
}

export interface HtmlImageAsset {
  name: string;
  mimeType: "image/bmp" | "image/jpeg" | "image/svg+xml";
  data: Uint8Array;
}

export type HtmlImageOptions = "embedded" | "references" | "excluded";

export function semanticMedia(
  page: ExtractedPage,
  imageOptions: HtmlImageOptions = "embedded",
): SemanticMedia[] {
  if (imageOptions === "excluded") return [];
  const output = (page.images ?? []).map((image, index) =>
    rasterMedia(image, page.number, index, imageOptions),
  );
  output.push(...vectorMedia(page, imageOptions));
  return mediaComponents(output, page).sort((left, right) => right.bounds.y - left.bounds.y);
}

export async function prepareSemanticMedia(
  page: ExtractedPage,
  imageOptions: HtmlImageOptions,
  onImage?: (image: Readonly<HtmlImageAsset>) => void | Promise<void>,
): Promise<SemanticMedia[]> {
  const media = semanticMedia(page, imageOptions);
  for (const item of media) {
    for (const asset of item.assets ?? []) await onImage?.(asset);
    delete item.assets;
  }
  return media;
}

function rasterMedia(
  image: RasterImage,
  pageNumber: number,
  index: number,
  imageOptions: HtmlImageOptions,
): SemanticMedia {
  const bounds = transformedUnitBounds(image.transform);
  const mime = image.format === "jpeg" ? "image/jpeg" : "image/bmp";
  const data = image.format === "jpeg" ? image.data : rgbBmp(image);
  const extension = image.format === "jpeg" ? "jpg" : "bmp";
  const name = `page-${pageNumber}-image-${index + 1}.${extension}`;
  const source = imageOptions === "references" ? name : `data:${mime};base64,${base64(data)}`;
  const opacity = unitInterval(image.opacity) ? `;opacity:${number(image.opacity)}` : "";
  return {
    bounds,
    kind: "raster",
    html: `<img class="pdf-semantic-media" src="${source}" width="${number(bounds.width)}" height="${number(bounds.height)}" alt="" style="max-width:100%;height:auto${opacity}">`,
    markdown: `![](${source})`,
    ...(imageOptions === "references" ? { assets: [{ name, mimeType: mime, data }] } : {}),
  };
}

function vectorMedia(page: ExtractedPage, imageOptions: HtmlImageOptions): SemanticMedia[] {
  const primitives: VectorPrimitive[] = [
    ...(page.paths ?? []).flatMap((path, index) => {
      const bounds = vectorPathBounds(path);
      return bounds ? [{ type: "path" as const, value: path, index, bounds }] : [];
    }),
    ...(page.fills ?? []).flatMap((fill) => {
      const bounds = vectorFillBounds(fill);
      return bounds && !isPageBackground(fill, bounds, page)
        ? [{ type: "fill" as const, value: fill, bounds }]
        : [];
    }),
  ];
  const components = vectorComponents(primitives, Math.min(36, page.width * 0.06)).filter(
    (component) =>
      component.primitives.length >= 2 ||
      component.bounds.width * component.bounds.height >= page.width * page.height * 0.002,
  );
  const aliases = visualFontAliases(page.number, page.fonts ?? []);
  const visualCodeFonts = new Set(
    (page.fonts ?? [])
      .filter(
        (font) =>
          (font.format === "truetype" || font.format === "opentype") && font.visualCodeMapping,
      )
      .map((font) => font.id),
  );
  return components.map((component, componentIndex) => {
    const bounds = component.bounds;
    const paths = component.primitives.flatMap((primitive) =>
      primitive.type === "path" ? [{ path: primitive.value, index: primitive.index }] : [],
    );
    const fills = component.primitives.flatMap((primitive) =>
      primitive.type === "fill" ? [primitive.value] : [],
    );
    const visualSpans = page.visualSpans ?? page.spans;
    const overlay = visualSpans.filter(
      (span) =>
        span.fontAssetId &&
        visualCodeFonts.has(span.fontAssetId) &&
        centerInside(span.bounds, bounds),
    );
    const consumedSpans = page.spans.filter(
      (span) =>
        span.fontAssetId &&
        visualCodeFonts.has(span.fontAssetId) &&
        centerInside(span.bounds, bounds),
    );
    const fontIds = new Set(overlay.map((span) => span.fontAssetId));
    const fontFaces = (page.fonts ?? [])
      .filter((font) => fontIds.has(font.id))
      .map((font) => visualFontFace(font, aliases))
      .join("");
    const svg = `<svg class="pdf-semantic-media" xmlns="http://www.w3.org/2000/svg" viewBox="${number(bounds.x)} ${number(page.height - bounds.y - bounds.height)} ${number(bounds.width)} ${number(bounds.height)}" style="display:block;max-width:100%;height:auto" aria-hidden="true">${fontFaces ? `<style>${fontFaces}</style>` : ""}${paths.length ? `<defs>${vectorPathClipDefinitions(paths, page.number)}</defs>` : ""}<g transform="translate(0 ${number(page.height)}) scale(1 -1)">${fills.map(vectorFillSvg).join("") + paths.map(({ path, index }) => vectorPathSvg(path, page.number, index)).join("")}</g>${overlay.map((span) => vectorText(span, page.height, aliases)).join("")}</svg>`;
    const name = `page-${page.number}-vector-${componentIndex + 1}.svg`;
    return {
      bounds,
      kind: "vector" as const,
      html:
        imageOptions === "references"
          ? `<img class="pdf-semantic-media" src="${name}" width="${number(bounds.width)}" height="${number(bounds.height)}" alt="">`
          : svg,
      markdown: imageOptions === "references" ? `![](${name})` : svg,
      ...(imageOptions === "references"
        ? {
            assets: [
              { name, mimeType: "image/svg+xml" as const, data: new TextEncoder().encode(svg) },
            ],
          }
        : {}),
      ...(consumedSpans.length > 0 ? { consumedSpans } : {}),
    };
  });
}

function mediaComponents(media: SemanticMedia[], page: ExtractedPage): SemanticMedia[] {
  const components: SemanticMedia[][] = [];
  for (const item of media) {
    if (isPageBackdrop(item.bounds, page)) {
      components.push([item]);
      continue;
    }
    const matches = components.filter(
      (component) =>
        !component.some((member) => isPageBackdrop(member.bounds, page)) &&
        component.some((member) => mediaPiecesTouch(member.bounds, item.bounds)),
    );
    if (matches.length === 0) {
      components.push([item]);
      continue;
    }
    const target = matches[0] as SemanticMedia[];
    target.push(item);
    for (const component of matches.slice(1)) {
      target.push(...component);
      components.splice(components.indexOf(component), 1);
    }
  }
  return components.map((component) => compositeMedia(component));
}

function compositeMedia(items: SemanticMedia[]): SemanticMedia {
  if (items.length === 1) return items[0] as SemanticMedia;
  const bounds = unionBounds(items.map((item) => item.bounds)) as Rect;
  const layers = items
    .map((item) => {
      const left = ((item.bounds.x - bounds.x) / bounds.width) * 100;
      const top =
        ((bounds.y + bounds.height - item.bounds.y - item.bounds.height) / bounds.height) * 100;
      const width = (item.bounds.width / bounds.width) * 100;
      const height = (item.bounds.height / bounds.height) * 100;
      return `<div style="position:absolute;left:${number(left)}%;top:${number(top)}%;width:${number(width)}%;height:${number(height)}%;overflow:hidden">${item.html}</div>`;
    })
    .join("");
  return {
    bounds,
    kind: "composite",
    html: `<div class="pdf-semantic-media pdf-semantic-media-composite" style="position:relative;max-width:100%;width:${number(bounds.width)}px;aspect-ratio:${number(bounds.width)}/${number(bounds.height)}">${layers}</div>`,
    markdown: items.map((item) => item.markdown).join("\n\n"),
    consumedSpans: items.flatMap((item) => item.consumedSpans ?? []),
    assets: items.flatMap((item) => item.assets ?? []),
  };
}

function mediaPiecesTouch(left: Rect, right: Rect): boolean {
  const xOverlap = overlap(left.x, left.width, right.x, right.width);
  const yOverlap = overlap(left.y, left.height, right.y, right.height);
  if (xOverlap > 0 && yOverlap > 0) return true;
  const horizontalGap = axisGap(left.x, left.width, right.x, right.width);
  const verticalGap = axisGap(left.y, left.height, right.y, right.height);
  if (horizontalGap <= 2 && yOverlap / Math.min(left.height, right.height) >= 0.65) return true;
  return verticalGap <= 2 && xOverlap / Math.min(left.width, right.width) >= 0.65;
}

function isPageBackdrop(bounds: Rect, page: ExtractedPage): boolean {
  return bounds.width * bounds.height >= page.width * page.height * 0.7;
}

function overlap(left: number, leftSize: number, right: number, rightSize: number): number {
  return Math.max(0, Math.min(left + leftSize, right + rightSize) - Math.max(left, right));
}

function axisGap(left: number, leftSize: number, right: number, rightSize: number): number {
  return Math.max(0, right - left - leftSize, left - right - rightSize);
}

type VectorPrimitive =
  | { type: "path"; value: VectorPath; index: number; bounds: Rect }
  | { type: "fill"; value: VectorFill; bounds: Rect };

interface VectorComponent {
  bounds: Rect;
  primitives: VectorPrimitive[];
}

function vectorComponents(primitives: VectorPrimitive[], padding: number): VectorComponent[] {
  const components: VectorComponent[] = [];
  for (const primitive of primitives) {
    const matches = components.filter((component) =>
      nearby(component.bounds, primitive.bounds, padding),
    );
    if (matches.length === 0) {
      components.push({ bounds: primitive.bounds, primitives: [primitive] });
      continue;
    }
    const target = matches[0] as VectorComponent;
    target.primitives.push(primitive);
    target.bounds = unionBounds([target.bounds, primitive.bounds]) as Rect;
    for (const component of matches.slice(1)) {
      target.primitives.push(...component.primitives);
      target.bounds = unionBounds([target.bounds, component.bounds]) as Rect;
      components.splice(components.indexOf(component), 1);
    }
  }
  return components;
}

function nearby(left: Rect, right: Rect, padding: number): boolean {
  return !(
    left.x + left.width + padding < right.x ||
    right.x + right.width + padding < left.x ||
    left.y + left.height + padding < right.y ||
    right.y + right.height + padding < left.y
  );
}

function isPageBackground(fill: VectorFill, bounds: Rect, page: ExtractedPage): boolean {
  if (!/^#f{6}$/i.test(fill.color)) return false;
  const outside =
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > page.width ||
    bounds.y + bounds.height > page.height;
  const large = bounds.width * bounds.height > page.width * page.height * 0.2;
  return outside || large;
}

export function withoutSemanticMediaSpans(
  page: ExtractedPage,
  media: SemanticMedia[],
): ExtractedPage {
  const consumed = new Set(media.flatMap((item) => item.consumedSpans ?? []));
  return consumed.size > 0
    ? { ...page, spans: page.spans.filter((span) => !consumed.has(span)) }
    : page;
}

function vectorText(span: TextSpan, pageHeight: number, aliases: Map<string, string>): string {
  if (span.renderingMode === 3 || span.renderingMode === 7) return "";
  const styles = [
    cssColor(span.color) ? `fill:${span.color}` : "",
    unitInterval(span.fillOpacity) ? `fill-opacity:${number(span.fillOpacity)}` : "",
    ...visualFontStyles(
      span.fontFamily,
      span.fontAssetId ? aliases.get(span.fontAssetId) : undefined,
    ),
  ]
    .filter(Boolean)
    .join(";");
  const anchorY = pageHeight - span.bounds.y;
  const transform = span.transform;
  const position = transform
    ? ` x="0" y="0" transform="matrix(${transform.map(number).join(" ")} ${number(span.bounds.x)} ${number(anchorY)})"`
    : ` x="${number(span.bounds.x)}" y="${number(anchorY)}"`;
  const extent = span.direction === "ttb" ? span.bounds.height : span.bounds.width;
  const length =
    extent > 0 ? ` textLength="${number(extent)}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text${position} font-size="${number(span.fontSize)}"${length}${styles ? ` style="${styles}"` : ""}>${escapeHtml(span.text)}</text>`;
}

function centerInside(inner: Rect, outer: Rect): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
}

function transformedUnitBounds([a, b, c, d, e, f]: RasterImage["transform"]): Rect {
  const points = [
    [e, f],
    [a + e, b + f],
    [c + e, d + f],
    [a + c + e, b + d + f],
  ];
  const xs = points.map(([x]) => x ?? 0);
  const ys = points.map(([, y]) => y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function unionBounds(bounds: Array<Rect | undefined>): Rect | undefined {
  const values = bounds.filter((value): value is Rect => Boolean(value));
  if (values.length === 0) return undefined;
  const x = Math.min(...values.map((value) => value.x));
  const y = Math.min(...values.map((value) => value.y));
  const right = Math.max(...values.map((value) => value.x + value.width));
  const top = Math.max(...values.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: top - y };
}

function rgbBmp(image: RasterImage): Uint8Array {
  const stride = Math.ceil((image.width * 3) / 4) * 4;
  const output = new Uint8Array(54 + stride * image.height);
  const view = new DataView(output.buffer);
  output.set([0x42, 0x4d]);
  view.setUint32(2, output.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, -image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
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

function cssColor(value: string | undefined): value is string {
  return /^#[\da-f]{6}$/i.test(value ?? "");
}

function finiteNonnegative(value: number | undefined): value is number {
  return Number.isFinite(value) && (value ?? -1) >= 0;
}

function unitInterval(value: number | undefined): value is number {
  return finiteNonnegative(value) && value <= 1;
}

function number(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1_000) / 1_000) : "0";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
