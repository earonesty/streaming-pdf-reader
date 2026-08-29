import type { EmbeddedOpenTypeFont } from "../types.js";

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
  return !supported || !used || [...used].every((name) => supported.has(name));
}

export function registerType1Font(asset: EmbeddedOpenTypeFont, glyphs: Set<string>): void {
  supportedGlyphs.set(asset, glyphs);
}
