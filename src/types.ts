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
  bounds: Rect;
  direction: "ltr" | "rtl" | "ttb";
  /** PDF page-resource font identifier, such as `F1`. */
  fontName?: string | undefined;
  /** Resolved PDF BaseFont name with any subset prefix removed. */
  fontFamily?: string | undefined;
  /** Page-scoped identifier for an extracted embedded font program. */
  fontAssetId?: string | undefined;
  /** Text fill color serialized as a six-digit CSS hex value. */
  color?: string | undefined;
  fontSize: number;
  /** Normalized top-down visual text basis `[a,b,c,d]`; translation remains in `bounds.x/y`. */
  transform?: [number, number, number, number] | undefined;
  source: SourceRef;
}

export interface EmbeddedFont {
  id: string;
  family?: string | undefined;
  format: "truetype";
  data: Uint8Array;
}

export interface ExtractedPage {
  number: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  spans: TextSpan[];
  fonts?: EmbeddedFont[] | undefined;
}
