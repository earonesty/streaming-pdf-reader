import type { ExtractedPage, RasterImage, Rect, VectorFill, VectorPath } from "@boxpdf/reader";

export interface SemanticMedia {
  bounds: Rect;
  html: string;
}

export function semanticMedia(page: ExtractedPage): SemanticMedia[] {
  const output = (page.images ?? []).map((image) => rasterMedia(image));
  const vector = vectorMedia(page);
  if (vector) output.push(vector);
  return output.sort((left, right) => right.bounds.y - left.bounds.y);
}

function rasterMedia(image: RasterImage): SemanticMedia {
  const bounds = transformedUnitBounds(image.transform);
  const mime = image.format === "jpeg" ? "image/jpeg" : "image/bmp";
  const data = image.format === "jpeg" ? image.data : rgbBmp(image);
  const opacity = unitInterval(image.opacity) ? `;opacity:${number(image.opacity)}` : "";
  return {
    bounds,
    html: `<img class="pdf-semantic-media" src="data:${mime};base64,${base64(data)}" width="${number(bounds.width)}" height="${number(bounds.height)}" alt="" style="max-width:100%;height:auto${opacity}">`,
  };
}

function vectorMedia(page: ExtractedPage): SemanticMedia | undefined {
  const paths = (page.paths ?? []).filter((path) => safePath(path.d));
  const fills = page.fills ?? [];
  const bounds = unionBounds([
    ...paths.map((path) => pathBounds(path.d)),
    ...fills.map(fillBounds),
  ]);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;
  const content = fills.map(vectorFill).join("") + paths.map((path) => vectorPath(path)).join("");
  return {
    bounds,
    html: `<svg class="pdf-semantic-media" xmlns="http://www.w3.org/2000/svg" viewBox="${number(bounds.x)} ${number(page.height - bounds.y - bounds.height)} ${number(bounds.width)} ${number(bounds.height)}" style="display:block;max-width:100%;height:auto" aria-hidden="true"><g transform="translate(0 ${number(page.height)}) scale(1 -1)">${content}</g></svg>`,
  };
}

function vectorFill(fill: VectorFill): string {
  const points = fill.points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
  const opacity = unitInterval(fill.opacity) ? ` fill-opacity="${number(fill.opacity)}"` : "";
  return cssColor(fill.color) ? `<polygon points="${points}" fill="${fill.color}"${opacity}/>` : "";
}

function vectorPath(path: VectorPath): string {
  const fill = cssColor(path.fill) ? path.fill : "none";
  const stroke = cssColor(path.stroke) ? path.stroke : "none";
  const width = finiteNonnegative(path.strokeWidth)
    ? ` stroke-width="${number(path.strokeWidth)}"`
    : "";
  const fillOpacity = unitInterval(path.fillOpacity)
    ? ` fill-opacity="${number(path.fillOpacity)}"`
    : "";
  const strokeOpacity = unitInterval(path.strokeOpacity)
    ? ` stroke-opacity="${number(path.strokeOpacity)}"`
    : "";
  const dash = path.strokeDasharray?.every(finiteNonnegative)
    ? ` stroke-dasharray="${path.strokeDasharray.map(number).join(" ")}"`
    : "";
  const linecap = path.strokeLinecap ? ` stroke-linecap="${path.strokeLinecap}"` : "";
  const linejoin = path.strokeLinejoin ? ` stroke-linejoin="${path.strokeLinejoin}"` : "";
  const rule = path.fillRule ? ` fill-rule="${path.fillRule}"` : "";
  return `<path d="${path.d}" fill="${fill}" stroke="${stroke}"${width}${fillOpacity}${strokeOpacity}${dash}${linecap}${linejoin}${rule}/>`;
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

function pathBounds(path: string): Rect | undefined {
  const values = [...path.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map((match) =>
    Number(match[0]),
  );
  if (values.length < 2) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    xs.push(values[index] ?? 0);
    ys.push(values[index + 1] ?? 0);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function fillBounds(fill: VectorFill): Rect | undefined {
  if (fill.points.length === 0) return undefined;
  const xs = fill.points.map(([x]) => x);
  const ys = fill.points.map(([, y]) => y);
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

function safePath(value: string): boolean {
  return value.length <= 1_000_000 && /^[\d\s.,+\-eEMmLlCcZz]+$/.test(value);
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
