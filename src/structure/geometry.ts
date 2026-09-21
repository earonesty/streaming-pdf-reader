import type { ExtractedPage, Rect, TextSpan } from "../types.js";

/**
 * Build the display-space page used by semantic inference.
 *
 * Extracted pages deliberately retain native PDF coordinates plus `/Rotate`
 * for exact positioned rendering. Semantic rows and tables need the geometry
 * a reader sees after both the text matrix and page rotation are applied.
 */
export function semanticGeometryPage(page: ExtractedPage): ExtractedPage {
  if (page.rotate === 0) return page;
  const quarterTurn = page.rotate === 90 || page.rotate === 270;
  return {
    ...page,
    width: quarterTurn ? page.height : page.width,
    height: quarterTurn ? page.width : page.height,
    rotate: 0,
    spans: page.spans.map((span) => semanticGeometrySpan(span, page)),
    ...(page.fills
      ? {
          fills: page.fills.map((fill) => ({
            ...fill,
            points: fill.points.map(([x, y]) => rotatePoint(x, y, page)),
          })),
        }
      : {}),
  };
}

function semanticGeometrySpan(span: TextSpan, page: ExtractedPage): TextSpan {
  const [a, b, c, d] = span.transform ?? [1, 0, 0, 1];
  const baseline = rotateVector(a * span.bounds.width, -b * span.bounds.width, page.rotate);
  const ascent = rotateVector(-c * span.bounds.height, d * span.bounds.height, page.rotate);
  const origin = rotatePoint(span.bounds.x, span.bounds.y, page);
  const corners: Array<[number, number]> = [
    origin,
    [origin[0] + baseline[0], origin[1] + baseline[1]],
    [origin[0] + ascent[0], origin[1] + ascent[1]],
    [origin[0] + baseline[0] + ascent[0], origin[1] + baseline[1] + ascent[1]],
  ];
  const bounds = boundingRect(corners);
  const vertical = Math.abs(baseline[1]) > Math.abs(baseline[0]);
  return {
    ...span,
    bounds,
    direction: vertical ? "ttb" : span.direction === "rtl" ? "rtl" : "ltr",
    transform: undefined,
  };
}

function rotatePoint(x: number, y: number, page: ExtractedPage): [number, number] {
  switch (page.rotate) {
    case 90:
      return [y, page.width - x];
    case 180:
      return [page.width - x, page.height - y];
    case 270:
      return [page.height - y, x];
    default:
      return [x, y];
  }
}

function rotateVector(x: number, y: number, rotate: ExtractedPage["rotate"]): [number, number] {
  switch (rotate) {
    case 90:
      return [y, -x];
    case 180:
      return [-x, -y];
    case 270:
      return [-y, x];
    default:
      return [x, y];
  }
}

function boundingRect(points: Array<[number, number]>): Rect {
  const left = Math.min(...points.map(([x]) => x));
  const bottom = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const top = Math.max(...points.map(([, y]) => y));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}
