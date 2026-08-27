export type Matrix = [number, number, number, number, number, number];

export const identityMatrix: Matrix = [1, 0, 0, 1, 0, 0];

export function pageOriginMatrix(box: [number, number, number, number]): Matrix {
  return [1, 0, 0, 1, -box[0], -box[1]];
}

export function translate(matrix: Matrix, x: number, y: number): Matrix {
  return [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4] + x * matrix[0] + y * matrix[2],
    matrix[5] + x * matrix[1] + y * matrix[3],
  ];
}

export function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

export function pdfMatrix(value: unknown): Matrix | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    value.some((item) => typeof item !== "number")
  ) {
    return undefined;
  }
  return value as Matrix;
}

export function effectiveLineWidth(matrix: Matrix, width: number): number {
  const xScale = Math.hypot(matrix[0], matrix[1]);
  const yScale = Math.hypot(matrix[2], matrix[3]);
  return (width * (xScale + yScale)) / 2;
}
