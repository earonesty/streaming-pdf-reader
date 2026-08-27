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
  /** Text fill color serialized as a six-digit CSS hex value. */
  color?: string | undefined;
  fontSize: number;
  source: SourceRef;
}

export interface ExtractedPage {
  number: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
  spans: TextSpan[];
}
