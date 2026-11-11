import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { isName } from "../syntax/values.js";
import type { TextSpan } from "../types.js";
import { decodePdfString, isPdfString } from "./pdf-string.js";

/** Attach URI annotations to their text fragments in page-local PDF coordinates. */
export async function attachPageLinks(
  reader: PdfObjectReader,
  page: ParsedPage,
  spans: TextSpan[],
): Promise<void> {
  const annotations = await reader.resolve(page.dict.get("Annots") ?? null);
  if (!Array.isArray(annotations)) return;
  for (const ref of annotations) {
    const annotation = await reader.resolveDict(ref);
    if (!annotation || !isName(annotation.get("Subtype"), "Link")) continue;
    const action = await reader.resolveDict(annotation.get("A"));
    if (!action || !isName(action.get("S"), "URI")) continue;
    const uri = await reader.resolve(action.get("URI") ?? null);
    if (!isPdfString(uri)) continue;
    const href = decodePdfString(uri.bytes).trim();
    // Only navigational URI actions; never emit executable schemes into HTML.
    if (
      !/^(?:https?:|mailto:)/i.test(href) ||
      [...href].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    )
      continue;
    const rect = await reader.resolve(annotation.get("Rect") ?? null);
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
      const x = span.bounds.x + span.bounds.width / 2;
      const y = span.bounds.y + span.bounds.height / 2;
      if (x >= left && x <= right && y >= bottom && y <= top) span.href = href;
    }
  }
}
