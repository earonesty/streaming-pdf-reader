import type { Rect } from "@boxpdf/reader";
import type { SemanticBlock, TextLine } from "@boxpdf/reader/structure";
import type { SemanticMedia } from "./semantic-media.js";

export interface MediaCaptionEvidence {
  score: number;
  side: "above" | "below";
  gapRatio: number;
  horizontalOverlap: number;
  centerAlignment: number;
  relativeWidth: number;
  fontContrast: number;
  surroundingWhitespace: number;
  interveningContent: number;
  repeatedAlignment: number;
}

interface CaptionCandidate {
  block: Extract<SemanticBlock, { type: "paragraph" }>;
  bounds: Rect;
  lineHeight: number;
  font: string;
}

interface CaptionEdge {
  media: SemanticMedia;
  candidate: CaptionCandidate;
  evidence: MediaCaptionEvidence;
}

const minimumCaptionScore = 0.72;

export function mediaCaptionEvidence(
  media: SemanticMedia,
  block: SemanticBlock,
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
): MediaCaptionEvidence | undefined {
  const candidate = captionCandidate(block);
  return candidate
    ? scoreCaption(media, candidate, pageWidth, pageHeight, pageLines, 0)
    : undefined;
}

export function isClearMediaCaption(
  media: SemanticMedia,
  block: SemanticBlock,
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
): block is Extract<SemanticBlock, { type: "paragraph" }> {
  return (
    (mediaCaptionEvidence(media, block, pageWidth, pageHeight, pageLines)?.score ?? 0) >=
    minimumCaptionScore
  );
}

export function clearMediaCaptionAssociations(
  media: SemanticMedia[],
  blocks: SemanticBlock[],
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
): Map<SemanticBlock, SemanticMedia> {
  const candidates = blocks.flatMap((block) => {
    const candidate = captionCandidate(block);
    return candidate ? [candidate] : [];
  });
  const preliminary = media.flatMap((item) =>
    candidates.flatMap((candidate) => {
      const evidence = scoreCaption(item, candidate, pageWidth, pageHeight, pageLines, 0);
      return evidence ? [{ media: item, candidate, evidence }] : [];
    }),
  );
  const patterns = repeatedPatterns(preliminary);
  const edges = preliminary
    .map((edge) => {
      const evidence = scoreCaption(
        edge.media,
        edge.candidate,
        pageWidth,
        pageHeight,
        pageLines,
        patterns.get(patternKey(edge)) ?? 0,
      );
      return evidence ? { ...edge, evidence } : undefined;
    })
    .filter((edge): edge is CaptionEdge => Boolean(edge))
    .filter((edge) => edge.evidence.score >= minimumCaptionScore);
  const bestForMedia = bestEdges(edges, (edge) => edge.media);
  const bestForCaption = bestEdges(edges, (edge) => edge.candidate.block);
  const associations = new Map<SemanticBlock, SemanticMedia>();
  for (const edge of edges) {
    if (
      bestForMedia.get(edge.media) === edge &&
      bestForCaption.get(edge.candidate.block) === edge
    ) {
      associations.set(edge.candidate.block, edge.media);
    }
  }
  return associations;
}

function scoreCaption(
  media: SemanticMedia,
  candidate: CaptionCandidate,
  pageWidth: number,
  pageHeight: number,
  pageLines: TextLine[],
  repeatedAlignment: number,
): MediaCaptionEvidence | undefined {
  if (!insidePage(media.bounds, pageWidth, pageHeight)) return undefined;
  if (media.bounds.width < pageWidth * 0.06 || media.bounds.height < candidate.lineHeight * 1.5)
    return undefined;
  const relation = verticalRelation(media.bounds, candidate.bounds);
  if (!relation) return undefined;
  const maximumGap = Math.max(candidate.lineHeight * 3, pageHeight * 0.035);
  if (relation.gap > maximumGap) return undefined;
  const overlapWidth = overlap(
    media.bounds.x,
    media.bounds.width,
    candidate.bounds.x,
    candidate.bounds.width,
  );
  const horizontalOverlap =
    overlapWidth / Math.max(1, Math.min(media.bounds.width, candidate.bounds.width));
  const centerDistance = Math.abs(center(media.bounds) - center(candidate.bounds));
  const centerAlignment = clamp01(
    1 - centerDistance / Math.max(media.bounds.width, candidate.bounds.width),
  );
  if (horizontalOverlap < 0.45 && centerAlignment < 0.82) return undefined;
  const relativeWidth =
    Math.min(media.bounds.width, candidate.bounds.width) /
    Math.max(media.bounds.width, candidate.bounds.width);
  const gapRatio = clamp01(1 - relation.gap / maximumGap);
  const interveningContent = interveningScore(media.bounds, candidate, relation.side, pageLines);
  if (interveningContent === 0) return undefined;
  if (relation.side === "above" && (gapRatio < 0.6 || interveningContent < 1)) return undefined;
  const fontContrast = captionFontContrast(candidate, pageLines);
  const surroundingWhitespace = whitespaceScore(candidate, relation.side, relation.gap, pageLines);
  const score =
    gapRatio * 0.22 +
    horizontalOverlap * 0.17 +
    centerAlignment * 0.13 +
    relativeWidth * 0.09 +
    fontContrast * 0.13 +
    surroundingWhitespace * 0.09 +
    interveningContent * 0.09 +
    repeatedAlignment * 0.08;
  return {
    score,
    side: relation.side,
    gapRatio,
    horizontalOverlap,
    centerAlignment,
    relativeWidth,
    fontContrast,
    surroundingWhitespace,
    interveningContent,
    repeatedAlignment,
  };
}

