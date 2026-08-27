import type { PdfValue } from "../syntax/values.js";

export function textFillColor(operator: string, values: PdfValue[]): string | undefined {
  const deviceOperator = operator.toLowerCase();
  if (deviceOperator === "g") {
    const gray = numericTail(values, 1);
    return gray ? rgbHex(gray[0] as number, gray[0] as number, gray[0] as number) : undefined;
  }
  if (deviceOperator === "rg") {
    const rgb = numericTail(values, 3);
    return rgb ? rgbHex(rgb[0] as number, rgb[1] as number, rgb[2] as number) : undefined;
  }
  if (deviceOperator === "k") {
    const cmyk = numericTail(values, 4);
    if (!cmyk) return undefined;
    const [cyan, magenta, yellow, black] = cmyk as [number, number, number, number];
    return rgbHex(
      1 - Math.min(1, cyan + black),
      1 - Math.min(1, magenta + black),
      1 - Math.min(1, yellow + black),
    );
  }
  return undefined;
}

function numericTail(values: PdfValue[], length: number): number[] | undefined {
  const tail = values.slice(-length);
  return tail.length === length && tail.every((value) => typeof value === "number")
    ? (tail as number[])
    : undefined;
}

function rgbHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
