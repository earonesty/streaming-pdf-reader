import type { PdfValue } from "./values.js";

export function estimateObjectBytes(value: PdfValue, seen = new Set<object>()): number {
  if (value === null || typeof value === "boolean" || typeof value === "number") return 8;
  if (typeof value === "string") return value.length * 2;
  if (typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return 16 + value.reduce<number>((total, item) => total + estimateObjectBytes(item, seen), 0);
  }
  if (value instanceof Map) {
    let total = 32;
    for (const [key, item] of value) total += key.length * 2 + estimateObjectBytes(item, seen);
    return total;
  }
  if ("type" in value && value.type === "stream") {
    return value.bytes.byteLength + estimateObjectBytes(value.dict, seen);
  }
  if ("type" in value && value.type === "string") return value.bytes.byteLength + 16;
  if ("type" in value && value.type === "name") return value.value.length * 2 + 16;
  return 24;
}
