import { identityMatrix, type Matrix } from "./text-matrix.js";

export interface TextState {
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
  fillColorSpace: string | undefined;
  strokeColorSpace: string | undefined;
  fillOpacity: number;
  strokeOpacity: number;
  graphicsStack: Array<{
    ctm: Matrix;
    fillColor: string;
    strokeColor: string;
    lineWidth: number;
    fillColorSpace: string | undefined;
    strokeColorSpace: string | undefined;
    fillOpacity: number;
    strokeOpacity: number;
  }>;
}

export function createTextState(): TextState {
  return {
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    textMatrix: [...identityMatrix],
    lineMatrix: [...identityMatrix],
    ctm: [...identityMatrix],
    fillColor: "#000000",
    strokeColor: "#000000",
    lineWidth: 1,
    renderingMode: 0,
    fillColorSpace: undefined,
    strokeColorSpace: undefined,
    fillOpacity: 1,
    strokeOpacity: 1,
    graphicsStack: [],
  };
}

export function cloneTextState(state: TextState): TextState {
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
      fillColorSpace: entry.fillColorSpace,
      strokeColorSpace: entry.strokeColorSpace,
      fillOpacity: entry.fillOpacity,
      strokeOpacity: entry.strokeOpacity,
    })),
  };
}

export function restoreTextState(state: TextState, saved: TextState): void {
  Object.assign(state, saved);
}
