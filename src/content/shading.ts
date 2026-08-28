import type { PdfObjectReader } from "../syntax/document.js";
import { isDict, isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";

export async function shadingColor(
  reader: PdfObjectReader,
  resources: PdfDict | undefined,
  name: PdfValue | undefined,
): Promise<string | undefined> {
  if (!resources || !isName(name)) return undefined;
  const shadings = await reader.resolveDict(resources.get("Shading"));
  const shading = await reader.resolveDict(shadings?.get(name.value));
  if (shading?.get("ShadingType") !== 2) return undefined;
  const colorSpace = await reader.resolve(shading.get("ColorSpace") ?? null);
  if (!isRgbColorSpace(colorSpace)) return undefined;
  const fn = await reader.resolve(shading.get("Function") ?? null);
  if (isStream(fn)) return sampledColor(reader, fn);
  if (isDict(fn)) return exponentialColor(fn);
  return undefined;
}

async function sampledColor(
  reader: PdfObjectReader,
  fn: Extract<PdfValue, { type: "stream" }>,
): Promise<string | undefined> {
  if (fn.dict.get("FunctionType") !== 0 || fn.dict.get("BitsPerSample") !== 8) return undefined;
  const size = fn.dict.get("Size");
  const sampleCount = Array.isArray(size) && typeof size[0] === "number" ? size[0] : undefined;
  if (!sampleCount || sampleCount < 1) return undefined;
  const bytes = await reader.decodeStream(fn);
  const index = Math.min(sampleCount - 1, Math.floor(sampleCount / 2)) * 3;
  if (index + 2 >= bytes.length) return undefined;
  return rgb(bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0);
}

function exponentialColor(fn: PdfDict): string | undefined {
  if (fn.get("FunctionType") !== 2) return undefined;
  const c0 = numericArray(fn.get("C0")) ?? [0];
  const c1 = numericArray(fn.get("C1")) ?? [1];
  if (c0.length < 3 || c1.length < 3) return undefined;
  return rgb(
    (255 * ((c0[0] ?? 0) + (c1[0] ?? 0))) / 2,
    (255 * ((c0[1] ?? 0) + (c1[1] ?? 0))) / 2,
    (255 * ((c0[2] ?? 0) + (c1[2] ?? 0))) / 2,
  );
}

function isRgbColorSpace(value: PdfValue): boolean {
  if (isName(value)) return value.value === "DeviceRGB";
  return Array.isArray(value) && isName(value[0]) && value[0].value === "ICCBased";
}

function numericArray(value: PdfValue | undefined): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? (value as number[])
    : undefined;
}

function rgb(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
