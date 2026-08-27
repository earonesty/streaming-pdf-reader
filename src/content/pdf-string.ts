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
