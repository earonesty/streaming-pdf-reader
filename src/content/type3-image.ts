import { PdfError } from "../errors.js";
import { ValueParser } from "../syntax/parser.js";
import type { PdfValue } from "../syntax/values.js";
import type { VectorFill } from "../types.js";
import { decodeGroup4Mask } from "./ccitt.js";
import { type Matrix, multiply, transformPoint } from "./text-matrix.js";

const latin1 = new TextDecoder("latin1");
const MAX_MASK_FILLS = 100_000;

export function extractInlineImageMaskFills(bytes: Uint8Array, initialCtm: Matrix): VectorFill[] {
  const parser = new ValueParser(bytes);
  const operands: PdfValue[] = [];
  const stack: Matrix[] = [];
  let ctm = [...initialCtm] as Matrix;
  const fills: VectorFill[] = [];
  const decodeCcitt = Math.max(...initialCtm.slice(0, 4).map(Math.abs)) >= 0.005;
  while (parser.offset < bytes.length) {
    parser.skipSpace();
    if (parser.offset >= bytes.length) break;
    let value: PdfValue;
    try {
      value = parser.parseValue();
    } catch {
      break;
    }
    if (typeof value !== "string") {
      operands.push(value);
      continue;
    }
    if (value === "q") stack.push([...ctm]);
    else if (value === "Q") ctm = stack.pop() ?? ([...initialCtm] as Matrix);
    else if (value === "cm") {
      const tail = operands.slice(-6);
      if (tail.length === 6 && tail.every((item) => typeof item === "number")) {
        ctm = multiply(ctm, tail as Matrix);
      }
    } else if (value === "BI") {
      const image = readInlineMask(bytes, parser.offset, decodeCcitt);
      if (!image) break;
      fills.push(
        ...maskFills(
          image.data,
          image.width,
          image.height,
          image.paintZero,
          ctm,
          MAX_MASK_FILLS - fills.length,
        ),
      );
      parser.offset = image.end;
    }
    operands.length = 0;
  }
  return fills;
}

interface InlineMask {
  width: number;
  height: number;
  paintZero: boolean;
  data: Uint8Array;
  end: number;
}

function readInlineMask(
  bytes: Uint8Array,
  offset: number,
  decodeCcitt: boolean,
): InlineMask | undefined {
  const id = findOperator(bytes, offset, "ID");
  if (id < 0) return undefined;
  const header = latin1.decode(bytes.subarray(offset, id));
  const width = integerEntry(header, "W", "Width");
  const height = integerEntry(header, "H", "Height");
  const bits = integerEntry(header, "BPC", "BitsPerComponent") ?? 1;
  if (!width || !height || bits !== 1 || !/(?:\/IM|\/ImageMask)\s+true\b/.test(header)) {
    return undefined;
  }
  let dataStart = id + 2;
  if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
  else if (isWhitespace(bytes[dataStart])) dataStart += 1;
  const length = Math.ceil(width / 8) * height;
  const group4 = decodeCcitt && /(?:\/F|\/Filter)\s*\/?(?:CCF|CCITTFaxDecode)\b/.test(header);
  if (!group4 && dataStart + length > bytes.length) return undefined;
  const endImage = findOperator(bytes, dataStart + (group4 ? 0 : length), "EI");
  if (group4 && endImage < 0) return undefined;
  const encoded = bytes.subarray(dataStart, group4 ? endImage : dataStart + length);
  const data = group4 ? decodeGroup4Mask(encoded, width, height) : encoded;
  if (data.length !== length) return undefined;
  return {
    width,
    height,
    paintZero: group4
      ? !/(?:\/D|\/Decode)\s*\[\s*1(?:\.0*)?\s+0(?:\.0*)?\s*\]/.test(header)
      : !/(?:\/D|\/Decode)\s+\[\s*1(?:\.0*)?\s+0(?:\.0*)?\s*\]/.test(header),
    data,
    end: endImage < 0 ? dataStart + length : endImage + 2,
  };
}

function maskFills(
  data: Uint8Array,
  width: number,
  height: number,
  paintZero: boolean,
  ctm: Matrix,
  maxFills: number,
): VectorFill[] {
  const stride = Math.ceil(width / 8);
  const fills: VectorFill[] = [];
  for (let row = 0; row < height; row += 1) {
    let start = -1;
    for (let column = 0; column <= width; column += 1) {
      const byte = data[row * stride + Math.floor(column / 8)] ?? 0;
      const bit = column < width ? (byte >> (7 - (column % 8))) & 1 : paintZero ? 1 : 0;
      const painted = paintZero ? bit === 0 : bit === 1;
      if (painted && start < 0) start = column;
      if (!painted && start >= 0) {
        if (fills.length >= maxFills)
          throw new PdfError("RESOURCE_LIMIT", "Type3 mask exceeds the vector fill limit");
        const top = 1 - row / height;
        const bottom = 1 - (row + 1) / height;
        fills.push({
          points: [
            transformPoint(ctm, start / width, bottom),
            transformPoint(ctm, column / width, bottom),
            transformPoint(ctm, column / width, top),
            transformPoint(ctm, start / width, top),
          ],
          color: "#000000",
        });
        start = -1;
      }
    }
  }
  return fills;
}

function integerEntry(header: string, short: string, long: string): number | undefined {
  const match = new RegExp(`(?:/${short}|/${long})\\s+(\\d+)\\b`).exec(header);
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function findOperator(bytes: Uint8Array, offset: number, operator: string): number {
  const first = operator.charCodeAt(0);
  const second = operator.charCodeAt(1);
  for (let index = offset; index + 1 < bytes.length; index += 1) {
    if (
      bytes[index] === first &&
      bytes[index + 1] === second &&
      (index === 0 || isWhitespace(bytes[index - 1])) &&
      (index + 2 >= bytes.length || isWhitespace(bytes[index + 2]))
    ) {
      return index;
    }
  }
  return -1;
}

function isWhitespace(value: number | undefined): boolean {
  return value === 0 || value === 9 || value === 10 || value === 12 || value === 13 || value === 32;
}
