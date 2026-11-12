import type { SemanticBlock, TextLine } from "@boxpdf/reader/structure";

type Paragraph = Extract<SemanticBlock, { type: "paragraph" }>;

/** A conservative continuation across physical pages, not arbitrary paragraphs. */
export function continuesPageParagraph(
  previous: Paragraph,
  next: Paragraph,
  previousHeight: number,
  nextHeight: number,
): boolean {
  const last = previous.lines.at(-1);
  const first = next.lines[0];
  if (
    !last ||
    !first ||
    /[.!?:][”"')\]]?$/u.test(previous.text.trim()) ||
    !/^\p{Ll}/u.test(next.text.trim())
  )
    return false;
  const a = last.spans.at(-1),
    b = first.spans[0];
  return (
    last.bounds.y <= previousHeight * 0.25 &&
    first.bounds.y >= nextHeight * 0.7 &&
    Math.abs(last.bounds.x - first.bounds.x) <= Math.max(8, last.bounds.height) &&
    a?.fontFamily === b?.fontFamily &&
    Math.abs((a?.fontSize ?? 0) - (b?.fontSize ?? 0)) <= 0.5
  );
}

/** Match within-page dehyphenation without accumulating prior-page text. */
export function pageContinuationTail(text: string): { text: string; separator: string } {
  if (/\S[-‐‑]$/u.test(text)) {
    const terminal = /([^\s]+)[-‐‑]$/u.exec(text)?.[1] ?? "";
    return { text: /[-‐‑\d]/u.test(terminal) ? text : text.slice(0, -1), separator: "" };
  }
  return { text, separator: " " };
}

export function trimPageHyphen(lines: TextLine[]): TextLine[] {
  return lines.map((line, index) =>
    index !== lines.length - 1
      ? line
      : {
          ...line,
          text: line.text.replace(/[-‐‑]$/u, ""),
          spans: line.spans.map((span, index) =>
            index !== line.spans.length - 1
              ? span
              : { ...span, text: span.text.replace(/[-‐‑]$/u, "") },
          ),
        },
  );
}
