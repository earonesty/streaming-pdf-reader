import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { ValueParser } from "../syntax/parser.js";
import { isDict, isName, isRef, isStream, type PdfDict, type PdfValue } from "../syntax/values.js";
import type { RasterImage, VectorClip, VectorFill, VectorPath } from "../types.js";
import { textFillColor } from "./color.js";
import { componentColor } from "./color-space.js";
import { resolveExtendedGraphicsState } from "./extgstate.js";
import {
  coordinates,
  identity,
  type Matrix,
  multiply,
  numericTail,
  pdfMatrix,
  transformPoint,
} from "./graphics-matrix.js";
import { shadingColor } from "./shading.js";
import { contentStreams } from "./streams.js";
import { effectiveLineWidth, pageOriginMatrix } from "./text-matrix.js";

interface GraphicsState {
  ctm: Matrix;
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  dashArray: number[];
  dashPhase: number;
  fillColorSpace: string | undefined;
  strokeColorSpace: string | undefined;
  fillOpacity: number;
  strokeOpacity: number;
  clips: VectorClip[];
  pendingClipRule: "nonzero" | "evenodd" | undefined;
  stack: Array<{
    ctm: Matrix;
    fillColor: string;
    strokeColor: string;
    lineWidth: number;
    lineCap: number;
    lineJoin: number;
    dashArray: number[];
    dashPhase: number;
    fillColorSpace: string | undefined;
    strokeColorSpace: string | undefined;
    fillOpacity: number;
    strokeOpacity: number;
    clips: VectorClip[];
  }>;
  rectangles: Array<Array<[number, number]>>;
  path: string[];
  current: [number, number] | undefined;
  start: [number, number] | undefined;
  hasGeneralPath: boolean;
}

export async function extractPageGraphics(
  reader: PdfObjectReader,
  page: ParsedPage,
): Promise<{ fills: VectorFill[]; paths: VectorPath[]; images: RasterImage[] }> {
  const fills: VectorFill[] = [];
  const paths: VectorPath[] = [];
  const images: RasterImage[] = [];
  const state = createState();
  state.ctm = pageOriginMatrix(page.mediaBox);
  for (const bytes of await contentStreams(reader, page.dict.get("Contents"))) {
    await interpret(reader, bytes, state, page.resources, fills, paths, images, 0, new Set());
  }
  return { fills, paths, images };
}

export async function extractGraphicsStream(
  reader: PdfObjectReader,
  bytes: Uint8Array,
  resources: PdfDict | undefined,
  initialCtm: Matrix,
): Promise<{ fills: VectorFill[]; paths: VectorPath[] }> {
  const fills: VectorFill[] = [];
  const paths: VectorPath[] = [];
  const state = createState();
  state.ctm = [...initialCtm];
  await interpret(reader, bytes, state, resources, fills, paths, [], 0, new Set());
  return { fills, paths };
}

