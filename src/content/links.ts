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
    for (const span of spans) {
      const [a, b, c, d] = span.transform ?? [1, 0, 0, 1];
      const x = span.bounds.x + (a * span.bounds.width) / 2 - (c * span.bounds.height) / 2;
      const y = span.bounds.y - (b * span.bounds.width) / 2 + (d * span.bounds.height) / 2;
      const tolerance = Math.max(0.5, span.fontSize * 0.35);
      const dx = (a * span.bounds.width) / 2;
      const dy = (-b * span.bounds.width) / 2;
      // Do not apply a substring annotation to an entire unsplit text chunk.
      // Exact glyph-level splitting is intentionally outside this release.
      if (
        x >= left &&
        x <= right &&
        y >= bottom &&
        y <= top &&
        [
          [-dx, -dy],
          [dx, dy],
        ].every(
          ([ox = 0, oy = 0]) =>
            x + ox >= left - tolerance &&
            x + ox <= right + tolerance &&
            y + oy >= bottom - tolerance &&
            y + oy <= top + tolerance,
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
