import type { TextLine } from "./index.js";
import type { SemanticBlock } from "./semantic.js";

export function groupInsetBlocks(blocks: SemanticBlock[], lines: TextLine[]): SemanticBlock[] {
  const edges = alignedEdges(lines);
  const candidates = blocks.map((block) => insetCandidate(block, edges, lines));
  const output: SemanticBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const first = candidates[index];
    const block = blocks[index];
    if (!first || !block) {
      if (block) output.push(block);
      continue;
    }
    const grouped = [block];
    let cursor = index + 1;
    while (cursor < blocks.length) {
      const next = candidates[cursor];
      const nextBlock = blocks[cursor];
      if (
        !next ||
        !nextBlock ||
        Math.abs(next.edge - first.edge) > 3 ||
        Math.abs(next.indentEm - first.indentEm) > 0.75
      )
        break;
      grouped.push(nextBlock);
      cursor += 1;
    }
    const groupedLines = grouped.flatMap(semanticBlockLines);
    const onlyPreformatted = grouped.every((item) => item.type === "preformatted");
    const bracketed = hasOuterBrackets(groupedLines, lines, first.edge);
    const typographyBoundary = hasTypographyBoundary(groupedLines, lines);
    const strongGeometry = first.indentEm >= 1.5 && groupedLines.length >= 4;
    if (
      groupedLines.length >= 3 &&
      bracketed &&
      (typographyBoundary || strongGeometry) &&
      !onlyPreformatted
    ) {
      output.push({
        type: "insetGroup",
        indentEm: Math.round(first.indentEm * 4) / 4,
        blocks: grouped,
        lines: groupedLines,
      });
      index = cursor - 1;
    } else output.push(block);
  }
  return output;
}

function alignedEdges(lines: TextLine[]): Array<{ x: number; count: number }> {
  const edges: Array<{ x: number; count: number }> = [];
  for (const line of lines) {
    const match = edges.find((edge) => Math.abs(edge.x - line.bounds.x) <= 3);
    if (match) match.count += 1;
    else edges.push({ x: line.bounds.x, count: 1 });
  }
  return edges.filter((edge) => edge.count >= 5).sort((left, right) => left.x - right.x);
}

function insetCandidate(
  block: SemanticBlock,
  edges: Array<{ x: number; count: number }>,
  allLines: TextLine[],
): { edge: number; indentEm: number } | undefined {
  if (block.type === "insetGroup") return undefined;
  const lines = semanticBlockLines(block);
  if (lines.length === 0) return undefined;
  const left = Math.min(...lines.map((line) => line.bounds.x));
  const scale = medianLineHeight(lines);
  const edge = edges
    .filter((item) => left - item.x >= scale * 0.7)
    .reverse()
    .find((item) => hasOuterBrackets(lines, allLines, item.x));
  if (!edge) return undefined;
  const indentEm = (left - edge.x) / scale;
  return indentEm >= 1 && indentEm <= 8 ? { edge: edge.x, indentEm } : undefined;
}

function hasOuterBrackets(grouped: TextLine[], all: TextLine[], edge: number): boolean {
  const indexes = grouped.map((line) => all.indexOf(line)).filter((index) => index >= 0);
  if (indexes.length === 0) return false;
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  const atEdge = (line: TextLine) => Math.abs(line.bounds.x - edge) <= 3;
  return (
    all.slice(Math.max(0, first - 8), first).some(atEdge) &&
    all.slice(last + 1, last + 9).some(atEdge)
  );
}

function hasTypographyBoundary(grouped: TextLine[], all: TextLine[]): boolean {
  const indexes = grouped.map((line) => all.indexOf(line)).filter((index) => index >= 0);
  if (indexes.length === 0) return false;
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  const before = all[first - 1];
  const after = all[last + 1];
  if (!before || !after) return false;
  const groupedSignature = typographySignature(grouped);
  return (
    groupedSignature !== typographySignature([before]) &&
    groupedSignature !== typographySignature([after])
  );
}

function typographySignature(lines: TextLine[]): string {
  const counts = new Map<string, number>();
  for (const span of lines.flatMap((line) => line.spans)) {
    const family = (span.fontFamily ?? span.fontName ?? "").toLocaleLowerCase("en");
    const size = Math.round(span.fontSize * 2) / 2;
    const signature = `${family}|${size}|${span.color ?? ""}`;
    counts.set(signature, (counts.get(signature) ?? 0) + Math.max(1, [...span.text].length));
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function semanticBlockLines(block: SemanticBlock): TextLine[] {
  return block.type === "list" ? block.items.flatMap((item) => item.lines) : block.lines;
}

function medianLineHeight(lines: TextLine[]): number {
  const values = lines.map((line) => line.bounds.height).sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)] ?? 1;
}
