export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceRef {
  page: number;
  objectNumber?: number;
  markedContentId?: string;
}

export interface TextSpan {
  text: string;
  hasLeadingSpace?: boolean | undefined;
  /** Signed PDF text-space displacement immediately before this span; positive advances. */
  textAdjustmentBefore?: number | undefined;
  bounds: Rect;
  direction: "ltr" | "rtl" | "ttb";
  /** PDF page-resource font identifier, such as `F1`. */
  fontName?: string | undefined;
  /** Resolved PDF BaseFont name with any subset prefix removed. */
  fontFamily?: string | undefined;
  /** Page-scoped identifier for an extracted embedded font program. */
  fontAssetId?: string | undefined;
  /** Original character codes for a Type3 glyph program. */
  glyphCodes?: number[] | undefined;
  /** Text fill color serialized as a six-digit CSS hex value. */
  color?: string | undefined;
  fillOpacity?: number | undefined;
  /** Text stroke color serialized as a six-digit CSS hex value. */
  strokeColor?: string | undefined;
  /** Effective text stroke width in PDF points. */
  strokeWidth?: number | undefined;
  strokeOpacity?: number | undefined;
  /** PDF text rendering mode (0-7). */
  renderingMode?: number | undefined;
  fontSize: number;
  /** Normalized top-down visual text basis `[a,b,c,d]`; translation remains in `bounds.x/y`. */
  transform?: [number, number, number, number] | undefined;
  source: SourceRef;
}

export interface EmbeddedTrueTypeFont {
  id: string;
  family?: string | undefined;
  format: "truetype";
  data: Uint8Array;
  /** Browser cmap rebuilt from PDF character codes because usable Unicode was absent. */
  visualCodeMapping?: true | undefined;
}

export interface VectorFill {
  points: Array<[number, number]>;
  color: string;
  opacity?: number | undefined;
}

export interface VectorPath {
  d: string;
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  fillOpacity?: number | undefined;
  strokeOpacity?: number | undefined;
  strokeDasharray?: number[] | undefined;
  strokeDashoffset?: number | undefined;
  strokeLinecap?: "butt" | "round" | "square" | undefined;
  strokeLinejoin?: "miter" | "round" | "bevel" | undefined;
  fillRule?: "nonzero" | "evenodd" | undefined;
  clips?: VectorClip[] | undefined;
}

export interface VectorClip {
  d: string;
  fillRule?: "nonzero" | "evenodd" | undefined;
}

export interface RasterImage {
  width: number;
  height: number;
  format: "rgb" | "jpeg";
  data: Uint8Array;
  /** PDF image-space CTM `[a,b,c,d,e,f]`. */
  transform: [number, number, number, number, number, number];
  opacity?: number | undefined;
  /** Active PDF clipping paths in page coordinates. */
  clips?: VectorClip[] | undefined;
}

export interface Type3Glyph {
  code: number;
  advance: number;
  /** Glyph program relies on the surrounding PDF text fill color. */
  usesTextColor?: true | undefined;
  fills?: VectorFill[] | undefined;
  paths?: VectorPath[] | undefined;
}

export interface EmbeddedType3Font {
  id: string;
  family?: string | undefined;
  format: "type3";
  glyphs: Type3Glyph[];
}

export type EmbeddedFont = EmbeddedTrueTypeFont | EmbeddedType3Font;

export interface ExtractedPage {
  number: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  spans: TextSpan[];
  /** Original PDF text chunks retained for presentation-oriented rendering. */
  visualSpans?: TextSpan[] | undefined;
  fonts?: EmbeddedFont[] | undefined;
  fills?: VectorFill[] | undefined;
  paths?: VectorPath[] | undefined;
  images?: RasterImage[] | undefined;
}
