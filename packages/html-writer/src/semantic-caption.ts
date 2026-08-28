import type { SemanticBlock, TextLine } from "@boxpdf/reader/structure";
import type { SemanticMedia } from "./semantic-media.js";

export function isClearMediaCaption(
  media: SemanticMedia,
  block: SemanticBlock,
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
): block is Extract<SemanticBlock, { type: "paragraph" }> {
  if (block.type !== "paragraph" || block.lines.length === 0) return false;
  const bounds = unionLines(block.lines);
  const lineHeight = median(block.lines.map((line) => line.bounds.height));
  if (media.bounds.width < pageWidth * 0.2 || media.bounds.height < lineHeight * 10) return false;
  if (
    media.bounds.x < -2 ||
    media.bounds.y < -2 ||
    media.bounds.x + media.bounds.width > pageWidth + 2 ||
    media.bounds.y + media.bounds.height > pageHeight + 2
  )
    return false;
  const gap = media.bounds.y - (bounds.y + bounds.height);
  if (gap < -lineHeight * 0.15 || gap > lineHeight * 1.25) return false;
  const mediaCenter = media.bounds.x + media.bounds.width / 2;
  const captionCenter = bounds.x + bounds.width / 2;
  if (Math.abs(mediaCenter - captionCenter) > Math.max(3, media.bounds.width * 0.03)) return false;
  if (bounds.width < media.bounds.width * 0.45 || bounds.width > media.bounds.width * 1.06) {
    return false;
  }
  const first = block.lines.flatMap((line) => line.spans).find((span) => /\S/u.test(span.text));
  if (!first) return false;
  const otherLines = pageLines.filter((line) => !block.lines.includes(line));
  return fontSignature(first) !== dominantFontSignature(otherLines);
}

export function clearMediaCaptionAssociations(
  media: SemanticMedia[],
  blocks: SemanticBlock[],
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
): Map<SemanticBlock, SemanticMedia> {
  const associations = new Map<SemanticBlock, SemanticMedia>();
  for (const item of media) {
    const candidates = blocks
      .filter((block) => isClearMediaCaption(item, block, pageWidth, pageHeight, pageLines))
      .filter((block) => !associations.has(block))
      .sort((left, right) => captionGap(item, left) - captionGap(item, right));
    const caption = candidates[0];
    if (caption) associations.set(caption, item);
  }
  return associations;
}

function captionGap(media: SemanticMedia, block: SemanticBlock): number {
  if (block.type !== "paragraph") return Number.POSITIVE_INFINITY;
  const bounds = unionLines(block.lines);
  return Math.abs(media.bounds.y - bounds.y - bounds.height);
}

function unionLines(lines: TextLine[]) {
  const x = Math.min(...lines.map((line) => line.bounds.x));
  const y = Math.min(...lines.map((line) => line.bounds.y));
  const right = Math.max(...lines.map((line) => line.bounds.x + line.bounds.width));
  const top = Math.max(...lines.map((line) => line.bounds.y + line.bounds.height));
  return { x, y, width: right - x, height: top - y };
}

function dominantFontSignature(lines: TextLine[]): string {
  const counts = new Map<string, number>();
  for (const span of lines.flatMap((line) => line.spans)) {
    const signature = fontSignature(span);
    counts.set(signature, (counts.get(signature) ?? 0) + Math.max(1, [...span.text].length));
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function fontSignature(span: TextLine["spans"][number]): string {
  return `${(span.fontFamily ?? span.fontName ?? "").toLocaleLowerCase("en")}|${Math.round(span.fontSize * 2) / 2}|${span.color ?? ""}`;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 1;
}
