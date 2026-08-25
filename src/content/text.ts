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
import {
  decodeUtf16Bytes,
  decodeWithMap,
  normalizeTextCompatibility,
  parseToUnicode,
} from "./cmap.js";
import { type FontDecoder, loadFontEncoding } from "./encoding.js";

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
      const preserveChunkOrder =
        /[\u0600-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text) && !/[\u0590-\u05FF]/u.test(text);
      const chunks = preserveChunkOrder ? line : line.reverse();
      const reordered = chunks.map((span) => ({
        ...span,
        text: [...span.text].some(isRtlCharacter) ? [...span.text].reverse().join("") : span.text,
        bounds: { ...span.bounds },
        direction: "rtl" as const,
      }));
      const mixedText = reorderMixedRtlCitation(reordered.map((span) => span.text).join(""));
      if (mixedText !== undefined) {
        const first = reordered[0] as TextSpan;
        output.push({ ...first, text: mixedText, bounds: { ...first.bounds, x: left } });
        start = end;
        continue;
      }
      const first = reordered[0] as TextSpan;
      const wordInset =
        /\s/u.test(text) && /[\u0590-\u05FF]/u.test(text) ? first.fontSize * 0.035 : 0;
      first.bounds.x = left + wordInset;
      output.push(...reordered);
    } else {
      output.push(...line);
    }
    start = end;
  }
  return output;
}

export function reorderMixedRtlCitation(text: string): string | undefined {
  const match =
    /^\)\s*([\u0590-\u05FF][\u0590-\u05FF\s]*?)(\d+)\(([\u0590-\u05FF]+)\(\)(\d+)([\u0590-\u05FF][\u0590-\u05FF\s]*)$/u.exec(
      text,
    );
  if (!match) return undefined;
  const [, following, visualRight, label, visualLeft, preceding] = match;
  return `${preceding ?? ""}${visualLeft ?? ""}(${label ?? ""})(${visualRight ?? ""}) ${following ?? ""}`;
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
    let value: PdfValue;
    try {
      value = parser.parseValue();
    } catch (error) {
      const trailing = bytes.subarray(parser.offset);
      if (trailing.length <= 64 && !containsTextShowingOperator(trailing)) break;
      throw error;
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

function containsTextShowingOperator(bytes: Uint8Array): boolean {
  return /(?:^|\s)(?:Tj|TJ|'|")(?:\s|$)/.test(new TextDecoder("latin1").decode(bytes));
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
          else if (typeof item === "number") {
            state.textMatrix = translate(
              state.textMatrix,
              (-item / 1000) * state.fontSize * state.horizontalScale,
              0,
            );
          }
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
  const font = fonts.get(state.font ?? "");
  let text = normalizeTextCompatibility(font?.decode(value.bytes) ?? decodePdfString(value.bytes));
  let bytes = value.bytes;
  const leadingSpaces = /^ +/.exec(text)?.[0] ?? "";
  if (leadingSpaces) {
    if (bytes.length === text.length) {
      const leadingBytes = bytes.subarray(0, leadingSpaces.length);
      state.textMatrix = translate(
        state.textMatrix,
        textAdvance(leadingBytes, leadingSpaces, state, font),
        0,
      );
      bytes = bytes.subarray(leadingSpaces.length);
    } else {
      state.textMatrix = translate(state.textMatrix, approximateAdvance(leadingSpaces, state), 0);
    }
    text = text.slice(leadingSpaces.length);
  }
  if (!text) return;
  const width = textAdvance(bytes, text, state, font);
  const visible = visibleText(bytes, text, state, font, page);
  if (!visible) {
    state.textMatrix = translate(state.textMatrix, width, 0);
    return;
  }
  const visibleMatrix = translate(state.textMatrix, visible.offset, 0);
  const [x, y] = transformPoint(state.ctm, visibleMatrix[4], visibleMatrix[5] + state.rise);
  const endMatrix = translate(visibleMatrix, visible.width, 0);
  const [endX, endY] = transformPoint(state.ctm, endMatrix[4], endMatrix[5] + state.rise);
  const topMatrix = translate(visibleMatrix, 0, Math.abs(state.fontSize));
  const [topX, topY] = transformPoint(state.ctm, topMatrix[4], topMatrix[5] + state.rise);
  spans.push({
    text: visible.text,
    bounds: {
      x,
      y,
      width: Math.hypot(endX - x, endY - y),
      height: Math.hypot(topX - x, topY - y),
    },
    direction: "ltr",
    fontName: state.font,
    fontSize: Math.hypot(topX - x, topY - y),
    source: { page: 0, objectNumber: page.ref.object },
  });
  state.textMatrix = translate(state.textMatrix, width, 0);
}

function visibleText(
  bytes: Uint8Array,
  text: string,
  state: TextState,
  font: FontDecoder | undefined,
  page: ParsedPage,
): { text: string; offset: number; width: number } | undefined {
  if (!font?.advance || bytes.length !== text.length)
    return { text, offset: 0, width: textAdvance(bytes, text, state, font) };
  const [minX, minY, maxX, maxY] = page.mediaBox;
  let offset = 0;
  let first = -1;
  let last = -1;
  let firstOffset = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const matrix = translate(state.textMatrix, offset, 0);
    const [x, y] = transformPoint(state.ctm, matrix[4], matrix[5] + state.rise);
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      if (first < 0) {
        first = index;
        firstOffset = offset;
      }
      last = index + 1;
    }
    const character = text[index] ?? "";
    offset += textAdvance(bytes.subarray(index, index + 1), character, state, font);
  }
  if (first < 0 || last < 0) return undefined;
  const visibleBytes = bytes.subarray(first, last);
  const visible = text.slice(first, last);
  return {
    text: visible,
    offset: firstOffset,
    width: textAdvance(visibleBytes, visible, state, font),
  };
}

function textAdvance(
  bytes: Uint8Array,
  text: string,
  state: TextState,
  font: FontDecoder | undefined,
): number {
  if (!font?.advance) return approximateAdvance(text, state);
  const spacing =
    text.length * state.charSpacing +
    [...text].filter((character) => character === " ").length * state.wordSpacing;
  return (font.advance(bytes) * state.fontSize + spacing) * state.horizontalScale;
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
  if (output.length <= 1) return output;
  const length = output.reduce((total, bytes) => total + bytes.length + 1, 0);
  if (length > reader.limits.maxDecodedStreamBytes) {
    throw new Error("combined page content exceeds configured decoded stream byte limit");
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const bytes of output) {
    combined.set(bytes, offset);
    offset += bytes.length;
    combined[offset] = 0x0a;
    offset += 1;
  }
  return [combined];
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
          decode: (bytes) => decodeWithMap(bytes, unicodeMap, codeBytes, encoding),
          ...(encoding.advance ? { advance: encoding.advance } : {}),
        });
        continue;
      }
    }
    const namedEncoding = font.get("Encoding");
    if (
      isName(font.get("Subtype"), "Type0") &&
      isName(namedEncoding) &&
      /-UTF16-(?:H|V)$/.test(namedEncoding.value)
    ) {
      output.set(name, { decode: decodeUtf16Bytes });
      continue;
    }
    output.set(name, encoding);
  }
  return output;
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
