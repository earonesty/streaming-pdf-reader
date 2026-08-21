import type { ParsedPage, PdfObjectReader } from "../syntax/document.js";
import { ValueParser } from "../syntax/parser.js";
import {
  isDict,
  isName,
  isRef,
  isStream,
  type PdfDict,
  type PdfString,
  type PdfValue,
} from "../syntax/values.js";
import type { TextSpan } from "../types.js";
import { type FontDecoder, loadFontEncoding } from "./encoding.js";

export interface UnicodeMap {
  mapping: Map<number, string>;
  codeBytes?: number | undefined;
}

interface TextState {
  font?: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
  textMatrix: Matrix;
  lineMatrix: Matrix;
  ctm: Matrix;
  ctmStack: Matrix[];
}

type Matrix = [number, number, number, number, number, number];

const identity: Matrix = [1, 0, 0, 1, 0, 0];

export async function extractPageText(
  reader: PdfObjectReader,
  page: ParsedPage,
): Promise<TextSpan[]> {
  const fonts = await loadFonts(reader, page.resources);
  const streams = await contentStreams(reader, page.dict.get("Contents"));
  const spans: TextSpan[] = [];
  const state: TextState = {
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    textMatrix: [...identity],
    lineMatrix: [...identity],
    ctm: [...identity],
    ctmStack: [],
  };

  for (const bytes of streams) {
    await interpret(reader, bytes, state, fonts, page.resources, spans, page, 0, new Set());
  }
  return reorderBidiLines(spans);
}

export function reorderBidiLines(spans: TextSpan[]): TextSpan[] {
  const output: TextSpan[] = [];
  for (let start = 0; start < spans.length; ) {
    let end = start + 1;
    const y = (spans[start] as TextSpan).bounds.y;
    while (end < spans.length && Math.abs((spans[end] as TextSpan).bounds.y - y) <= 0.25) end += 1;
    const line = spans.slice(start, end);
    const text = line.map((span) => span.text).join("");
    const rtlCount = [...text].filter(isRtlCharacter).length;
    const strongCount = [...text].filter(
      (character) => isRtlCharacter(character) || /[A-Za-z]/.test(character),
    ).length;
    if (rtlCount > 0 && rtlCount * 2 >= strongCount) {
      const left = Math.min(...line.map((span) => span.bounds.x));
      const reordered = line.reverse().map((span) => ({
        ...span,
        text: [...span.text].some(isRtlCharacter) ? [...span.text].reverse().join("") : span.text,
        bounds: { ...span.bounds },
        direction: "rtl" as const,
      }));
      (reordered[0] as TextSpan).bounds.x = left;
      output.push(...reordered);
    } else {
      output.push(...line);
    }
    start = end;
  }
  return output;
}

function isRtlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 0x0590 && code <= 0x08ff) ||
    (code >= 0xfb1d && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  );
}

