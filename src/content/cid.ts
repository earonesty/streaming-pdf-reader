import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import { parseTrueTypeMetrics } from "./truetype.js";

export interface CidFontMetrics {
  advance(bytes: Uint8Array): number;
  verticalAdvance?: (bytes: Uint8Array) => number;
  verticalOrigin?: (bytes: Uint8Array) => { x: number; y: number };
}

export async function loadCidMetrics(
  reader: PdfObjectReader,
  font: PdfDict,
  encoding: PdfValue | undefined,
): Promise<CidFontMetrics | undefined> {
  if (!isName(font.get("Subtype"), "Type0")) return undefined;
  const descendantsValue = font.get("DescendantFonts");
  if (descendantsValue === undefined) return undefined;
  const descendants = await reader.resolve(descendantsValue);
  if (!Array.isArray(descendants) || descendants.length === 0) return undefined;
  const descendant = await reader.resolveDict(descendants[0]);
  if (!descendant) return undefined;
  const defaultWidth =
    typeof descendant.get("DW") === "number" ? (descendant.get("DW") as number) / 1000 : 1;
  const widths = await readHorizontalWidths(reader, descendant);
  const advance = (bytes: Uint8Array) =>
    sumCodes(bytes, (code) => widths.get(code) ?? defaultWidth);
  if (!(await isVerticalEncoding(reader, encoding))) return { advance };
  return loadVerticalMetrics(reader, descendant, widths, defaultWidth, advance);
}

export async function embeddedCidUnicodeDecoder(
  reader: PdfObjectReader,
  font: PdfDict,
): Promise<((bytes: Uint8Array) => string) | undefined> {
  if (!isName(font.get("Subtype"), "Type0")) return undefined;
  const descendants = await reader.resolve(font.get("DescendantFonts") ?? null);
  if (!Array.isArray(descendants) || descendants.length === 0) return undefined;
  const descendant = await reader.resolveDict(descendants[0]);
  if (!descendant || !isName(descendant.get("Subtype"), "CIDFontType2")) return undefined;
  const descriptor = await reader.resolveDict(descendant.get("FontDescriptor"));
  const fontFileValue = descriptor?.get("FontFile2");
  if (fontFileValue === undefined) return undefined;
  const fontFile = await reader.resolve(fontFileValue);
  if (!isStream(fontFile)) return undefined;
  const metrics = parseTrueTypeMetrics(await reader.decodeStream(fontFile));
  if (!metrics) return undefined;
  const cidToGidValue = descendant.get("CIDToGIDMap");
  const cidToGid = cidToGidValue === undefined ? undefined : await reader.resolve(cidToGidValue);
  const mapping = isStream(cidToGid) ? await reader.decodeStream(cidToGid) : undefined;
  return (bytes) => {
    let output = "";
    for (const cid of cidCodes(bytes)) {
      const offset = cid * 2;
      const glyph =
        mapping && offset + 1 < mapping.length
          ? ((mapping[offset] ?? 0) << 8) | (mapping[offset + 1] ?? 0)
          : cid;
      const codePoint = metrics.codePointOfGlyph(glyph);
      output += codePoint === undefined ? "�" : String.fromCodePoint(codePoint);
    }
    return output;
  };
}

async function readHorizontalWidths(
  reader: PdfObjectReader,
  descendant: PdfDict,
): Promise<Map<number, number>> {
  const widths = new Map<number, number>();
  const value = descendant.get("W");
  const entries = value === undefined ? undefined : await reader.resolve(value);
  if (!Array.isArray(entries)) return widths;
  for (let index = 0; index < entries.length; ) {
    const first = entries[index];
    const next = entries[index + 1];
    if (typeof first !== "number") break;
    if (Array.isArray(next)) {
      for (const [offset, width] of next.entries()) {
        if (typeof width === "number") widths.set(first + offset, width / 1000);
      }
      index += 2;
      continue;
    }
    const last = next;
    const width = entries[index + 2];
    if (typeof last !== "number" || typeof width !== "number") break;
    for (let code = first; code <= last && code - first <= 65_536; code += 1)
      widths.set(code, width / 1000);
    index += 3;
  }
  return widths;
}

async function isVerticalEncoding(
  reader: PdfObjectReader,
  encoding: PdfValue | undefined,
): Promise<boolean> {
  if (isName(encoding) && encoding.value.endsWith("-V")) return true;
  if (!isStream(encoding)) return false;
  const source = new TextDecoder("latin1").decode(await reader.decodeStream(encoding));
  return /\/WMode\s+1\b/.test(source);
}

async function loadVerticalMetrics(
  reader: PdfObjectReader,
  descendant: PdfDict,
  widths: Map<number, number>,
  defaultWidth: number,
  advance: (bytes: Uint8Array) => number,
): Promise<CidFontMetrics> {
  const defaults = descendant.get("DW2");
  const defaultOriginY =
    Array.isArray(defaults) && typeof defaults[0] === "number" ? defaults[0] / 1000 : 0.88;
  const defaultAdvance =
    Array.isArray(defaults) && typeof defaults[1] === "number" ? -defaults[1] / 1000 : 1;
  const advances = new Map<number, number>();
  const origins = new Map<number, { x: number; y: number }>();
  const value = descendant.get("W2");
  const entries = value === undefined ? undefined : await reader.resolve(value);
  if (Array.isArray(entries)) readVerticalWidths(entries, advances, origins);
  return {
    advance,
    verticalAdvance: (bytes) => sumCodes(bytes, (code) => advances.get(code) ?? defaultAdvance),
    verticalOrigin(bytes) {
      const code = cidCodes(bytes)[0] ?? 0;
      return origins.get(code) ?? { x: (widths.get(code) ?? defaultWidth) / 2, y: defaultOriginY };
    },
  };
}

function readVerticalWidths(
  entries: PdfValue[],
  advances: Map<number, number>,
  origins: Map<number, { x: number; y: number }>,
): void {
  for (let index = 0; index < entries.length; ) {
    const first = entries[index];
    const next = entries[index + 1];
    if (typeof first !== "number") break;
    if (Array.isArray(next)) {
      for (let offset = 0; offset + 2 < next.length; offset += 3) {
        setVerticalMetric(
          first + offset / 3,
          next[offset],
          next[offset + 1],
          next[offset + 2],
          advances,
          origins,
        );
      }
      index += 2;
      continue;
    }
    const last = next;
    const verticalWidth = entries[index + 2];
    const originX = entries[index + 3];
    const originY = entries[index + 4];
    if (typeof last !== "number") break;
    for (let code = first; code <= last && code - first <= 65_536; code += 1)
      setVerticalMetric(code, verticalWidth, originX, originY, advances, origins);
    index += 5;
  }
}

function setVerticalMetric(
  code: number,
  verticalWidth: PdfValue | undefined,
  originX: PdfValue | undefined,
  originY: PdfValue | undefined,
  advances: Map<number, number>,
  origins: Map<number, { x: number; y: number }>,
): void {
  if (typeof verticalWidth === "number") advances.set(code, -verticalWidth / 1000);
  if (typeof originX === "number" && typeof originY === "number")
    origins.set(code, { x: originX / 1000, y: originY / 1000 });
}

function sumCodes(bytes: Uint8Array, value: (code: number) => number): number {
  let total = 0;
  for (const code of cidCodes(bytes)) total += value(code);
  return total;
}

function cidCodes(bytes: Uint8Array): number[] {
  const output: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2)
    output.push(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  return output;
}
