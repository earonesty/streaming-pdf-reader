import opentype from "opentype.js";
import type { EmbeddedOpenTypeFont } from "../types.js";
import { parseType1GlyphPaths } from "./type1.js";

const supportedGlyphs = new WeakMap<EmbeddedOpenTypeFont, Set<string>>();
const usedGlyphs = new WeakMap<EmbeddedOpenTypeFont, Set<string>>();

export function recordType1GlyphUse(
  asset: EmbeddedOpenTypeFont,
  bytes: Uint8Array,
  glyphNames: Array<string | undefined>,
): void {
  const used = usedGlyphs.get(asset) ?? new Set<string>();
  for (const code of bytes) {
    const name = glyphNames[code];
    if (name) used.add(name);
  }
  usedGlyphs.set(asset, used);
}

export function isCompleteType1Font(asset: EmbeddedOpenTypeFont): boolean {
  const supported = supportedGlyphs.get(asset);
  const used = usedGlyphs.get(asset);
  return Boolean(supported && (!used || [...used].every((name) => supported.has(name))));
}

export function convertType1Font(
  bytes: Uint8Array,
  id: string,
  family: string | undefined,
  characters: string[],
  glyphNames: Array<string | undefined>,
): EmbeddedOpenTypeFont | undefined {
  const parsed = parseType1GlyphPaths(bytes);
  if (!parsed) return undefined;
  const parsedNames = new Set(parsed.map((glyph) => glyph.name));
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
  const notdef = parsed.find((glyph) => glyph.name === ".notdef") ?? {
    name: ".notdef",
    width: 0,
    commands: [],
  };
  const ordered = [notdef, ...parsed.filter((glyph) => glyph.name !== ".notdef")];
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
    return new opentype.Glyph({
      index,
      name: glyph.name,
      ...(unicodes[0] !== undefined ? { unicode: unicodes[0], unicodes } : {}),
      advanceWidth: Math.round(glyph.width * 1000),
      path,
    });
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
    const asset: EmbeddedOpenTypeFont = {
      id,
      ...(family ? { family } : {}),
      format: "opentype",
      data: new Uint8Array(font.toArrayBuffer()),
    };
    supportedGlyphs.set(asset, parsedNames);
    return asset;
  } catch {
    return undefined;
  }
}
