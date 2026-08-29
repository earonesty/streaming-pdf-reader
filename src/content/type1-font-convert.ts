import opentype from "opentype.js";
import type { EmbeddedOpenTypeFont } from "../types.js";
import { parseType1GlyphPaths } from "./type1.js";
import { registerType1Font } from "./type1-font.js";

export function convertType1Font(
  bytes: Uint8Array,
  id: string,
  family: string | undefined,
  characters: string[],
  glyphNames: Array<string | undefined>,
): EmbeddedOpenTypeFont | undefined {
  const parsed = parseType1GlyphPaths(bytes);
  if (!parsed) return undefined;
  const parsedNames = new Set(parsed.glyphs.map((glyph) => glyph.name));
  const charactersByGlyph = new Map<string, number[]>();
  for (let code = 0; code < glyphNames.length; code += 1) {
    const glyphName = glyphNames[code];
    const character = characters[code];
    if (!glyphName || !character || [...character].length !== 1) continue;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const values = charactersByGlyph.get(glyphName) ?? [];
    if (!values.includes(codePoint)) values.push(codePoint);
    charactersByGlyph.set(glyphName, values);
  }
  const notdef = parsed.glyphs.find((glyph) => glyph.name === ".notdef") ?? {
    name: ".notdef",
    width: 0,
    commands: [],
    type2CharString: Uint8Array.of(139, 14),
  };
  const ordered = [notdef, ...parsed.glyphs.filter((glyph) => glyph.name !== ".notdef")];
  const glyphs = ordered.map((glyph, index) => {
    const path = new opentype.Path();
    for (const command of glyph.commands) {
      if (command.type === "M") path.moveTo(command.x * 1000, command.y * 1000);
      else if (command.type === "L") path.lineTo(command.x * 1000, command.y * 1000);
      else if (command.type === "C")
        path.curveTo(
          command.x1 * 1000,
          command.y1 * 1000,
          command.x2 * 1000,
          command.y2 * 1000,
          command.x * 1000,
          command.y * 1000,
        );
      else path.closePath();
    }
    const unicodes = charactersByGlyph.get(glyph.name) ?? [];
    const output = new opentype.Glyph({
      index,
      name: glyph.name,
      ...(unicodes[0] !== undefined ? { unicode: unicodes[0], unicodes } : {}),
      advanceWidth: Math.round(glyph.width * 1000),
      path,
    });
    Object.assign(output, { type2CharString: glyph.type2CharString });
    return output;
  });
  try {
    const font = new opentype.Font({
      familyName: family ?? "BoxPDF Type1",
      styleName: "Regular",
      unitsPerEm: 1000,
      ascender: 1000,
      descender: -300,
      createdTimestamp: 0,
      glyphs,
    });
    Object.assign(font.tables, { cff: { privateDict: parsed.privateDict } });
    const asset: EmbeddedOpenTypeFont = {
      id,
      ...(family ? { family } : {}),
      format: "opentype",
      data: new Uint8Array(font.toArrayBuffer()),
    };
    registerType1Font(asset, parsedNames);
    return asset;
  } catch {
    return undefined;
  }
}
