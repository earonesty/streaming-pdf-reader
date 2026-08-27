import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { ValueParser } from "../syntax/parser.js";
import { isDict, isName, isRef, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import type { VectorFill, VectorPath } from "../types.js";
import { textFillColor } from "./color.js";
import { contentStreams } from "./streams.js";

type Matrix = [number, number, number, number, number, number];
interface GraphicsState {
  ctm: Matrix;
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  stack: Array<{ ctm: Matrix; fillColor: string; strokeColor: string; lineWidth: number }>;
  rectangles: Array<Array<[number, number]>>;
  path: string[];
  current: [number, number] | undefined;
  start: [number, number] | undefined;
  hasGeneralPath: boolean;
}

const identity: Matrix = [1, 0, 0, 1, 0, 0];

export async function extractPageGraphics(
  reader: PdfObjectReader,
  page: ParsedPage,
): Promise<{ fills: VectorFill[]; paths: VectorPath[] }> {
  const fills: VectorFill[] = [];
  const paths: VectorPath[] = [];
  const state = createState();
  for (const bytes of await contentStreams(reader, page.dict.get("Contents"))) {
    await interpret(reader, bytes, state, page.resources, fills, paths, 0, new Set());
  }
  return { fills, paths };
}

function createState(): GraphicsState {
  return {
    ctm: [...identity],
    fillColor: "#000000",
    strokeColor: "#000000",
    lineWidth: 1,
    stack: [],
    rectangles: [],
    path: [],
    current: undefined,
    start: undefined,
    hasGeneralPath: false,
  };
}

async function interpret(
  reader: PdfObjectReader,
  bytes: Uint8Array,
  state: GraphicsState,
  resources: PdfDict | undefined,
  fills: VectorFill[],
  paths: VectorPath[],
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
    await applyOperator(
      value,
      operands,
      reader,
      state,
      resources,
      fills,
      paths,
      depth,
      activeForms,
    );
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
  paths: VectorPath[],
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  if (applyGraphicsState(operator, args, state)) return;
  if (applyPathConstruction(operator, args, state)) return;
  if (["f", "F", "f*", "B", "B*", "b", "b*", "S", "s"].includes(operator)) {
    paintPath(operator, state, fills, paths);
    return;
  }
  if (operator === "n") {
    resetPath(state);
    return;
  }
  if (operator === "Do") {
    await interpretForm(reader, args, state, resources, fills, paths, depth, activeForms);
  }
}

function applyGraphicsState(operator: string, args: PdfValue[], state: GraphicsState): boolean {
  if (operator === "q") {
    state.stack.push({
      ctm: [...state.ctm],
      fillColor: state.fillColor,
      strokeColor: state.strokeColor,
      lineWidth: state.lineWidth,
    });
    return true;
  }
  if (operator === "Q") {
    const restored = state.stack.pop();
    state.ctm = restored?.ctm ?? [...identity];
    state.fillColor = restored?.fillColor ?? "#000000";
    state.strokeColor = restored?.strokeColor ?? "#000000";
    state.lineWidth = restored?.lineWidth ?? 1;
    return true;
  }
  if (operator === "cm") {
    const matrix = numericTail(args, 6);
    if (matrix) state.ctm = multiply(state.ctm, matrix as Matrix);
    return true;
  }
  if (["g", "rg", "k"].includes(operator)) {
    state.fillColor = textFillColor(operator, args) ?? state.fillColor;
    return true;
  }
  if (["G", "RG", "K"].includes(operator)) {
    state.strokeColor = textFillColor(operator, args) ?? state.strokeColor;
    return true;
  }
  if (operator === "w") {
    const width = numericTail(args, 1)?.[0];
    if (width !== undefined && width >= 0) state.lineWidth = width;
    return true;
  }
  return false;
}

function applyPathConstruction(operator: string, args: PdfValue[], state: GraphicsState): boolean {
  if (operator === "m" || operator === "l") {
    const values = numericTail(args, 2);
    if (values) {
      const point = transformPoint(state.ctm, values[0] as number, values[1] as number);
      state.path.push(`${operator === "m" ? "M" : "L"}${coordinates(point)}`);
      state.current = point;
      if (operator === "m") state.start = point;
      state.hasGeneralPath = true;
    }
    return true;
  }
  if (operator === "c") {
    const values = numericTail(args, 6);
    if (values) appendCurve(state, values as [number, number, number, number, number, number]);
    return true;
  }
  if (operator === "v" || operator === "y") {
    const values = numericTail(args, 4);
    if (values && state.current) {
      const control = transformPoint(state.ctm, values[0] as number, values[1] as number);
      const end = transformPoint(state.ctm, values[2] as number, values[3] as number);
      appendTransformedCurve(
        state,
        operator === "v" ? state.current : control,
        operator === "v" ? control : end,
        end,
      );
    }
    return true;
  }
  if (operator === "h") {
    state.path.push("Z");
    state.current = state.start;
    state.hasGeneralPath = true;
    return true;
  }
  if (operator === "re") {
    const rectangle = numericTail(args, 4);
    if (rectangle) appendRectangle(state, rectangle as [number, number, number, number]);
    return true;
  }
  return false;
}

function appendCurve(
  state: GraphicsState,
  values: [number, number, number, number, number, number],
): void {
  appendTransformedCurve(
    state,
    transformPoint(state.ctm, values[0], values[1]),
    transformPoint(state.ctm, values[2], values[3]),
    transformPoint(state.ctm, values[4], values[5]),
  );
}

function appendTransformedCurve(
  state: GraphicsState,
  first: [number, number],
  second: [number, number],
  end: [number, number],
): void {
  state.path.push(`C${coordinates(first)} ${coordinates(second)} ${coordinates(end)}`);
  state.current = end;
  state.hasGeneralPath = true;
}

function appendRectangle(
  state: GraphicsState,
  [x, y, width, height]: [number, number, number, number],
): void {
  const points = [
    transformPoint(state.ctm, x, y),
    transformPoint(state.ctm, x + width, y),
    transformPoint(state.ctm, x + width, y + height),
    transformPoint(state.ctm, x, y + height),
  ];
  state.rectangles.push(points);
  state.path.push(
    `M${coordinates(points[0] as [number, number])}L${coordinates(points[1] as [number, number])}L${coordinates(points[2] as [number, number])}L${coordinates(points[3] as [number, number])}Z`,
  );
}

function paintPath(
  operator: string,
  state: GraphicsState,
  fills: VectorFill[],
  paths: VectorPath[],
): void {
  const fillsPath = /^(?:f|F|f\*|B|B\*|b|b\*)$/.test(operator);
  const strokesPath = /^(?:S|s|B|B\*|b|b\*)$/.test(operator);
  if (fillsPath && !state.hasGeneralPath) {
    for (const points of state.rectangles) fills.push({ points, color: state.fillColor });
  }
  if (state.path.length > 0 && (state.hasGeneralPath || strokesPath)) {
    paths.push({
      d: state.path.join(""),
      ...(fillsPath ? { fill: state.fillColor } : {}),
      ...(strokesPath ? { stroke: state.strokeColor, strokeWidth: state.lineWidth } : {}),
      ...(operator.includes("*") ? { fillRule: "evenodd" as const } : {}),
    });
  }
  resetPath(state);
}

function resetPath(state: GraphicsState): void {
  state.rectangles = [];
  state.path = [];
  state.current = undefined;
  state.start = undefined;
  state.hasGeneralPath = false;
}

async function interpretForm(
  reader: PdfObjectReader,
  args: PdfValue[],
  state: GraphicsState,
  resources: PdfDict | undefined,
  fills: VectorFill[],
  paths: VectorPath[],
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  if (depth >= reader.limits.maxFormDepth) return;
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
  const nested = createState();
  nested.ctm = multiply(state.ctm, pdfMatrix(form.dict.get("Matrix")) ?? identity);
  nested.fillColor = state.fillColor;
  nested.strokeColor = state.strokeColor;
  nested.lineWidth = state.lineWidth;
  await interpret(
    reader,
    await reader.decodeStream(form),
    nested,
    formResources,
    fills,
    paths,
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

function coordinates([x, y]: [number, number]): string {
  return `${number(x)} ${number(y)}`;
}

function number(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