async function interpret(
  reader: PdfObjectReader,
  bytes: Uint8Array,
  state: TextState,
  fonts: Map<string, FontDecoder>,
  resources: PdfDict | undefined,
  spans: TextSpan[],
  page: ParsedPage,
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  const parser = new ValueParser(bytes);
  const operands: PdfValue[] = [];
  while (parser.offset < bytes.length) {
    parser.skipSpace();
    if (parser.offset >= bytes.length) break;
    const value = parser.parseValue();
    if (typeof value !== "string") {
      operands.push(value);
      continue;
    }
    await applyOperator(
      value,
      operands,
      reader,
      state,
      fonts,
      resources,
      spans,
      page,
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
  state: TextState,
  fonts: Map<string, FontDecoder>,
  resources: PdfDict | undefined,
  spans: TextSpan[],
  page: ParsedPage,
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  switch (operator) {
    case "q":
      state.ctmStack.push([...state.ctm]);
      return;
    case "Q":
      state.ctm = state.ctmStack.pop() ?? [...identity];
      return;
    case "cm":
      if (args.length >= 6 && args.slice(-6).every((value) => typeof value === "number")) {
        state.ctm = multiply(state.ctm, args.slice(-6) as Matrix);
      }
      return;
    case "BT":
      state.textMatrix = [...identity];
      state.lineMatrix = [...identity];
      return;
    case "Tf": {
      const name = args.at(-2);
      const size = args.at(-1);
      if (isName(name) && typeof size === "number") {
        state.font = name.value;
        state.fontSize = size;
      }
      return;
    }
    case "Tc":
      if (typeof args.at(-1) === "number") state.charSpacing = args.at(-1) as number;
      return;
    case "Tw":
      if (typeof args.at(-1) === "number") state.wordSpacing = args.at(-1) as number;
      return;
    case "Tz":
      if (typeof args.at(-1) === "number") state.horizontalScale = (args.at(-1) as number) / 100;
      return;
    case "TL":
      if (typeof args.at(-1) === "number") state.leading = args.at(-1) as number;
      return;
    case "Ts":
      if (typeof args.at(-1) === "number") state.rise = args.at(-1) as number;
      return;
    case "Tm":
      if (args.length >= 6 && args.slice(-6).every((value) => typeof value === "number")) {
        state.textMatrix = args.slice(-6) as Matrix;
        state.lineMatrix = [...state.textMatrix];
      }
      return;
    case "Td":
    case "TD": {
      const tx = args.at(-2);
      const ty = args.at(-1);
      if (typeof tx === "number" && typeof ty === "number") {
        if (operator === "TD") state.leading = -ty;
        state.lineMatrix = translate(state.lineMatrix, tx, ty);
        state.textMatrix = [...state.lineMatrix];
      }
      return;
    }
    case "T*":
      state.lineMatrix = translate(state.lineMatrix, 0, -state.leading);
      state.textMatrix = [...state.lineMatrix];
      return;
    case "Tj": {
      const text = args.at(-1);
      if (isPdfString(text)) showString(text, state, fonts, spans, page);
      return;
    }
    case "TJ": {
      const array = args.at(-1);
      if (Array.isArray(array)) {
        for (const item of array) {
          if (isPdfString(item)) showString(item, state, fonts, spans, page);
          else if (typeof item === "number")
            state.textMatrix[4] += (-item / 1000) * state.fontSize * state.horizontalScale;
        }
      }
      return;
    }
    case "'": {
      state.lineMatrix = translate(state.lineMatrix, 0, -state.leading);
      state.textMatrix = [...state.lineMatrix];
      const text = args.at(-1);
      if (isPdfString(text)) showString(text, state, fonts, spans, page);
      return;
    }
    case '"': {
      const word = args.at(-3);
      const char = args.at(-2);
      const text = args.at(-1);
      if (typeof word === "number") state.wordSpacing = word;
      if (typeof char === "number") state.charSpacing = char;
      state.lineMatrix = translate(state.lineMatrix, 0, -state.leading);
      state.textMatrix = [...state.lineMatrix];
      if (isPdfString(text)) showString(text, state, fonts, spans, page);
      return;
    }
    case "Do": {
      const name = args.at(-1);
      if (!isName(name)) return;
      if (depth >= reader.limits.maxFormDepth) return;
      const xObjects = await reader.resolveDict(resources?.get("XObject"));
      const xObject = xObjects?.get(name.value);
      if (!xObject) return;
      const objectNumber = isRef(xObject) ? xObject.object : undefined;
      if (objectNumber !== undefined && activeForms.has(objectNumber)) return;
      const resolved = await reader.resolve(xObject);
      if (!isStream(resolved) || !isName(resolved.dict.get("Subtype"), "Form")) return;
      const resourceValue = resolved.dict.get("Resources");
      const resolvedResources =
        resourceValue === undefined ? undefined : await reader.resolve(resourceValue);
      const formResources = isDict(resolvedResources) ? resolvedResources : resources;
      const formFonts = await loadFonts(reader, formResources);
      const matrix = pdfMatrix(resolved.dict.get("Matrix")) ?? identity;
      const saved = cloneState(state);
      state.ctm = multiply(state.ctm, matrix);
      const nestedForms = new Set(activeForms);
      if (objectNumber !== undefined) nestedForms.add(objectNumber);
      try {
        try {
          await interpret(
            reader,
            await reader.decodeStream(resolved),
            state,
            formFonts,
            formResources,
            spans,
            page,
            depth + 1,
            nestedForms,
          );
        } catch (error) {
          if (!(error instanceof Error) || !/invalid PDF number/.test(error.message)) throw error;
        }
      } finally {
        restoreState(state, saved);
      }
      return;
    }
  }
}

function cloneState(state: TextState): TextState {
  return {
    ...state,
    textMatrix: [...state.textMatrix],
    lineMatrix: [...state.lineMatrix],
    ctm: [...state.ctm],
    ctmStack: state.ctmStack.map((matrix) => [...matrix]),
  };
}

function restoreState(state: TextState, saved: TextState): void {
  Object.assign(state, saved);
}

function pdfMatrix(value: PdfValue | undefined): Matrix | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    value.some((item) => typeof item !== "number")
  ) {
    return undefined;
  }
  return value as Matrix;
}

function showString(
  value: PdfString,
  state: TextState,
  fonts: Map<string, FontDecoder>,
  spans: TextSpan[],
  page: ParsedPage,
): void {
  let text = fonts.get(state.font ?? "")?.decode(value.bytes) ?? decodePdfString(value.bytes);
  const leadingSpaces = /^ +/.exec(text)?.[0] ?? "";
  if (leadingSpaces) {
    state.textMatrix[4] += approximateAdvance(leadingSpaces, state);
    text = text.slice(leadingSpaces.length);
  }
  if (!text) return;
  const width = approximateAdvance(text, state);
  const [x, y] = transformPoint(state.ctm, state.textMatrix[4], state.textMatrix[5] + state.rise);
  spans.push({
    text,
    bounds: { x, y, width, height: Math.abs(state.fontSize) },
    direction: "ltr",
    fontName: state.font,
    fontSize: Math.abs(state.fontSize),
    source: { page: 0, objectNumber: page.ref.object },
  });
  state.textMatrix[4] += width;
}