function createState(): GraphicsState {
  return {
    ctm: [...identity],
    fillColor: "#000000",
    strokeColor: "#000000",
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    dashArray: [],
    dashPhase: 0,
    fillColorSpace: undefined,
    strokeColorSpace: undefined,
    fillOpacity: 1,
    strokeOpacity: 1,
    clips: [],
    pendingClipRule: undefined,
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
  images: RasterImage[],
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
      images,
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
  images: RasterImage[],
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  if (applyGraphicsState(operator, args, state)) return;
  if (operator === "sc" || operator === "scn") {
    state.fillColor =
      (await componentColor(reader, resources, state.fillColorSpace, args)) ?? state.fillColor;
    return;
  }
  if (operator === "SC" || operator === "SCN") {
    state.strokeColor =
      (await componentColor(reader, resources, state.strokeColorSpace, args)) ?? state.strokeColor;
    return;
  }
  if (operator === "gs") {
    const extended = await resolveExtendedGraphicsState(reader, resources, args.at(-1));
    if (extended?.lineWidth !== undefined) state.lineWidth = extended.lineWidth;
    if (extended?.lineCap !== undefined) state.lineCap = extended.lineCap;
    if (extended?.lineJoin !== undefined) state.lineJoin = extended.lineJoin;
    if (extended?.dashArray !== undefined) state.dashArray = extended.dashArray;
    if (extended?.dashPhase !== undefined) state.dashPhase = extended.dashPhase;
    if (extended?.fillOpacity !== undefined) state.fillOpacity = extended.fillOpacity;
    if (extended?.strokeOpacity !== undefined) state.strokeOpacity = extended.strokeOpacity;
    return;
  }
  if (applyPathConstruction(operator, args, state)) return;
  if (operator === "W" || operator === "W*") {
    state.pendingClipRule = operator === "W*" ? "evenodd" : "nonzero";
    return;
  }
  if (["f", "F", "f*", "B", "B*", "b", "b*", "S", "s"].includes(operator)) {
    commitClip(state);
    paintPath(operator, state, fills, paths);
    return;
  }
  if (operator === "n") {
    commitClip(state);
    resetPath(state);
    return;
  }
  if (operator === "sh") {
    const color = await shadingColor(reader, resources, args.at(-1));
    const paintClip = state.clips.at(-1);
    if (color && paintClip) {
      paths.push({
        d: paintClip.d,
        fill: color,
        ...(state.fillOpacity !== 1 ? { fillOpacity: state.fillOpacity } : {}),
        ...(state.clips.length > 1 ? { clips: state.clips.slice(0, -1) } : {}),
      });
    }
    return;
  }
  if (operator === "Do") {
    await interpretXObject(
      reader,
      args,
      state,
      resources,
      fills,
      paths,
      images,
      depth,
      activeForms,
    );
  }
}

function applyGraphicsState(operator: string, args: PdfValue[], state: GraphicsState): boolean {
  if (operator === "q") {
    state.stack.push({
      ctm: [...state.ctm],
      fillColor: state.fillColor,
      strokeColor: state.strokeColor,
      lineWidth: state.lineWidth,
      lineCap: state.lineCap,
      lineJoin: state.lineJoin,
      dashArray: [...state.dashArray],
      dashPhase: state.dashPhase,
      fillColorSpace: state.fillColorSpace,
      strokeColorSpace: state.strokeColorSpace,
      fillOpacity: state.fillOpacity,
      strokeOpacity: state.strokeOpacity,
      clips: state.clips.map((clip) => ({ ...clip })),
    });
    return true;
  }
  if (operator === "Q") {
    const restored = state.stack.pop();
    state.ctm = restored?.ctm ?? [...identity];
    state.fillColor = restored?.fillColor ?? "#000000";
    state.strokeColor = restored?.strokeColor ?? "#000000";
    state.lineWidth = restored?.lineWidth ?? 1;
    state.lineCap = restored?.lineCap ?? 0;
    state.lineJoin = restored?.lineJoin ?? 0;
    state.dashArray = restored?.dashArray ?? [];
    state.dashPhase = restored?.dashPhase ?? 0;
    state.fillColorSpace = restored?.fillColorSpace;
    state.strokeColorSpace = restored?.strokeColorSpace;
    state.fillOpacity = restored?.fillOpacity ?? 1;
    state.strokeOpacity = restored?.strokeOpacity ?? 1;
    state.clips = restored?.clips ?? [];
    state.pendingClipRule = undefined;
    return true;
  }
  if (operator === "cm") {
    const matrix = numericTail(args, 6);
    if (matrix) state.ctm = multiply(state.ctm, matrix as Matrix);
    return true;
  }
  if (operator === "cs" || operator === "CS") {
    const name = args.at(-1);
    if (isName(name)) {
      if (operator === "cs") state.fillColorSpace = name.value;
      else state.strokeColorSpace = name.value;
    }
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
  if (operator === "J" || operator === "j") {
    const value = numericTail(args, 1)?.[0];
    if (value !== undefined && value >= 0 && value <= 2) {
      if (operator === "J") state.lineCap = value;
      else state.lineJoin = value;
    }
    return true;
  }
  if (operator === "d") {
    const array = args.at(-2);
    const phase = args.at(-1);
    if (
      Array.isArray(array) &&
      array.every((value) => typeof value === "number" && value >= 0) &&
      typeof phase === "number"
    ) {
      state.dashArray = array as number[];
      state.dashPhase = phase;
    }
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
    for (const points of state.rectangles) {
      fills.push({
        points,
        color: state.fillColor,
        ...(state.fillOpacity !== 1 ? { opacity: state.fillOpacity } : {}),
      });
    }
  }
  if (state.path.length > 0 && (state.hasGeneralPath || strokesPath)) {
    paths.push({
      d: state.path.join(""),
      ...(fillsPath ? { fill: state.fillColor } : {}),
      ...(fillsPath && state.fillOpacity !== 1 ? { fillOpacity: state.fillOpacity } : {}),
      ...(strokesPath
        ? {
            stroke: state.strokeColor,
            strokeWidth: effectiveLineWidth(state.ctm, state.lineWidth),
            ...(state.dashArray.length > 0 ? { strokeDasharray: state.dashArray } : {}),
            ...(state.dashPhase !== 0 ? { strokeDashoffset: state.dashPhase } : {}),
            ...(state.lineCap !== 0
              ? { strokeLinecap: (["butt", "round", "square"] as const)[state.lineCap] }
              : {}),
            ...(state.lineJoin !== 0
              ? { strokeLinejoin: (["miter", "round", "bevel"] as const)[state.lineJoin] }
              : {}),
          }
        : {}),
      ...(strokesPath && state.strokeOpacity !== 1 ? { strokeOpacity: state.strokeOpacity } : {}),
      ...(operator.includes("*") ? { fillRule: "evenodd" as const } : {}),
      ...(state.clips.length > 0 ? { clips: state.clips.map((clip) => ({ ...clip })) } : {}),
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

function commitClip(state: GraphicsState): void {
  if (state.pendingClipRule && state.path.length > 0) {
    state.clips.push({
      d: state.path.join(""),
      ...(state.pendingClipRule === "evenodd" ? { fillRule: "evenodd" as const } : {}),
    });
  }
  state.pendingClipRule = undefined;
}

async function interpretXObject(
  reader: PdfObjectReader,
  args: PdfValue[],
  state: GraphicsState,
  resources: PdfDict | undefined,
  fills: VectorFill[],
  paths: VectorPath[],
  images: RasterImage[],
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
  if (!isStream(form)) return;
  if (isName(form.dict.get("Subtype"), "Image")) {
    const image = await rasterImage(reader, form, state);
    if (image) images.push(image);
    return;
  }
  if (!isName(form.dict.get("Subtype"), "Form")) return;
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
  nested.fillColorSpace = state.fillColorSpace;
  nested.strokeColorSpace = state.strokeColorSpace;
  nested.fillOpacity = state.fillOpacity;
  nested.strokeOpacity = state.strokeOpacity;
  nested.clips = state.clips.map((clip) => ({ ...clip }));
  await interpret(
    reader,
    await reader.decodeStream(form),
    nested,
    formResources,
    fills,
    paths,
    images,
    depth + 1,
    nestedForms,
  );
}

async function rasterImage(
  reader: PdfObjectReader,
  stream: Extract<Awaited<ReturnType<PdfObjectReader["resolve"]>>, { type: "stream" }>,
  state: GraphicsState,
): Promise<RasterImage | undefined> {
  const width = stream.dict.get("Width");
  const height = stream.dict.get("Height");
  const bits = stream.dict.get("BitsPerComponent");
  const filter = stream.dict.get("Filter");
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    bits !== 8
  ) {
    return undefined;
  }
  const jpeg = await jpegBytes(reader, stream, filter);
  if (jpeg) {
    return {
      width,
      height,
      format: "jpeg",
      data: jpeg,
      transform: [...state.ctm],
      ...(state.fillOpacity !== 1 ? { opacity: state.fillOpacity } : {}),
      ...(state.clips.length > 0 ? { clips: state.clips.map((clip) => ({ ...clip })) } : {}),
    };
  }
  if (!isName(stream.dict.get("ColorSpace"), "DeviceRGB") || !supportedRasterFilters(filter)) {
    return undefined;
  }
  const data = await reader.decodeStream(stream);
  if (data.length !== width * height * 3) return undefined;
  return {
    width,
    height,
    format: "rgb",
    data,
    transform: [...state.ctm],
    ...(state.fillOpacity !== 1 ? { opacity: state.fillOpacity } : {}),
    ...(state.clips.length > 0 ? { clips: state.clips.map((clip) => ({ ...clip })) } : {}),
  };
}

async function jpegBytes(
  reader: PdfObjectReader,
  stream: Extract<Awaited<ReturnType<PdfObjectReader["resolve"]>>, { type: "stream" }>,
  filter: PdfValue | undefined,
): Promise<Uint8Array | undefined> {
  const filters = Array.isArray(filter) ? filter : filter === undefined ? [] : [filter];
  const terminal = filters.at(-1);
  if (!isName(terminal) || !["DCTDecode", "DCT"].includes(terminal.value)) return undefined;
  const prefix = filters.slice(0, -1);
  if (!supportedRasterFilters(prefix)) return undefined;
  if (prefix.length === 0) return stream.bytes;
  const dict = new Map(stream.dict);
  dict.set("Filter", prefix);
  const parameters = stream.dict.get("DecodeParms") ?? stream.dict.get("DP");
  if (Array.isArray(parameters)) dict.set("DecodeParms", parameters.slice(0, -1));
  return reader.decodeStream({ ...stream, dict });
}

function supportedRasterFilters(value: PdfValue | undefined): boolean {
  if (value === undefined) return true;
  const filters = Array.isArray(value) ? value : [value];
  return filters.every(
    (filter) =>
      isName(filter) &&
      ["FlateDecode", "Fl", "LZWDecode", "LZW", "ASCIIHexDecode", "AHx"].includes(filter.value),
  );
}
