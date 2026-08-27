import type { PdfObjectReader } from "../syntax/document.js";
import { isStream, type PdfValue } from "../syntax/values.js";

export async function contentStreams(
  reader: PdfObjectReader,
  value: PdfValue | undefined,
): Promise<Uint8Array[]> {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  const output: Uint8Array[] = [];
  for (const item of values) {
    const resolved = await reader.resolve(item);
    if (!isStream(resolved)) throw new Error("page /Contents entry is not a stream");
    output.push(await reader.decodeStream(resolved));
  }
  if (output.length <= 1) return output;
  const length = output.reduce((total, bytes) => total + bytes.length + 1, 0);
  if (length > reader.limits.maxDecodedStreamBytes) {
    throw new Error("combined page content exceeds configured decoded stream byte limit");
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const bytes of output) {
    combined.set(bytes, offset);
    offset += bytes.length;
    combined[offset] = 0x0a;
    offset += 1;
  }
  return [combined];
}
