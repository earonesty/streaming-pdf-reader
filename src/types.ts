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
  fontName?: string | undefined;
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
