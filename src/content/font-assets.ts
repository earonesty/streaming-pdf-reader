import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict } from "../syntax/values.js";
import type { EmbeddedFont } from "../types.js";

export async function extractTrueTypeFont(
  reader: PdfObjectReader,
  font: PdfDict,
  id: string,
  family?: string,
): Promise<EmbeddedFont | undefined> {
  const programFont = await descendantFont(reader, font);
  if (!programFont) return undefined;
  const descriptor = await reader.resolveDict(programFont.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile2");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  try {
    return {
      id,
      ...(family ? { family } : {}),
      format: "truetype",
      data: await reader.decodeStream(fontFile),
    };
  } catch (error) {
    if (error instanceof Error && /exceeds configured/.test(error.message)) throw error;
    return undefined;
  }
}

async function descendantFont(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<PdfDict | undefined> {
  if (!isName(font.get("Subtype"), "Type0")) return font;
  const descendants = await reader.resolve(font.get("DescendantFonts") ?? null);
  return Array.isArray(descendants) && descendants.length > 0
    ? await reader.resolveDict(descendants[0])
    : undefined;
}
