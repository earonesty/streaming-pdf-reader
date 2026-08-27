import type { FontDecoder } from "./encoding.js";
import type { TextState } from "./text-state.js";

export function textAdvance(
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

export function approximateAdvance(text: string, state: TextState, vertical = false): number {
  let units = 0;
  for (const character of text) {
    units += character === " " ? 0.278 : 0.5;
    units += state.charSpacing / Math.max(1, state.fontSize);
    if (character === " ") units += state.wordSpacing / Math.max(1, state.fontSize);
  }
  return units * state.fontSize * (vertical ? 1 : state.horizontalScale);
}
