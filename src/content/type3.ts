import type { PdfObjectReader } from "../syntax/document.js";
import { isDict, isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import type { EmbeddedType3Font, Type3Glyph } from "../types.js";
import { extractGraphicsStream } from "./graphics.js";
import { pdfMatrix } from "./text-matrix.js";

export async function extractType3Font(
  reader: PdfObjectReader,
  font: PdfDict,
  id: string,
  family?: string,
): Promise<EmbeddedType3Font | undefined> {
  if (!isName(font.get("Subtype"), "Type3")) return undefined;
  const matrix = pdfMatrix(font.get("FontMatrix"));
  const charProcs = await reader.resolveDict(font.get("CharProcs"));
  if (!matrix || !charProcs) return undefined;
  const names = await type3CodeNames(reader, font.get("Encoding"));
  const widths = font.get("Widths");
  const firstChar = font.get("FirstChar");
  if (!Array.isArray(widths) || typeof firstChar !== "number") return undefined;
  const resourcesValue = font.get("Resources");
  const resolvedResources =
    resourcesValue === undefined ? undefined : await reader.resolve(resourcesValue);
  const resources = isDict(resolvedResources) ? resolvedResources : undefined;
  const glyphs: Type3Glyph[] = [];
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index];
    const code = firstChar + index;
    const name = names.get(code);
    if (typeof width !== "number" || !name) continue;
    const procedureValue = charProcs.get(name);
    if (procedureValue === undefined) continue;
    const procedure = await reader.resolve(procedureValue);
    if (!isStream(procedure)) continue;
    const graphics = await extractGraphicsStream(
      reader,
      await reader.decodeStream(procedure),
      resources,
      matrix,
    );
    glyphs.push({
      code,
      advance: Math.abs(width * matrix[0]),
      ...(graphics.fills.length > 0 ? { fills: graphics.fills } : {}),
      ...(graphics.paths.length > 0 ? { paths: graphics.paths } : {}),
    });
  }
  return glyphs.length > 0
    ? { id, ...(family ? { family } : {}), format: "type3", glyphs }
    : undefined;
}

async function type3CodeNames(
  reader: PdfObjectReader,
  value: PdfValue | undefined,
): Promise<Map<number, string>> {
  const resolved = value === undefined ? undefined : await reader.resolve(value);
  const differences = isDict(resolved) ? resolved.get("Differences") : undefined;
  const output = new Map<number, string>();
  if (!Array.isArray(differences)) return output;
  let code: number | undefined;
  for (const item of differences) {
    if (typeof item === "number") code = item;
    else if (isName(item) && code !== undefined) {
      output.set(code, item.value);
      code += 1;
    }
  }
  return output;
}
