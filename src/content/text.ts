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
import type { EmbeddedFont, TextSpan } from "../types.js";
import { reorderBidiLines } from "./bidi.js";
import {
  decodeUtf16Bytes,
  decodeWithMap,
  normalizeTextCompatibility,
  parseToUnicode,
} from "./cmap.js";
import { textFillColor } from "./color.js";
import { extractTrueTypeFont } from "./font-assets.js";
import { decodePdfString, isPdfString } from "./pdf-string.js";
import { contentStreams } from "./streams.js";
import {
  effectiveLineWidth,
  identityMatrix as identity,
  type Matrix,
  multiply,
  pdfMatrix,
  transformPoint,
  translate,
} from "./text-matrix.js";

export { reorderBidiLines, reorderMixedRtlCitation } from "./bidi.js";

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
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  renderingMode: number;
  graphicsStack: Array<{
    ctm: Matrix;
    fillColor: string;
    strokeColor: string;
    lineWidth: number;
  }>;
}

export async function extractPageText(
  reader: PdfObjectReader,
  page: ParsedPage,
  fontAssets: EmbeddedFont[] = [],
): Promise<TextSpan[]> {
  const fonts = await loadFonts(reader, page.resources, fontAssets);
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
    fillColor: "#000000",
    strokeColor: "#000000",
    lineWidth: 1,
    renderingMode: 0,
    graphicsStack: [],
  };

  for (const bytes of streams) {
    await interpret(
      reader,
      bytes,
      state,
      fonts,
      fontAssets,
      page.resources,
      spans,
      page,
      0,
      new Set(),
    );
  }
  return reorderBidiLines(spans);
}

