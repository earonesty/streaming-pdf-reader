import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isRef, type PdfDict, type PdfValue } from "../syntax/values.js";

export interface ResolvedExtendedGraphicsState {
  lineWidth?: number;
  lineCap?: number;
  lineJoin?: number;
  dashArray?: number[];
  dashPhase?: number;
  fontName?: string;
  fontSize?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
}

export async function resolveExtendedGraphicsState(
  reader: PdfObjectReader,
  resources: PdfDict | undefined,
  name: PdfValue | undefined,
): Promise<ResolvedExtendedGraphicsState | undefined> {
  if (!isName(name)) return undefined;
  const states = await reader.resolveDict(resources?.get("ExtGState"));
  const extended = await reader.resolveDict(states?.get(name.value));
  if (!extended) return undefined;
  const result: ResolvedExtendedGraphicsState = {};
  const lineWidth = extended.get("LW");
  if (typeof lineWidth === "number" && lineWidth >= 0) result.lineWidth = lineWidth;
  const lineCap = extended.get("LC");
  if (typeof lineCap === "number" && lineCap >= 0 && lineCap <= 2) result.lineCap = lineCap;
  const lineJoin = extended.get("LJ");
  if (typeof lineJoin === "number" && lineJoin >= 0 && lineJoin <= 2) result.lineJoin = lineJoin;
  const dash = extended.get("D");
  if (
    Array.isArray(dash) &&
    Array.isArray(dash[0]) &&
    dash[0].every((value) => typeof value === "number" && value >= 0) &&
    typeof dash[1] === "number"
  ) {
    result.dashArray = dash[0] as number[];
    result.dashPhase = dash[1];
  }
  const fillOpacity = normalizedOpacity(extended.get("ca"));
  const strokeOpacity = normalizedOpacity(extended.get("CA"));
  if (fillOpacity !== undefined) result.fillOpacity = fillOpacity;
  if (strokeOpacity !== undefined) result.strokeOpacity = strokeOpacity;
  const font = extended.get("Font");
  if (!Array.isArray(font) || font.length < 2 || typeof font[1] !== "number") return result;
  const resourceFonts = await reader.resolveDict(resources?.get("Font"));
  for (const [resourceName, value] of resourceFonts ?? []) {
    if (sameReference(value, font[0])) {
      result.fontName = resourceName;
      result.fontSize = font[1];
      break;
    }
  }
  return result;
}

function normalizedOpacity(value: PdfValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function sameReference(left: PdfValue, right: PdfValue | undefined): boolean {
  return (
    isRef(left) &&
    isRef(right) &&
    left.object === right.object &&
    left.generation === right.generation
  );
}
