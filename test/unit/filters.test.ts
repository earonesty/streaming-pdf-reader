import { deflate } from "pako";
import { describe, expect, it } from "vitest";
import { decodeAsciiHex, decodeFlate } from "../../src/syntax/filters.js";
import type { PdfDict } from "../../src/syntax/values.js";

function parameters(values: Record<string, number>): PdfDict {
  return new Map(Object.entries(values));
}

describe("PDF stream filters", () => {
  it("decodes PNG predictor rows using every filter type", async () => {
    const rows = [
      [10, 20, 30],
      [12, 24, 36],
      [14, 28, 42],
      [16, 32, 48],
      [18, 36, 54],
    ];
    const encoded: number[] = [];
    for (let row = 0; row < rows.length; row += 1) {
      const filter = row;
      encoded.push(filter);
      for (let column = 0; column < 3; column += 1) {
        const value = rows[row]?.[column] ?? 0;
        const left = column > 0 ? (rows[row]?.[column - 1] ?? 0) : 0;
        const up = row > 0 ? (rows[row - 1]?.[column] ?? 0) : 0;
        const upperLeft = row > 0 && column > 0 ? (rows[row - 1]?.[column - 1] ?? 0) : 0;
        const prediction =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? Math.floor((left + up) / 2)
                  : paeth(left, up, upperLeft);
        encoded.push((value - prediction) & 0xff);
      }
    }

    const decoded = await decodeFlate(
      deflate(Uint8Array.from(encoded)),
      parameters({ Predictor: 15, Columns: 3 }),
      1024,
    );
    expect([...decoded]).toEqual(rows.flat());
  });

  it("decodes TIFF horizontal differencing", async () => {
    const encoded = Uint8Array.from([10, 10, 10, 4, 4, 4]);
    const decoded = await decodeFlate(
      deflate(encoded),
      parameters({ Predictor: 2, Columns: 3 }),
      1024,
    );
    expect([...decoded]).toEqual([10, 20, 30, 4, 8, 12]);
  });

  it("rejects malformed predictors and honors output limits", async () => {
    await expect(
      decodeFlate(deflate(Uint8Array.of(0, 1)), parameters({ Predictor: 12, Columns: 2 }), 32),
    ).rejects.toThrow("partial row");
    await expect(
      decodeFlate(deflate(Uint8Array.of(1)), parameters({ Predictor: 9 }), 32),
    ).rejects.toThrow("unsupported stream predictor 9");
    await expect(decodeFlate(deflate(new Uint8Array(33)), undefined, 32)).rejects.toThrow(
      "configured limit",
    );
  });

  it("decodes ASCII hexadecimal data", () => {
    expect([...decodeAsciiHex(new TextEncoder().encode("61 62 3>ignored"), 8)]).toEqual([
      0x61, 0x62, 0x30,
    ]);
    expect(() => decodeAsciiHex(new TextEncoder().encode("0011"), 1)).toThrow("configured limit");
  });
});

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const distances = [
    Math.abs(estimate - left),
    Math.abs(estimate - up),
    Math.abs(estimate - upperLeft),
  ];
  const smallest = Math.min(...distances);
  return smallest === distances[0] ? left : smallest === distances[1] ? up : upperLeft;
}
