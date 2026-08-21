export interface PdfRef {
  type: "ref";
  object: number;
  generation: number;
}

export interface PdfName {
  type: "name";
  value: string;
}

export interface PdfString {
  type: "string";
  bytes: Uint8Array;
}

export type PdfArray = PdfValue[];
export type PdfDict = Map<string, PdfValue>;

export interface PdfStream {
  type: "stream";
  dict: PdfDict;
  bytes: Uint8Array;
}

export type PdfValue =
  | null
  | boolean
  | number
  | string
  | PdfName
  | PdfString
  | PdfRef
  | PdfArray
  | PdfDict
  | PdfStream;

export function isRef(value: PdfValue | undefined): value is PdfRef {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "ref"
  );
}

export function isName(value: PdfValue | undefined, name?: string): value is PdfName {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "name" &&
    (name === undefined || value.value === name)
  );
}

export function isDict(value: PdfValue | undefined): value is PdfDict {
  return value instanceof Map;
}

export function isStream(value: PdfValue | undefined): value is PdfStream {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "stream"
  );
}
