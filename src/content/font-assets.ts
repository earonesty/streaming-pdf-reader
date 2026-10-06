import { PdfError } from "../errors.js";
import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict } from "../syntax/values.js";
import type { EmbeddedFont } from "../types.js";
import { loadCidGlyphWidths } from "./cid.js";
import { readOpenTypeTables } from "./opentype-tables.js";

/** Extract TrueType outlines from FontFile2 or a validated FontFile3 OpenType program. */
export async function extractTrueTypeFont(
  reader: PdfObjectReader,
  font: PdfDict,
  id: string,
  family?: string,
): Promise<EmbeddedFont | undefined> {
  const programFont = await descendantFont(reader, font);
  if (!programFont) return undefined;
  const descriptor = await reader.resolveDict(programFont.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile2") ?? descriptor?.get("FontFile3");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  const isOpenType = descriptor?.get("FontFile2") === undefined;
  if (isOpenType && !isName(fontFile.dict.get("Subtype"), "OpenType")) return undefined;
  try {
    const data = await reader.decodeStream(fontFile);
    if (isOpenType) {
      const tables = readOpenTypeTables(data);
      if (
        !tables ||
        !["glyf", "loca", "head", "hhea", "hmtx", "maxp"].every((tag) => tables.has(tag))
      )
        return undefined;
    }
    return {
      id,
      ...(family ? { family } : {}),
      format: "truetype",
      data,
    };
  } catch (error) {
    if (error instanceof Error && /exceeds configured/.test(error.message)) throw error;
    return undefined;
  }
}

/** Translate Unicode-to-CID mappings through a CIDFontType2's big-endian glyph-ID stream. */
export async function trueTypeGlyphMappings(
  reader: PdfObjectReader,
  font: PdfDict,
  unicodeToCid: ReadonlyMap<number, number>,
): Promise<ReadonlyMap<number, number>> {
  if (!isName(font.get("Subtype"), "Type0")) return unicodeToCid;
  const descendant = await descendantFont(reader, font);
  if (!descendant || !isName(descendant.get("Subtype"), "CIDFontType2")) return unicodeToCid;
  const mapValue = descendant.get("CIDToGIDMap");
  if (mapValue === undefined) return unicodeToCid;
  const map = await reader.resolve(mapValue);
  if (!isStream(map)) return unicodeToCid;
  let bytes: Uint8Array;
  try {
    bytes = await reader.decodeStream(map);
  } catch (error) {
    if (error instanceof PdfError && error.code === "UNSUPPORTED_FEATURE") return unicodeToCid;
    throw error;
  }
  const mappings = new Map<number, number>();
  for (const [unicode, cid] of unicodeToCid) {
    const offset = cid * 2;
    // Missing stream entries select .notdef rather than treating the CID as a GID.
    const gid =
      offset + 1 < bytes.length ? ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0) : 0;
    mappings.set(unicode, gid);
  }
  return mappings;
}

/** Convert embedded Type1 programs, preserving configured resource-limit errors. */
export async function extractType1Font(
  reader: PdfObjectReader,
  font: PdfDict,
  id: string,
  family: string | undefined,
  characters: string[],
  glyphNames: Array<string | undefined>,
): Promise<EmbeddedFont | undefined> {
  const programFont = await descendantFont(reader, font);
  if (!programFont || !isName(programFont.get("Subtype"), "Type1")) return undefined;
  const descriptor = await reader.resolveDict(programFont.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  try {
    const { convertType1Font } = await import("./type1-font-convert.js");
    return convertType1Font(
      await reader.decodeStream(fontFile),
      id,
      family,
      characters,
      glyphNames,
    );
  } catch (error) {
    if (error instanceof Error && /exceeds configured/.test(error.message)) throw error;
    return undefined;
  }
}

/** Extract and convert standalone or OpenType CFF outlines with PDF glyph mappings. */
export async function extractCffFont(
  reader: PdfObjectReader,
  font: PdfDict,
  id: string,
  family: string | undefined,
  characters: string[],
  glyphNames: Array<string | undefined>,
  unicodeToCid: ReadonlyMap<number, number>,
  widthsByName: ReadonlyMap<string | number, number>,
): Promise<EmbeddedFont | undefined> {
  const programFont = await descendantFont(reader, font);
  if (!programFont) return undefined;
  const descriptor = await reader.resolveDict(programFont.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile3");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (
    !isStream(fontFile) ||
    (!isName(fontFile.dict.get("Subtype"), "Type1C") &&
      !isName(fontFile.dict.get("Subtype"), "CIDFontType0C") &&
      !isName(fontFile.dict.get("Subtype"), "OpenType"))
  )
    return undefined;
  try {
    const data = await reader.decodeStream(fontFile);
    const cff = isName(fontFile.dict.get("Subtype"), "OpenType")
      ? readOpenTypeTables(data)?.get("CFF ")
      : data;
    if (!cff) return undefined;
    const cidWidths = await loadCidGlyphWidths(reader, font);
    const widths = new Map<string | number, number>(widthsByName);
    for (const [cid, width] of cidWidths?.widths ?? []) widths.set(cid, width);
    const { convertCffFont } = await import("./cff-font-convert.js");
    return convertCffFont(
      cff,
      id,
      family,
      characters,
      glyphNames,
      unicodeToCid,
      widths,
      cidWidths?.defaultWidth ?? 1000,
      isName(fontFile.dict.get("Subtype"), "OpenType"),
    );
  } catch (error) {
    if (error instanceof Error && /exceeds configured/.test(error.message)) throw error;
    return undefined;
  }
}

/** Resolve the first descendant of a composite font, or return a simple font. */
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
