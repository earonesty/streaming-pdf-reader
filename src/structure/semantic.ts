import type { Table, TextLine } from "./index.js";

export type SemanticBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string; lines: TextLine[] }
  | { type: "paragraph"; text: string; lines: TextLine[] }
  | { type: "list"; ordered: boolean; items: Array<{ text: string; lines: TextLine[] }> }
  | {
      type: "definitionList";
      entries: Array<{ term: string; description: string }>;
      lines: TextLine[];
    }
  | { type: "table"; table: Table; lines: TextLine[] };

export function inferSemanticBlocks(lines: TextLine[], tables: Table[]): SemanticBlock[] {
  const tableForLine = new Map<TextLine, Table>();
  for (const table of tables) {
    const tableSpans = new Set(table.cells.flatMap((cell) => cell.spans));
    for (const line of lines) {
      if (line.spans.some((span) => tableSpans.has(span))) tableForLine.set(line, table);
    }
  }

  const fontSizes = lines
    .flatMap((line) => line.spans.map((span) => span.fontSize))
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((left, right) => left - right);
  const bodySize = fontSizes[Math.floor(fontSizes.length / 2)] ?? 12;
  const largestSize = fontSizes.at(-1) ?? bodySize;
  const blocks: SemanticBlock[] = [];
  const emittedTables = new Set<Table>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const table = tableForLine.get(line);
    if (table) {
      if (!emittedTables.has(table)) {
        blocks.push({
          type: "table",
          table,
          lines: lines.filter((item) => tableForLine.get(item) === table),
        });
        emittedTables.add(table);
      }
      continue;
    }

    const definitions = definitionRun(lines, index, tableForLine);
    if (definitions) {
      blocks.push({
        type: "definitionList",
        entries: definitions.entries,
        lines: lines.slice(index, definitions.end),
      });
      index = definitions.end - 1;
      continue;
    }

    const headingLevel = inferHeadingLevel(line, bodySize, largestSize);
    if (headingLevel) {
      blocks.push({ type: "heading", level: headingLevel, text: line.text, lines: [line] });
      continue;
    }

    const list = listMarker(line.text);
    if (list) {
      const items: Array<{ text: string; lines: TextLine[] }> = [];
      let cursor = index;
      while (cursor < lines.length) {
        const itemLine = lines[cursor];
        if (!itemLine || tableForLine.has(itemLine)) break;
        const marker = listMarker(itemLine.text);
        if (!marker || marker.ordered !== list.ordered) break;
        const itemLines = [itemLine];
        let text = marker.text;
        while (cursor + 1 < lines.length && isContinuation(itemLine, lines[cursor + 1])) {
          const continuation = lines[++cursor];
          if (!continuation || listMarker(continuation.text) || tableForLine.has(continuation))
            break;
          itemLines.push(continuation);
          text = joinText(text, continuation.text);
        }
        items.push({ text, lines: itemLines });
        cursor += 1;
      }
      blocks.push({ type: "list", ordered: list.ordered, items });
      index = cursor - 1;
      continue;
    }

    const paragraphLines = [line];
    let text = line.text;
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (!next || tableForLine.has(next) || listMarker(next.text)) break;
      if (
        inferHeadingLevel(next, bodySize, largestSize) ||
        !isContinuation(paragraphLines.at(-1), next)
      )
        break;
      paragraphLines.push(next);
      text = joinText(text, next.text);
      index += 1;
    }
    blocks.push({ type: "paragraph", text, lines: paragraphLines });
  }
  return blocks;
}

function definitionRun(
  lines: TextLine[],
  start: number,
  tableForLine: Map<TextLine, Table>,
): { entries: Array<{ term: string; description: string }>; end: number } | undefined {
  const entries: Array<{ term: string; description: string }> = [];
  let cursor = start;
  while (cursor + 1 < lines.length) {
    const term = lines[cursor];
    const value = lines[cursor + 1];
    if (!term || !value || tableForLine.has(term) || tableForLine.has(value)) break;
    const text = term.text.trim();
    const aligned = Math.abs(term.bounds.x - value.bounds.x) <= 20;
    if (!aligned || !/^[A-Z][A-Z\s/-]*$/.test(text) || text.length > 24) break;
    entries.push({ term: text, description: value.text });
    cursor += 2;
  }
  return entries.length >= 2 ? { entries, end: cursor } : undefined;
}

function inferHeadingLevel(
  line: TextLine,
  bodySize: number,
  largestSize: number,
): 1 | 2 | 3 | undefined {
  const text = line.text.trim();
  if (!text || text.length > 100) return undefined;
  const size = Math.max(...line.spans.map((span) => span.fontSize));
  if (size >= largestSize * 0.94 && size >= bodySize * 1.35) return 1;
  if (/^(?:abstract|summary|experience|education|plan comparison)$/i.test(text)) return 2;
  if (
    /^\d+(?:\.\d+)*\.?(?:\s+|$)/.test(text) &&
    /[A-Za-z]/.test(text) &&
    text.split(/\s+/).length <= 6
  )
    return 2;
  if (size >= bodySize * 1.18) return 2;
  return undefined;
}

function listMarker(text: string): { ordered: boolean; text: string } | undefined {
  const unordered = /^\s*[•●▪◦]\s*(.+)$/u.exec(text);
  if (unordered?.[1]) return { ordered: false, text: unordered[1] };
  const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(text);
  return ordered?.[1] ? { ordered: true, text: ordered[1] } : undefined;
}

function isContinuation(
  previous: TextLine | undefined,
  next: TextLine | undefined,
): next is TextLine {
  if (!previous || !next) return false;
  const verticalGap = previous.bounds.y - (next.bounds.y + next.bounds.height);
  const sameFlow =
    Math.abs(previous.bounds.x - next.bounds.x) <= Math.max(18, previous.bounds.height * 1.5);
  return verticalGap >= -3 && verticalGap <= Math.max(12, previous.bounds.height * 1.2) && sameFlow;
}

function joinText(previous: string, next: string): string {
  if (/[-‐‑]$/u.test(previous)) return `${previous.slice(0, -1)}${next.trimStart()}`;
  return `${previous.trimEnd()} ${next.trimStart()}`;
}