function approximateAdvance(text: string, state: TextState): number {
  let units = 0;
  for (const character of text) {
    units += character === " " ? 0.278 : 0.5;
    units += state.charSpacing / Math.max(1, state.fontSize);
    if (character === " ") units += state.wordSpacing / Math.max(1, state.fontSize);
  }
  return units * state.fontSize * state.horizontalScale;
}

async function contentStreams(
  reader: PdfObjectReader,
  value: PdfValue | undefined,
): Promise<Uint8Array[]> {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  const output: Uint8Array[] = [];
  for (const item of values) {
    const resolved = await reader.resolve(item);
    if (!isStream(resolved)) throw new Error("page /Contents entry is not a stream");
    output.push(await reader.decodeStream(resolved));
  }
  return output;
}

async function loadFonts(
  reader: PdfObjectReader,
  resources?: PdfDict,
): Promise<Map<string, FontDecoder>> {
  const output = new Map<string, FontDecoder>();
  if (!resources) return output;
  const fonts = await reader.resolveDict(resources.get("Font"));
  if (!fonts) return output;
  for (const [name, value] of fonts) {
    const font = await reader.resolveDict(value);
    if (!font) continue;
    const encoding = await loadFontEncoding(reader, font);
    const toUnicodeValue = font.get("ToUnicode");
    if (toUnicodeValue) {
      const toUnicode = await reader.resolve(toUnicodeValue);
      if (isStream(toUnicode)) {
        const unicodeMap = parseToUnicode(await reader.decodeStream(toUnicode));
        const codeBytes = unicodeMap.codeBytes ?? (isName(font.get("Subtype"), "Type0") ? 2 : 1);
        output.set(name, {
          decode: (bytes) => decodeWithMap(bytes, unicodeMap.mapping, codeBytes, encoding),
        });
        continue;
      }
    }
    output.set(name, encoding);
  }
  return output;
}

export function parseToUnicode(bytes: Uint8Array): UnicodeMap {
  const text = new TextDecoder("latin1").decode(bytes);
  const mapping = new Map<number, string>();
  const sourceWidths: number[] = [];
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of (block[1] ?? "").matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const source = match[1];
      const destination = match[2];
      if (source !== undefined && destination !== undefined) {
        sourceWidths.push(Math.ceil(source.length / 2));
        mapping.set(Number.parseInt(source, 16), decodeUtf16Hex(destination));
      }
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of (block[1] ?? "").matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi,
    )) {
      const startHex = match[1];
      const endHex = match[2];
      const destinationHex = match[3];
      if (startHex === undefined || endHex === undefined || destinationHex === undefined) continue;
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      sourceWidths.push(Math.ceil(startHex.length / 2));
      for (let code = start; code <= end; code += 1) {
        mapping.set(code, decodeUtf16Hex(incrementHex(destinationHex, code - start)));
      }
    }
    for (const match of (block[1] ?? "").matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[((?:\s*<[0-9a-f]+>\s*)+)\]/gi,
    )) {
      const startHex = match[1];
      const endHex = match[2];
      const destinations = [...(match[3] ?? "").matchAll(/<([0-9a-f]+)>/gi)];
      if (startHex === undefined || endHex === undefined) continue;
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      sourceWidths.push(Math.ceil(startHex.length / 2));
      for (let code = start; code <= end; code += 1) {
        const destination = destinations[code - start]?.[1];
        if (destination !== undefined) mapping.set(code, decodeUtf16Hex(destination));
      }
    }
  }
  const widths = new Set(sourceWidths);
  return { mapping, codeBytes: widths.size === 1 ? sourceWidths[0] : undefined };
}

function incrementHex(hex: string, amount: number): string {
  return (BigInt(`0x${hex}`) + BigInt(amount)).toString(16).padStart(hex.length, "0");
}

function decodeWithMap(
  bytes: Uint8Array,
  mapping: Map<number, string>,
  codeBytes: number,
  fallback: FontDecoder,
): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += codeBytes) {
    let code = 0;
    for (let byte = 0; byte < codeBytes; byte += 1) code = code * 256 + (bytes[index + byte] ?? 0);
    output +=
      mapping.get(code) ??
      (codeBytes === 1
        ? fallback.decode(bytes.subarray(index, index + 1))
        : String.fromCodePoint(code));
  }
  return output;
}

function decodeUtf16Hex(hex: string): string {
  const units = hex.match(/.{4}/g)?.map((unit) => Number.parseInt(unit, 16)) ?? [];
  return String.fromCharCode(...units);
}

function decodePdfString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
    }
    return output;
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

function translate(matrix: Matrix, x: number, y: number): Matrix {
  return [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4] + x * matrix[0] + y * matrix[2],
    matrix[5] + x * matrix[1] + y * matrix[3],
  ];
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

function isPdfString(value: PdfValue | undefined): value is PdfString {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "string"
  );
}
