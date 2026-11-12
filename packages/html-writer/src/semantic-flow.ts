import type { SemanticBlock } from "@boxpdf/reader/structure";

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
