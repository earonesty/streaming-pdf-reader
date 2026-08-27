import type { PdfString, PdfValue } from "../syntax/values.js";

export function isPdfString(value: PdfValue | undefined): value is PdfString {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "string"
  );
}

export function decodePdfString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
    }
    return output;
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

export function collapseZeroPaddedSingleByteCodes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return bytes;
  for (let index = 0; index < bytes.length; index += 2) {
    if (bytes[index] !== 0) return bytes;
  }
  const collapsed = new Uint8Array(bytes.length / 2);
  for (let index = 0; index < collapsed.length; index += 1) {
    collapsed[index] = bytes[index * 2 + 1] ?? 0;
  }
  return collapsed;
}

export function containsTextShowingOperator(bytes: Uint8Array): boolean {
  return /(?:^|\s)(?:Tj|TJ|'|")(?:\s|$)/.test(new TextDecoder("latin1").decode(bytes));
}
