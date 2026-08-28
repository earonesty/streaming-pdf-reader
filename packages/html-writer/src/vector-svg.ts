import type { Rect, VectorFill, VectorPath } from "@boxpdf/reader";

export function vectorFillSvg(fill: VectorFill): string {
  if (!isCssHexColor(fill.color)) return "";
  const points = fill.points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
  const opacity = isUnitInterval(fill.opacity) ? ` fill-opacity="${number(fill.opacity)}"` : "";
  return `<polygon points="${points}" fill="${fill.color}"${opacity}/>`;
}

export function vectorPathSvg(path: VectorPath, pageNumber: number, pathIndex: number): string {
  if (!isSvgPath(path.d)) return "";
  const fill = isCssHexColor(path.fill) ? path.fill : "none";
  const stroke = isCssHexColor(path.stroke) ? path.stroke : "none";
  const width = finiteNonnegative(path.strokeWidth)
    ? ` stroke-width="${number(path.strokeWidth)}"`
    : "";
  const fillOpacity = isUnitInterval(path.fillOpacity)
    ? ` fill-opacity="${number(path.fillOpacity)}"`
    : "";
  const strokeOpacity = isUnitInterval(path.strokeOpacity)
    ? ` stroke-opacity="${number(path.strokeOpacity)}"`
    : "";
  const dash = path.strokeDasharray?.every(finiteNonnegative)
    ? ` stroke-dasharray="${path.strokeDasharray.map(number).join(" ")}"`
    : "";
  const dashoffset = Number.isFinite(path.strokeDashoffset)
    ? ` stroke-dashoffset="${number(path.strokeDashoffset ?? 0)}"`
    : "";
  const linecap = path.strokeLinecap ? ` stroke-linecap="${path.strokeLinecap}"` : "";
  const linejoin = path.strokeLinejoin ? ` stroke-linejoin="${path.strokeLinejoin}"` : "";
  const rule = path.fillRule ? ` fill-rule="${path.fillRule}"` : "";
  let output = `<path d="${path.d}" fill="${fill}" stroke="${stroke}"${width}${fillOpacity}${strokeOpacity}${dash}${dashoffset}${linecap}${linejoin}${rule}/>`;
  for (let index = (path.clips?.length ?? 0) - 1; index >= 0; index -= 1) {
    output = `<g clip-path="url(#${vectorPathClipId(pageNumber, pathIndex, index)})">${output}</g>`;
  }
  return output;
}

export function vectorPathClipDefinitions(
  paths: ReadonlyArray<{ path: VectorPath; index: number }>,
  pageNumber: number,
): string {
  return paths
    .flatMap(({ path, index: pathIndex }) =>
      (path.clips ?? []).map((clip, clipIndex) => {
        if (!isSvgPath(clip.d)) return "";
        const rule = clip.fillRule ? ` clip-rule="${clip.fillRule}"` : "";
        return `<clipPath id="${vectorPathClipId(pageNumber, pathIndex, clipIndex)}" clipPathUnits="userSpaceOnUse"><path d="${clip.d}"${rule}/></clipPath>`;
      }),
    )
    .join("");
}

export function vectorPathBounds(path: VectorPath): Rect | undefined {
  if (!isSvgPath(path.d)) return undefined;
  const values = [...path.d.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map((match) =>
    Number(match[0]),
  );
  if (values.length < 2) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    xs.push(values[index] ?? 0);
    ys.push(values[index + 1] ?? 0);
  }
  return bounds(xs, ys);
}

export function vectorFillBounds(fill: VectorFill): Rect | undefined {
  if (fill.points.length === 0) return undefined;
  return bounds(
    fill.points.map(([x]) => x),
    fill.points.map(([, y]) => y),
  );
}

export function isSvgPath(value: string): boolean {
  return value.length <= 1_000_000 && /^[\d\s.,+\-eEMmLlCcZz]+$/.test(value);
}

function bounds(xs: number[], ys: number[]): Rect {
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function vectorPathClipId(pageNumber: number, pathIndex: number, clipIndex: number): string {
  return `boxpdf-path-clip-${pageNumber}-${pathIndex}-${clipIndex}`;
}

function isCssHexColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function finiteNonnegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function isUnitInterval(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1;
}

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}
