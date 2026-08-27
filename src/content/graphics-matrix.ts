import type { PdfValue } from "../syntax/values.js";

export type Matrix = [number, number, number, number, number, number];

export const identity: Matrix = [1, 0, 0, 1, 0, 0];

export function numericTail(values: PdfValue[], length: number): number[] | undefined {
  const tail = values.slice(-length);
  return tail.length === length && tail.every((value) => typeof value === "number")
    ? (tail as number[])
    : undefined;
}

export function pdfMatrix(value: PdfValue | undefined): Matrix | undefined {
  return Array.isArray(value) &&
    value.length === 6 &&
    value.every((item) => typeof item === "number")
    ? (value as Matrix)
    : undefined;
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

export function coordinates([x, y]: [number, number]): string {
  return `${number(x)} ${number(y)}`;
}

export function number(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
