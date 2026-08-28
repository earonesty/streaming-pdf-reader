import type { Table, TextLine } from "./index.js";

export type SemanticBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string; lines: TextLine[] }
  | { type: "paragraph"; text: string; lines: TextLine[] }
  | { type: "preformatted"; text: string; lines: TextLine[] }
  | { type: "list"; ordered: boolean; items: Array<{ text: string; lines: TextLine[] }> }
  | {
      type: "definitionList";
      entries: Array<{ term: string; description: string }>;
      lines: TextLine[];
    }
  | {
      type: "cardList";
      items: Array<{ title: string; details: string[] }>;
      lines: TextLine[];
    }
  | {
      type: "sectionGroup";
      items: Array<{ label: string; content: string[] }>;
      lines: TextLine[];
    }
  | {
      type: "employment";
      role: string;
      organization: string;
      date: string;
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
  const bodySize = dominantFontSize(fontSizes) ?? 12;
  const largestSize = fontSizes.at(-1) ?? bodySize;
  const blocks: SemanticBlock[] = [];
  const emittedTables = new Set<Table>();
  const documentSpans = lines.flatMap((line) => line.spans);
  const documentIsProportional =
    documentSpans.filter(isMonospaced).length < documentSpans.length * 0.5;
  const hangingEdges = inferHangingEdges(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const preformatted = documentIsProportional ? preformattedRun(lines, index) : undefined;
    if (preformatted) {
      blocks.push({
        type: "preformatted",
        text: preformattedText(preformatted.lines),
        lines: preformatted.lines,
      });
      index = preformatted.end - 1;
      continue;
    }
    const table = tableForLine.get(line);
    if (table) {
      if (!emittedTables.has(table)) {
        const tableLines = lines.filter((item) => tableForLine.get(item) === table);
        const definitions = tableDefinitions(table);
        blocks.push(
          definitions
            ? { type: "definitionList", entries: definitions, lines: tableLines }
            : { type: "table", table, lines: tableLines },
        );
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

    const cards = cardRun(lines, index, tableForLine);
    if (cards) {
      blocks.push({
        type: "cardList",
        items: cards.items,
        lines: lines.slice(index, cards.end),
      });
      index = cards.end - 1;
      continue;
    }

    const sections = sectionGroup(lines, index, tableForLine);
    if (sections) {
      blocks.push({
        type: "sectionGroup",
        items: sections.items,
        lines: lines.slice(index, sections.end),
      });
      index = sections.end - 1;
      continue;
    }

    const employment = employmentEntry(lines, index, tableForLine);
    if (employment) {
      blocks.push({
        type: "employment",
        role: employment.role,
        organization: employment.organization,
        date: employment.date,
        lines: lines.slice(index, employment.end),
      });
      index = employment.end - 1;
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
        while (cursor + 1 < lines.length && isContinuation(itemLines.at(-1), lines[cursor + 1])) {
          const continuation = lines[cursor + 1];
          if (!continuation || listMarker(continuation.text) || tableForLine.has(continuation))
            break;
          if (endsSentence(itemLines.at(-1)) && startsEmphasizedLead(continuation)) break;
          cursor += 1;
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
        (endsSentence(paragraphLines.at(-1)) && startsEmphasizedLead(next)) ||
        startsNextHangingItem(paragraphLines, next, hangingEdges) ||
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

function endsSentence(line: TextLine | undefined): boolean {
  return /[.!?][”')]?$/u.test(line?.text.trim() ?? "");
}

function startsEmphasizedLead(line: TextLine): boolean {
  const meaningful = line.spans.filter((span) => /\S/u.test(span.text));
  const first = meaningful[0];
  if (!first || !isBold(first)) return false;
  return meaningful.some((span) => !isBold(span));
}

function isBold(span: TextLine["spans"][number]): boolean {
  return /(?:bold|semibold|demi|medium|medi)/i.test(span.fontFamily ?? "");
}

function startsNextHangingItem(
  paragraph: TextLine[],
  next: TextLine,
  hangingEdges: Array<{ x: number; continuationStep: number }>,
): boolean {
  const first = paragraph[0];
  const previous = paragraph.at(-1);
  if (!first || !previous) return false;
  const scale = Math.max(first.bounds.height, previous.bounds.height, next.bounds.height);
  const hangingIndent = previous.bounds.x - first.bounds.x;
  const returnsToOuterEdge = Math.abs(next.bounds.x - first.bounds.x) <= Math.max(3, scale * 0.3);
  const knownOuterEdge = hangingEdges.find(
    (edge) => Math.abs(first.bounds.x - edge.x) <= 3 && Math.abs(next.bounds.x - edge.x) <= 3,
  );
  const baselineStep = Math.abs(previous.bounds.y - next.bounds.y);
  const separatedSingleton =
    paragraph.length === 1 &&
    knownOuterEdge !== undefined &&
    baselineStep >= knownOuterEdge.continuationStep * 1.15;
  return (
    returnsToOuterEdge &&
    (separatedSingleton || (paragraph.length >= 2 && hangingIndent >= Math.max(4, scale * 0.35)))
  );
}

function inferHangingEdges(lines: TextLine[]): Array<{ x: number; continuationStep: number }> {
  const edges: Array<{ x: number; continuationStep: number }> = [];
  for (let index = 0; index + 2 < lines.length; index += 1) {
    const outer = lines[index];
    const indented = lines[index + 1];
    if (!outer || !indented) continue;
    const scale = Math.max(outer.bounds.height, indented.bounds.height);
    if (indented.bounds.x - outer.bounds.x < Math.max(4, scale * 0.35)) continue;
    const returns = lines
      .slice(index + 2, index + 7)
      .some((line) => Math.abs(line.bounds.x - outer.bounds.x) <= Math.max(3, scale * 0.3));
    if (returns && !edges.some((edge) => Math.abs(edge.x - outer.bounds.x) <= 3)) {
      edges.push({
        x: outer.bounds.x,
        continuationStep: Math.abs(outer.bounds.y - indented.bounds.y),
      });
    }
  }
  return edges;
}

function preformattedRun(
  lines: TextLine[],
  start: number,
): { lines: TextLine[]; end: number } | undefined {
  const run: TextLine[] = [];
  let cursor = start;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || monospacedRatio(line) < 0.8) break;
    const previous = run.at(-1);
    if (previous) {
      const gap = previous.bounds.y - (line.bounds.y + line.bounds.height);
      if (gap < -3 || gap > Math.max(previous.bounds.height, line.bounds.height) * 1.5) break;
    }
    run.push(line);
    cursor += 1;
  }
  return run.length >= 2 ? { lines: run, end: cursor } : undefined;
}

function monospacedRatio(line: TextLine): number {
  return line.spans.length === 0 ? 0 : line.spans.filter(isMonospaced).length / line.spans.length;
}

function isMonospaced(span: TextLine["spans"][number]): boolean {
  return /(?:courier|mono|typewriter|cmtt)/i.test(span.fontFamily ?? "");
}

function preformattedText(lines: TextLine[]): string {
  const spans = lines.flatMap((line) => line.spans).filter(isMonospaced);
  const widths = spans
    .map((span) => span.bounds.width / Math.max(1, [...span.text].length))
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((left, right) => left - right);
  const characterWidth = widths[Math.floor(widths.length / 2)] ?? 1;
  const origin = Math.min(...spans.map((span) => span.bounds.x));
  return lines
    .map((line) => {
      let output = "";
      for (const span of [...line.spans].sort((left, right) => left.bounds.x - right.bounds.x)) {
        const column = Math.max(0, Math.round((span.bounds.x - origin) / characterWidth));
        if (output.length < column) output += " ".repeat(column - output.length);
        output += span.text;
      }
      return output.trimEnd();
    })
    .join("\n");
}

function tableDefinitions(table: Table): Array<{ term: string; description: string }> | undefined {
  const rowCount = Math.max(0, ...table.cells.map((cell) => cell.row + 1));
  const rows = Array.from({ length: rowCount }, () => ["", ""]);
  for (const cell of table.cells) {
    if (cell.column > 1) return undefined;
    const row = rows[cell.row];
    if (row) row[cell.column] = cell.text;
  }
  if (
    rows.length < 2 ||
    !table.cells.some((cell) =>
      cell.spans.some((span) => /(?:bold|semibold|demi)/i.test(span.fontFamily ?? "")),
    ) ||
    !rows.every(
      ([term, description]) =>
        Boolean(term) &&
        /\p{L}/u.test(term ?? "") &&
        /^(?:\p{Sc}\s*)?[\d.,'’\s]+(?:\s*%)?$/u.test(description ?? ""),
    )
  ) {
    return undefined;
  }
  return rows.map(([term, description]) => ({ term: term ?? "", description: description ?? "" }));
}

function dominantFontSize(sizes: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const size of sizes) {
    const bucket = Math.round(size * 2) / 2;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts].sort(
    ([leftSize, leftCount], [rightSize, rightCount]) =>
      rightCount - leftCount || leftSize - rightSize,
  )[0]?.[0];
}

function cardRun(
  lines: TextLine[],
  start: number,
  tableForLine: Map<TextLine, Table>,
): { items: Array<{ title: string; details: string[] }>; end: number } | undefined {
  const items: Array<{ title: string; details: string[] }> = [];
  let cursor = start;
  while (cursor + 2 < lines.length) {
    const title = lines[cursor];
    const subtitle = lines[cursor + 1];
    const trailing = lines[cursor + 2];
    if (!title || !subtitle || !trailing) break;
    if (tableForLine.has(title) || tableForLine.has(subtitle) || tableForLine.has(trailing)) break;
    const sharedLeft = Math.abs(title.bounds.x - subtitle.bounds.x) <= 12;
    const trailingOnTitle =
      trailing.bounds.x > title.bounds.x + 120 && Math.abs(trailing.bounds.y - title.bounds.y) <= 3;
    if (!sharedLeft || !trailingOnTitle) break;
    items.push({ title: title.text, details: [subtitle.text, trailing.text] });
    cursor += 3;
  }
  return items.length >= 2 ? { items, end: cursor } : undefined;
}

function sectionGroup(
  lines: TextLine[],
  start: number,
  tableForLine: Map<TextLine, Table>,
): { items: Array<{ label: string; content: string[] }>; end: number } | undefined {
  const items: Array<{ label: string; content: string[] }> = [];
  let cursor = start;
  while (cursor < lines.length) {
    const label = lines[cursor];
    if (!label || tableForLine.has(label) || !/^[A-Z][A-Z\s/-]{2,24}$/.test(label.text.trim()))
      break;
    const content: string[] = [];
    cursor += 1;
    while (cursor < lines.length) {
      const value = lines[cursor];
      if (!value || tableForLine.has(value) || Math.abs(value.bounds.x - label.bounds.x) > 15)
        break;
      content.push(value.text);
      cursor += 1;
    }
    if (content.length === 0) break;
    items.push({ label: label.text.trim(), content });
  }
  return items.length >= 2 ? { items, end: cursor } : undefined;
}

function employmentEntry(
  lines: TextLine[],
  start: number,
  tableForLine: Map<TextLine, Table>,
): { role: string; organization: string; date: string; end: number } | undefined {
  const title = lines[start];
  const organization = lines[start + 1];
  const date = lines[start + 2];
  if (!title || !organization || !date) return undefined;
  if (tableForLine.has(title) || tableForLine.has(organization) || tableForLine.has(date)) {
    return undefined;
  }
  const titleEmphasized = title.spans.some((span) =>
    /(?:bold|semibold|demi)/i.test(span.fontFamily ?? ""),
  );
  const looksLikeDate = /\b(?:19|20)\d{2}\b/.test(date.text);
  const organizationBelow = Math.abs(title.bounds.x - organization.bounds.x) <= 12;
  const dateBesideTitle =
    date.bounds.x > title.bounds.x + title.bounds.width &&
    Math.abs(date.bounds.y - title.bounds.y) <= Math.max(title.bounds.height, date.bounds.height);
  return titleEmphasized && looksLikeDate && organizationBelow && dateBesideTitle
    ? {
        role: title.text,
        organization: organization.text,
        date: date.text,
        end: start + 3,
      }
    : undefined;
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
  if (entries.length >= 2) {
    while (cursor < lines.length) {
      const continuation = lines[cursor];
      const previous = lines[cursor - 1];
      if (
        !continuation ||
        tableForLine.has(continuation) ||
        /^[A-Z][A-Z\s/-]*$/.test(continuation.text.trim()) ||
        !isContinuation(previous, continuation)
      ) {
        break;
      }
      const last = entries.at(-1);
      if (!last) break;
      last.description = joinText(last.description, continuation.text);
      cursor += 1;
    }
  }
  return entries.length >= 2 ? { entries, end: cursor } : undefined;
}

function inferHeadingLevel(
  line: TextLine,
  bodySize: number,
  largestSize: number,
): 1 | 2 | 3 | 4 | undefined {
  const text = line.text.trim();
  if (!text || text.length > 100) return undefined;
  const size = Math.max(...line.spans.map((span) => span.fontSize));
  const emphasized = line.spans.some((span) =>
    /(?:bold|semibold|demi|medi)/i.test(span.fontFamily ?? ""),
  );
  if (size >= largestSize * 0.94 && size >= bodySize * 1.35) return 1;
  if (
    /^\d+(?:\.\d+)*\.?(?:\s+|$)/.test(text) &&
    /[A-Za-z]/.test(text) &&
    text.split(/\s+/).length <= 6
  )
    return size >= bodySize * 1.35 ? 3 : 4;
  const ratio = size / bodySize;
  if (ratio >= 1.7) return 1;
  if (ratio >= 1.5) return 2;
  if (ratio >= 1.35) return 3;
  if (ratio >= 1.15 || (emphasized && ratio >= 1.08)) return 4;
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
  if (/\S{20,}$/u.test(previous) && /^[a-z]{1,4}[.,;:]?$/u.test(next.trim())) {
    return `${previous}${next.trim()}`;
  }
  return `${previous.trimEnd()} ${next.trimStart()}`;
}
