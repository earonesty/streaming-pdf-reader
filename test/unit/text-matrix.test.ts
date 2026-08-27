import { describe, expect, it } from "vitest";
import { pageOriginMatrix, transformPoint } from "../../src/content/text-matrix.js";

describe("PDF page coordinate normalization", () => {
  it("maps a non-zero page-box origin to HTML page coordinates", () => {
    const matrix = pageOriginMatrix([25, 40, 225, 340]);
    expect(transformPoint(matrix, 25, 40)).toEqual([0, 0]);
    expect(transformPoint(matrix, 225, 340)).toEqual([200, 300]);
  });
});
