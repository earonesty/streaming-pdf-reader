import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { isDict, isName, type PdfValue } from "../syntax/values.js";
import type { TextSpan } from "../types.js";
import { decodePdfString, isPdfString } from "./pdf-string.js";

/** Attach URI annotations to their text fragments in page-local PDF coordinates. */
export async function attachPageLinks(
  reader: PdfObjectReader,
  page: ParsedPage,
  spans: TextSpan[],
): Promise<void> {
  const annotations = await optionalValue(reader, page.dict.get("Annots") ?? null);
  if (!Array.isArray(annotations)) return;
  for (const ref of annotations) {
    const annotation = await optionalValue(reader, ref);
    if (!isDict(annotation) || !isName(annotation.get("Subtype"), "Link")) continue;
    const action = await optionalValue(reader, annotation.get("A") ?? null);
    if (!isDict(action) || !isName(action.get("S"), "URI")) continue;
    const uri = await optionalValue(reader, action.get("URI") ?? null);
    if (!isPdfString(uri)) continue;
    const href = decodePdfString(uri.bytes).trim();
    // Only navigational URI actions; never emit executable schemes into HTML.
    if (
      !/^(?:https?:|mailto:)/i.test(href) ||
      [...href].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    )
      continue;
    const rawRect = await optionalValue(reader, annotation.get("Rect") ?? null);
    const rect = Array.isArray(rawRect)
      ? await Promise.all(rawRect.map((value) => optionalValue(reader, value)))
      : rawRect;
    if (
      !Array.isArray(rect) ||
      rect.length !== 4 ||
      !rect.every((v) => typeof v === "number" && Number.isFinite(v))
    )
      continue;
    const [x1, y1, x2, y2] = rect as [number, number, number, number];
    const left = Math.min(x1, x2) - page.mediaBox[0];
    const right = Math.max(x1, x2) - page.mediaBox[0];
    const bottom = Math.min(y1, y2) - page.mediaBox[1];
    const top = Math.max(y1, y2) - page.mediaBox[1];
    const rawQuads = await optionalValue(reader, annotation.get("QuadPoints") ?? null);
    const quads = Array.isArray(rawQuads)
      ? await Promise.all(rawQuads.map((value) => optionalValue(reader, value)))
      : rawQuads;
    const regions = linkRegions(quads, left, bottom, right, top, page.mediaBox);
    for (const span of spans) {
      const [a, b, c, d] = span.transform ?? [1, 0, 0, 1];
      const vertical = span.direction === "ttb";
      const x = vertical
        ? span.bounds.x + span.bounds.width / 2
        : span.bounds.x + (a * span.bounds.width) / 2 - (c * span.bounds.height) / 2;
      const y = vertical
        ? span.bounds.y - span.bounds.height / 2
        : span.bounds.y - (b * span.bounds.width) / 2 + (d * span.bounds.height) / 2;
      const tolerance = Math.max(0.5, span.fontSize * 0.35);
      const dx = vertical ? 0 : (a * span.bounds.width) / 2;
      const dy = vertical ? -span.bounds.height / 2 : (-b * span.bounds.width) / 2;
      // Do not apply a substring annotation to an entire unsplit text chunk.
      // Exact glyph-level splitting is intentionally outside this release.
      if (
        regions.some(
          (region) =>
            contains(region, x, y, 0) &&
            contains(region, x - dx, y - dy, tolerance) &&
            contains(region, x + dx, y + dy, tolerance),
        )
      )
        span.href = href;
    }
  }
}

async function optionalValue(reader: PdfObjectReader, value: PdfValue): Promise<PdfValue> {
  try {
    return await reader.resolve(value);
  } catch (error) {
    if (error instanceof Error && /^missing xref entry for object /.test(error.message))
      return null;
    throw error;
  }
}

type Point = [number, number];

/** Invalid QuadPoints fall back to Rect, including points outside Rect. */
function linkRegions(
  values: PdfValue,
  left: number,
  bottom: number,
  right: number,
  top: number,
  origin: readonly [number, number, number, number],
): Point[][] {
  if (right <= left || top <= bottom) return [];
  const fallback: Point[][] = [
    [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
    ],
  ];
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length % 8 !== 0 ||
    !values.every((v) => typeof v === "number" && Number.isFinite(v))
  )
    return fallback;
  const numbers = values as number[];
  const regions: Point[][] = [];
  for (let i = 0; i < numbers.length; i += 8) {
    const points: Point[] = [];
    for (let j = 0; j < 8; j += 2) {
      const x = (numbers[i + j] as number) - origin[0];
      const y = (numbers[i + j + 1] as number) - origin[1];
      if (x < left || x > right || y < bottom || y > top) return fallback;
      points.push([x, y]);
    }
    // Accept both perimeter and common Z-order encodings of a convex quad.
    const cx = points.reduce((sum, p) => sum + p[0], 0) / 4;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / 4;
    points.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    if (
      !points.every((p, j) => {
        const q = points[(j + 1) % 4] as Point;
        const r = points[(j + 2) % 4] as Point;
        return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) > 0;
      })
    )
      return fallback;
    regions.push(points);
  }
  return regions;
}

function contains(region: Point[], x: number, y: number, tolerance: number): boolean {
  return region.every(([ax, ay], i) => {
    const [bx, by] = region[(i + 1) % region.length] as Point;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    return cross >= -tolerance * Math.hypot(bx - ax, by - ay);
  });
}
