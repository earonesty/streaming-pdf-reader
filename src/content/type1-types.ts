export interface Type1Metrics {
  widthOfGlyph(glyph: string): number | undefined;
}

export interface Type1GlyphPath {
  name: string;
  width: number;
  type2CharString: Uint8Array;
  commands: Array<
    | { type: "M" | "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" }
  >;
}

export interface Type1GlyphProgram {
  glyphs: Type1GlyphPath[];
  privateDict: Record<string, number | number[]>;
}
