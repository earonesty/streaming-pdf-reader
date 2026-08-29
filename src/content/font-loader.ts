import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict } from "../syntax/values.js";
import type { EmbeddedFont } from "../types.js";
import { loadCidUnicodeGlyphMap } from "./cid-glyph-map.js";
import { decodeUtf16Bytes, decodeWithMap, parseToUnicode } from "./cmap.js";
import { type FontDecoder, loadFontEncoding } from "./encoding.js";
import { extractCffFont, extractTrueTypeFont, extractType1Font } from "./font-assets.js";
import { remapTrueTypeCmap, symbolicTrueTypeGlyphMap } from "./font-cmap.js";
import { extractType3Font } from "./type3.js";

export async function loadFonts(
  reader: PdfObjectReader,
  resources?: PdfDict,
  fontAssets: EmbeddedFont[] = [],
): Promise<Map<string, FontDecoder>> {
  const output = new Map<string, FontDecoder>();
  if (!resources) return output;
  const fonts = await reader.resolveDict(resources.get("Font"));
  if (!fonts) return output;
  for (const [name, value] of fonts) {
    const font = await reader.resolveDict(value);
    if (!font) continue;
    const toUnicodeValue = font.get("ToUnicode");
    const encoding = await loadFontEncoding(reader, font, toUnicodeValue === undefined);
    const fontAssetId = `font-${fontAssets.length + 1}`;
    const cidMappings = await loadCidUnicodeGlyphMap(reader, font, toUnicodeValue);
    const cffWidths = new Map<string | number, number>();
    if (encoding.advance && encoding.glyphTable) {
      for (let code = 0; code < encoding.glyphTable.length; code += 1) {
        const name = encoding.glyphTable[code];
        if (name) cffWidths.set(name, Math.round(encoding.advance(Uint8Array.of(code)) * 1000));
      }
    }
    const asset =
      (await extractType3Font(reader, font, fontAssetId, encoding.fontFamily)) ??
      (await extractTrueTypeFont(reader, font, fontAssetId, encoding.fontFamily)) ??
      (encoding.characterTable && encoding.glyphTable
        ? await extractType1Font(
            reader,
            font,
            fontAssetId,
            encoding.fontFamily,
            encoding.characterTable,
            encoding.glyphTable,
          )
        : undefined) ??
      (await extractCffFont(
        reader,
        font,
        fontAssetId,
        encoding.fontFamily,
        encoding.characterTable ?? [],
        encoding.glyphTable ?? [],
        cidMappings,
        cffWidths,
      ));
    if (asset) {
      if (asset.format === "truetype") {
        const symbolicMappings =
          cidMappings.size > 0
            ? new Map<number, number>()
            : await symbolicTrueTypeGlyphMap(reader, font, asset.data, encoding);
        const mappings = cidMappings.size > 0 ? cidMappings : symbolicMappings;
        asset.data = remapTrueTypeCmap(asset.data, mappings) ?? asset.data;
        if (symbolicMappings.size > 0) asset.visualCodeMapping = true;
      }
      fontAssets.push(asset);
      encoding.fontAssetId = fontAssetId;
      encoding.fontFormat = asset.format;
      encoding.fontAsset = asset;
      if (asset.format === "type3") {
        const advances = new Map(asset.glyphs.map((glyph) => [glyph.code, glyph.advance]));
        encoding.advance = (bytes) =>
          [...bytes].reduce((total, code) => total + (advances.get(code) ?? 0), 0);
      }
    }
    if (toUnicodeValue) {
      const toUnicode = await reader.resolve(toUnicodeValue);
      if (isStream(toUnicode)) {
        const unicodeMap = parseToUnicode(await reader.decodeStream(toUnicode));
        const codeBytes = unicodeMap.codeBytes ?? (isName(font.get("Subtype"), "Type0") ? 2 : 1);
        output.set(name, {
          ...fontProperties(encoding),
          decode: (bytes) => decodeWithMap(bytes, unicodeMap, codeBytes, encoding),
          codeUnitBytes: codeBytes === 2 ? 2 : 1,
        });
        continue;
      }
    }
    const namedEncoding = font.get("Encoding");
    if (
      isName(font.get("Subtype"), "Type0") &&
      isName(namedEncoding) &&
      /-UTF16-(?:H|V)$/.test(namedEncoding.value)
    ) {
      output.set(name, {
        ...fontProperties(encoding),
        decode: decodeUtf16Bytes,
        codeUnitBytes: 2,
      });
      continue;
    }
    encoding.codeUnitBytes = isName(font.get("Subtype"), "Type0") ? 2 : 1;
    output.set(name, encoding);
  }
  return output;
}

function fontProperties(encoding: FontDecoder): Omit<FontDecoder, "decode"> {
  const { decode: _, characterTable: __, ...properties } = encoding;
  return properties;
}