function captionCandidate(block: SemanticBlock): CaptionCandidate | undefined {
  if (block.type !== "paragraph" || block.lines.length === 0) return undefined;
  const first = block.lines.flatMap((line) => line.spans).find((span) => /\S/u.test(span.text));
  if (!first) return undefined;
  return {
    block,
    bounds: unionLines(block.lines),
    lineHeight: median(block.lines.map((line) => line.bounds.height)),
    font: fontSignature(first),
  };
}

function verticalRelation(
  media: Rect,
  caption: Rect,
): { side: "above" | "below"; gap: number } | undefined {
  const belowGap = media.y - (caption.y + caption.height);
  if (belowGap >= -caption.height * 0.15) return { side: "below", gap: Math.max(0, belowGap) };
  const aboveGap = caption.y - (media.y + media.height);
  if (aboveGap >= -caption.height * 0.15) return { side: "above", gap: Math.max(0, aboveGap) };
  return undefined;
}

function interveningScore(
  media: Rect,
  candidate: CaptionCandidate,
  side: "above" | "below",
  pageLines: TextLine[],
): number {
  const lower =
    side === "below" ? candidate.bounds.y + candidate.bounds.height : media.y + media.height;
  const upper = side === "below" ? media.y : candidate.bounds.y;
  const blockers = pageLines.filter(
    (line) =>
      !candidate.block.lines.includes(line) &&
      line.bounds.y < upper &&
      line.bounds.y + line.bounds.height > lower &&
      overlap(line.bounds.x, line.bounds.width, media.x, media.width) /
        Math.max(1, Math.min(line.bounds.width, media.width)) >=
        0.25,
  );
  return blockers.length === 0 ? 1 : blockers.length === 1 ? 0.35 : 0;
}

function captionFontContrast(candidate: CaptionCandidate, pageLines: TextLine[]): number {
  const otherLines = pageLines.filter((line) => !candidate.block.lines.includes(line));
  if (candidate.font !== dominantFontSignature(otherLines)) return 1;
  const candidateSize = median(
    candidate.block.lines.flatMap((line) => line.spans.map((span) => span.fontSize)),
  );
  const bodySize = median(otherLines.flatMap((line) => line.spans.map((span) => span.fontSize)));
  return Math.abs(candidateSize - bodySize) >= 0.75 ? 0.65 : 0.15;
}

function whitespaceScore(
  candidate: CaptionCandidate,
  side: "above" | "below",
  mediaGap: number,
  pageLines: TextLine[],
): number {
  const awayGaps = pageLines
    .filter((line) => !candidate.block.lines.includes(line))
    .filter(
      (line) =>
        overlap(line.bounds.x, line.bounds.width, candidate.bounds.x, candidate.bounds.width) > 0,
    )
    .flatMap((line) => {
      if (side === "below" && line.bounds.y + line.bounds.height <= candidate.bounds.y)
        return [candidate.bounds.y - line.bounds.y - line.bounds.height];
      if (side === "above" && line.bounds.y >= candidate.bounds.y + candidate.bounds.height)
        return [line.bounds.y - candidate.bounds.y - candidate.bounds.height];
      return [];
    });
  const awayGap = Math.min(...awayGaps, Number.POSITIVE_INFINITY);
  return Number.isFinite(awayGap)
    ? clamp01((awayGap + candidate.lineHeight * 0.25) / (mediaGap + candidate.lineHeight))
    : 1;
}

function repeatedPatterns(edges: CaptionEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges.filter((item) => item.evidence.score >= minimumCaptionScore - 0.08)) {
    counts.set(patternKey(edge), (counts.get(patternKey(edge)) ?? 0) + 1);
  }
  return new Map([...counts].map(([key, count]) => [key, count >= 2 ? 1 : 0]));
}

function patternKey(edge: CaptionEdge): string {
  const widthRatio = edge.candidate.bounds.width / Math.max(1, edge.media.bounds.width);
  return `${edge.candidate.font}|${edge.evidence.side}|${Math.round(widthRatio * 4) / 4}`;
}

function bestEdges<K>(edges: CaptionEdge[], key: (edge: CaptionEdge) => K): Map<K, CaptionEdge> {
  const output = new Map<K, CaptionEdge>();
  for (const edge of edges) {
    const existing = output.get(key(edge));
    if (!existing || edge.evidence.score > existing.evidence.score) output.set(key(edge), edge);
  }
  return output;
}

function insidePage(bounds: Rect, pageWidth: number, pageHeight: number): boolean {
  return (
    bounds.x >= -2 &&
    bounds.y >= -2 &&
    bounds.x + bounds.width <= pageWidth + 2 &&
    bounds.y + bounds.height <= pageHeight + 2
  );
}

function unionLines(lines: TextLine[]): Rect {
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

function center(bounds: Rect): number {
  return bounds.x + bounds.width / 2;
}
function overlap(left: number, leftSize: number, right: number, rightSize: number): number {
  return Math.max(0, Math.min(left + leftSize, right + rightSize) - Math.max(left, right));
}
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 1;
}
