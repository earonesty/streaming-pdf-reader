import type { TextSpan } from "../types.js";

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