async function interpret(
  reader: PdfObjectReader,
  bytes: Uint8Array,
  state: TextState,
  fonts: Map<string, FontDecoder>,
  fontAssets: EmbeddedFont[],
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
      fontAssets,
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
  fontAssets: EmbeddedFont[],
  resources: PdfDict | undefined,
  spans: TextSpan[],
  page: ParsedPage,
  depth: number,
  activeForms: Set<number>,
): Promise<void> {
  switch (operator) {
    case "q":
      state.graphicsStack.push({
        ctm: [...state.ctm],
        fillColor: state.fillColor,
        strokeColor: state.strokeColor,
        lineWidth: state.lineWidth,
      });
      return;
    case "Q":
      {
        const restored = state.graphicsStack.pop();
        state.ctm = restored?.ctm ?? [...identity];
        state.fillColor = restored?.fillColor ?? "#000000";
        state.strokeColor = restored?.strokeColor ?? "#000000";
        state.lineWidth = restored?.lineWidth ?? 1;
      }
      return;
    case "cm":
      if (args.length >= 6 && args.slice(-6).every((value) => typeof value === "number")) {
        state.ctm = multiply(state.ctm, args.slice(-6) as Matrix);
      }
      return;
    case "g":
    case "rg":
    case "k": {
      state.fillColor = textFillColor(operator, args) ?? state.fillColor;
      return;
    }
    case "G":
    case "RG":
    case "K": {
      state.strokeColor = textFillColor(operator, args) ?? state.strokeColor;
      return;
    }
    case "w":
      if (typeof args.at(-1) === "number" && (args.at(-1) as number) >= 0) {
        state.lineWidth = args.at(-1) as number;
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
    case "Tr":
      if (typeof args.at(-1) === "number") {
        const mode = Math.trunc(args.at(-1) as number);
        if (mode >= 0 && mode <= 7) state.renderingMode = mode;
      }
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
            const vertical = fonts.get(state.font ?? "")?.writingMode === "vertical";
            state.textMatrix = translate(
              state.textMatrix,
              vertical ? 0 : (-item / 1000) * state.fontSize * state.horizontalScale,
              vertical ? (-item / 1000) * state.fontSize : 0,
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
      const formFonts = await loadFonts(reader, formResources, fontAssets);
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
            fontAssets,
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
    graphicsStack: state.graphicsStack.map((entry) => ({
      ctm: [...entry.ctm],
      fillColor: entry.fillColor,
      strokeColor: entry.strokeColor,
      lineWidth: entry.lineWidth,
    })),
  };
}

function restoreState(state: TextState, saved: TextState): void {
  Object.assign(state, saved);
}

function showString(
  value: PdfString,
  state: TextState,
  fonts: Map<string, FontDecoder>,
  spans: TextSpan[],
  page: ParsedPage,
): void {
  const font = fonts.get(state.font ?? "");
  const vertical = font?.writingMode === "vertical";
  let text = normalizeTextCompatibility(font?.decode(value.bytes) ?? decodePdfString(value.bytes));
  let bytes = value.bytes;
  const leadingSpaces = /^ +/.exec(text)?.[0] ?? "";
  const hasLeadingSpace = leadingSpaces.length > 0;
  if (leadingSpaces) {
    if (bytes.length === text.length) {
      const leadingBytes = bytes.subarray(0, leadingSpaces.length);
      const advance = textAdvance(leadingBytes, leadingSpaces, state, font);
      state.textMatrix = translate(
        state.textMatrix,
        vertical ? 0 : advance,
        vertical ? -advance : 0,
      );
      bytes = bytes.subarray(leadingSpaces.length);
    } else {
      const advance = approximateAdvance(leadingSpaces, state, vertical);
      state.textMatrix = translate(
        state.textMatrix,
        vertical ? 0 : advance,
        vertical ? -advance : 0,
      );
    }
    text = text.slice(leadingSpaces.length);
  }
  if (!text) return;
  const width = textAdvance(bytes, text, state, font);
  const visible = visibleText(bytes, text, state, font, page);
  if (!visible) {
    state.textMatrix = translate(state.textMatrix, vertical ? 0 : width, vertical ? -width : 0);
    return;
  }
  const visibleMatrix = translate(
    state.textMatrix,
    vertical ? 0 : visible.offset,
    vertical ? -visible.offset : 0,
  );
  const [x, y] = transformPoint(state.ctm, visibleMatrix[4], visibleMatrix[5] + state.rise);
  const endMatrix = translate(
    visibleMatrix,
    vertical ? 0 : visible.width,
    vertical ? -visible.width : 0,
  );
  const [endX, endY] = transformPoint(state.ctm, endMatrix[4], endMatrix[5] + state.rise);
  const topMatrix = translate(
    visibleMatrix,
    vertical ? Math.abs(state.fontSize) * state.horizontalScale : 0,
    vertical ? 0 : Math.abs(state.fontSize),
  );
  const [topX, topY] = transformPoint(state.ctm, topMatrix[4], topMatrix[5] + state.rise);
  const advanceLength = Math.hypot(endX - x, endY - y);
  const ascentLength = Math.hypot(topX - x, topY - y);
  spans.push({
    text: visible.text,
    ...(hasLeadingSpace ? { hasLeadingSpace: true } : {}),
    bounds: {
      x,
      y,
      width: vertical ? ascentLength : advanceLength,
      height: vertical ? advanceLength : ascentLength,
    },
    direction: vertical ? "ttb" : "ltr",
    fontName: state.font,
    ...(font?.fontFamily ? { fontFamily: font.fontFamily } : {}),
    ...(font?.fontAssetId ? { fontAssetId: font.fontAssetId } : {}),
    color: state.fillColor,
    ...(state.renderingMode === 1 ||
    state.renderingMode === 2 ||
    state.renderingMode === 5 ||
    state.renderingMode === 6
      ? {
          strokeColor: state.strokeColor,
          strokeWidth: effectiveLineWidth(state.ctm, state.lineWidth),
        }
      : {}),
    ...(state.renderingMode !== 0 ? { renderingMode: state.renderingMode } : {}),
    fontSize: ascentLength,
    ...(!vertical && advanceLength > 0 && ascentLength > 0
      ? {
          transform: [
            (endX - x) / advanceLength,
            -(endY - y) / advanceLength,
            -(topX - x) / ascentLength,
            (topY - y) / ascentLength,
          ] as [number, number, number, number],
        }
      : {}),
    source: { page: 0, objectNumber: page.ref.object },
  });
  state.textMatrix = translate(state.textMatrix, vertical ? 0 : width, vertical ? -width : 0);
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
    const vertical = font.writingMode === "vertical";
    const matrix = translate(state.textMatrix, vertical ? 0 : offset, vertical ? -offset : 0);
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
  const vertical = font?.writingMode === "vertical";
  const metric = vertical ? font.verticalAdvance : font?.advance;
  if (!metric) return approximateAdvance(text, state, vertical);
  const spacing =
    text.length * state.charSpacing +
    [...text].filter((character) => character === " ").length * state.wordSpacing;
  const advance = metric(bytes) * state.fontSize + spacing;
  return vertical ? advance : advance * state.horizontalScale;
}

function approximateAdvance(text: string, state: TextState, vertical = false): number {
  let units = 0;
  for (const character of text) {
    units += character === " " ? 0.278 : 0.5;
    units += state.charSpacing / Math.max(1, state.fontSize);
    if (character === " ") units += state.wordSpacing / Math.max(1, state.fontSize);
  }
  return units * state.fontSize * (vertical ? 1 : state.horizontalScale);
}

async function loadFonts(
  reader: PdfObjectReader,
  resources?: PdfDict,
  fontAssets: EmbeddedFont[] = [],
): Promise<Map<string, FontDecoder>> {
  const output = new Map<string, FontDecoder>();
  if (!resources) return output;
  const fonts = await reader.resolveDict(resources.get("Font"));
  if (!fonts) return output;
  for (const [name, value] of fonts) {
    const font = await reader.resolveDict(value);
    if (!font) continue;
    const toUnicodeValue = font.get("ToUnicode");
    const encoding = await loadFontEncoding(reader, font, toUnicodeValue === undefined);
    const fontAssetId = `font-${fontAssets.length + 1}`;
    const asset = await extractTrueTypeFont(reader, font, fontAssetId, encoding.fontFamily);
    if (asset) {
      fontAssets.push(asset);
      encoding.fontAssetId = fontAssetId;
    }
    if (toUnicodeValue) {
      const toUnicode = await reader.resolve(toUnicodeValue);
      if (isStream(toUnicode)) {
        const unicodeMap = parseToUnicode(await reader.decodeStream(toUnicode));
        const codeBytes = unicodeMap.codeBytes ?? (isName(font.get("Subtype"), "Type0") ? 2 : 1);
        output.set(name, {
          decode: (bytes) => decodeWithMap(bytes, unicodeMap, codeBytes, encoding),
          ...(encoding.fontFamily ? { fontFamily: encoding.fontFamily } : {}),
          ...(encoding.fontAssetId ? { fontAssetId: encoding.fontAssetId } : {}),
          ...(encoding.advance ? { advance: encoding.advance } : {}),
          ...(encoding.verticalAdvance ? { verticalAdvance: encoding.verticalAdvance } : {}),
          ...(encoding.verticalOrigin ? { verticalOrigin: encoding.verticalOrigin } : {}),
          ...(encoding.writingMode ? { writingMode: encoding.writingMode } : {}),
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
      output.set(name, {
        decode: decodeUtf16Bytes,
        ...(encoding.fontFamily ? { fontFamily: encoding.fontFamily } : {}),
        ...(encoding.fontAssetId ? { fontAssetId: encoding.fontAssetId } : {}),
        ...(encoding.advance ? { advance: encoding.advance } : {}),
        ...(encoding.verticalAdvance ? { verticalAdvance: encoding.verticalAdvance } : {}),
        ...(encoding.verticalOrigin ? { verticalOrigin: encoding.verticalOrigin } : {}),
        ...(encoding.writingMode ? { writingMode: encoding.writingMode } : {}),
      });
      continue;
    }
    output.set(name, encoding);
  }
  return output;
}
