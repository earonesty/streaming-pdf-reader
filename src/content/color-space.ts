import type { PdfObjectReader } from "../syntax/document.js";
import { isName, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import { textFillColor } from "./color.js";

export async function componentColor(
  reader: PdfObjectReader,
  resources: PdfDict | undefined,
  colorSpaceName: string | undefined,
  components: PdfValue[],
): Promise<string | undefined> {
  const model = await colorModel(reader, resources, colorSpaceName);
  if (!model) return undefined;
  return textFillColor(model, components);
}

async function colorModel(
  reader: PdfObjectReader,
  resources: PdfDict | undefined,
  name: string | undefined,
): Promise<"g" | "rg" | "k" | undefined> {
  if (!name) return undefined;
  if (name === "DeviceGray" || name === "G") return "g";
  if (name === "DeviceRGB" || name === "RGB") return "rg";
  if (name === "DeviceCMYK" || name === "CMYK") return "k";
  const spaces = await reader.resolveDict(resources?.get("ColorSpace"));
  const value = spaces?.get(name);
  if (value === undefined) return undefined;
  const resolved = await reader.resolve(value);
  if (isName(resolved)) return colorModel(reader, resources, resolved.value);
  if (!Array.isArray(resolved) || !isName(resolved[0])) return undefined;
  if (resolved[0].value === "ICCBased") {
    const profile = await reader.resolve(resolved[1] as PdfValue);
    if (!isStream(profile)) return undefined;
    return componentModel(profile.dict.get("N"));
  }
  if (resolved[0].value === "CalGray") return "g";
  if (resolved[0].value === "CalRGB" || resolved[0].value === "Lab") return "rg";
  return undefined;
}

function componentModel(count: PdfValue | undefined): "g" | "rg" | "k" | undefined {
  if (count === 1) return "g";
  if (count === 3) return "rg";
  if (count === 4) return "k";
  return undefined;
}
