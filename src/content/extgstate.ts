import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isRef, type PdfDict, type PdfValue } from "../syntax/values.js";

export interface ResolvedExtendedGraphicsState {
  lineWidth?: number;
  fontName?: string;
  fontSize?: number;
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

function sameReference(left: PdfValue, right: PdfValue | undefined): boolean {
  return (
    isRef(left) &&
    isRef(right) &&
    left.object === right.object &&
    left.generation === right.generation
  );
}
