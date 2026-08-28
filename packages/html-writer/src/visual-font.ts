import type { EmbeddedFont } from "@boxpdf/reader";

export function visualFontAliases(pageNumber: number, fonts: EmbeddedFont[]): Map<string, string> {
  return new Map(
    fonts
      .filter((font) => font.format === "truetype" && !/(?:courier|^TTE)/i.test(font.family ?? ""))
      .map((font) => [font.id, `boxpdf-${pageNumber}-${font.id}`]),
  );
}

export function visualFontFace(font: EmbeddedFont, aliases: Map<string, string>): string {
  if (font.format !== "truetype") return "";
  const alias = aliases.get(font.id);
  if (!alias) return "";
  const styles = visualFontStyles(font.family, alias).filter(
    (style) => !style.startsWith("font-family:"),
  );
  return `@font-face{font-family:${alias};src:url(data:font/ttf;base64,${base64(font.data)}) format("truetype");${styles.join(";")}}`;
}

export function visualFontStyles(fontFamily: string | undefined, alias?: string): string[] {
  const normalized = fontFamily?.toLowerCase() ?? "";
  const styles: string[] = [];
  let fallback: string | undefined;
  if (/courier|mono|nimbusmono|^cmtt/.test(normalized)) {
    fallback = "Courier New,Courier,monospace";
  } else if (
    /times|minion|serif|baskerville|georgia|nimbusrom|guardian.*egyp|^cm[rs]y?\d/.test(normalized)
  ) {
    fallback = "Times New Roman,Times,serif";
  } else if (/helvetica|arial|sans|nimbussan|calibre|myriad|panton|^tte|^mstt/.test(normalized)) {
    fallback = "Arial,Helvetica,sans-serif";
  }
  if (alias || fallback) styles.push(`font-family:${[alias, fallback].filter(Boolean).join(",")}`);
  if (/bold|black|semibold|demi|medi|^tte/.test(normalized)) styles.push("font-weight:700");
  if (/italic|oblique|slant|ital(?:$|[_-])/.test(normalized)) styles.push("font-style:italic");
  return styles;
}

export function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[third & 63] : "=";
  }
  return output;
}
