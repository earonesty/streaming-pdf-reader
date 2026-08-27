import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { ValueParser } from "../syntax/parser.js";
import { isDict, isName, isRef, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import type { VectorFill } from "../types.js";
import { textFillColor } from "./color.js";
import { contentStreams } from "./streams.js";

type Matrix = [number, number, number, number, number, number];
interface GraphicsState {
  ctm: Matrix;
  fillColor: string;
  stack: Array<{ ctm: Matrix; fillColor: string }>;
  pendingRectangles: Array<Array<[number, number]>>;
}

const identity: Matrix = [1, 0, 0, 1, 0, 0];

export async function extractPageFills(
  reader: PdfObjectReader,
  page: ParsedPage,
): Promise<VectorFill[]> {
  const fills: VectorFill[] = [];
  const state: GraphicsState = {
    ctm: [...identity],
    fillColor: "#000000",
    stack: [],
    pendingRectangles: [],
  };
  for (const bytes of await contentStreams(reader, page.dict.get("Contents"))) {
    await interpret(reader, bytes, state, page.resources, fills, 0, new Set());
  }
  return fills;
}

async function interpret(
  reader: PdfObjectReader,
  bytes: Uint8Array,
  state: GraphicsState,
  resources: PdfDict | undefined,
  fills: VectorFill[],
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  const parser = new ValueParser(bytes);
  const operands: PdfValue[] = [];
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
    await applyOperator(value, operands, reader, state, resources, fills, depth, activeForms);
    operands.length = 0;
  }
}

async function applyOperator(
  operator: string,
  args: PdfValue[],
  reader: PdfObjectReader,
  state: GraphicsState,
  resources: PdfDict | undefined,
  fills: VectorFill[],
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  if (operator === "q") {
    state.stack.push({ ctm: [...state.ctm], fillColor: state.fillColor });
    return;
  }
  if (operator === "Q") {
    const restored = state.stack.pop();
    state.ctm = restored?.ctm ?? [...identity];
    state.fillColor = restored?.fillColor ?? "#000000";
    return;
  }
  if (operator === "cm") {
    const matrix = numericTail(args, 6);
    if (matrix) state.ctm = multiply(state.ctm, matrix as Matrix);
    return;
  }
  if (operator === "g" || operator === "rg" || operator === "k") {
    state.fillColor = textFillColor(operator, args) ?? state.fillColor;
    return;
  }
  if (operator === "re") {
    const rectangle = numericTail(args, 4);
    if (rectangle) {
      const [x, y, width, height] = rectangle as [number, number, number, number];
      state.pendingRectangles.push([
        transformPoint(state.ctm, x, y),
        transformPoint(state.ctm, x + width, y),
        transformPoint(state.ctm, x + width, y + height),
        transformPoint(state.ctm, x, y + height),
      ]);
    }
    return;
  }
  if (["f", "F", "f*", "B", "B*", "b", "b*"].includes(operator)) {
    for (const points of state.pendingRectangles) fills.push({ points, color: state.fillColor });
    state.pendingRectangles = [];
    return;
  }
  if (["n", "S", "s"].includes(operator)) {
    state.pendingRectangles = [];
    return;
  }
  if (operator !== "Do" || depth >= reader.limits.maxFormDepth) return;
  const name = args.at(-1);
  if (!isName(name)) return;
  const xObjects = await reader.resolveDict(resources?.get("XObject"));
  const value = xObjects?.get(name.value);
  if (!value) return;
  const objectNumber = isRef(value) ? value.object : undefined;
  if (objectNumber !== undefined && activeForms.has(objectNumber)) return;
  const form = await reader.resolve(value);
  if (!isStream(form) || !isName(form.dict.get("Subtype"), "Form")) return;
  const resourceValue = form.dict.get("Resources");
  const resolvedResources =
    resourceValue === undefined ? undefined : await reader.resolve(resourceValue);
  const formResources = isDict(resolvedResources) ? resolvedResources : resources;
  const nestedForms = new Set(activeForms);
  if (objectNumber !== undefined) nestedForms.add(objectNumber);
  const nested: GraphicsState = {
    ctm: multiply(state.ctm, pdfMatrix(form.dict.get("Matrix")) ?? identity),
    fillColor: state.fillColor,
    stack: [],
    pendingRectangles: [],
  };
  await interpret(
    reader,
    await reader.decodeStream(form),
    nested,
    formResources,
    fills,
    depth + 1,
    nestedForms,
  );
}

function numericTail(values: PdfValue[], length: number): number[] | undefined {
  const tail = values.slice(-length);
  return tail.length === length && tail.every((value) => typeof value === "number")
    ? (tail as number[])
    : undefined;
}

function pdfMatrix(value: PdfValue | undefined): Matrix | undefined {
  return Array.isArray(value) &&
    value.length === 6 &&
    value.every((item) => typeof item === "number")
    ? (value as Matrix)
    : undefined;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}
