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
        type: "paragraph",
        text: employment.text,
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
        while (cursor + 1 < lines.length && isContinuation(itemLine, lines[cursor + 1])) {
          const continuation = lines[cursor + 1];
          if (!continuation || listMarker(continuation.text) || tableForLine.has(continuation)) break;
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
    !rows.some(([term]) =>
      /^(?:subtotal|tax|shipping|total|amount due|balance)$/i.test(term ?? ""),
    ) ||
    !rows.every(
      ([term, description]) =>
        Boolean(term) &&
        /[A-Za-z]/.test(term ?? "") &&
        /^(?:[$€£]\s*)?[\d,.]+$/.test(description ?? ""),
    )
  ) {
    return undefined;
  }
  return rows.map(([term, description]) => ({ term: term ?? "", description: description ?? "" }));
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
): { text: string; end: number } | undefined {
  const title = lines[start];
  const organization = lines[start + 1];
  const date = lines[start + 2];
  if (!title || !organization || !date) return undefined;
  if (tableForLine.has(title) || tableForLine.has(organization) || tableForLine.has(date)) {
    return undefined;
  }
  const looksLikeRole = /\b(?:engineer|developer|designer|manager|director|analyst)\b/i.test(
    title.text,
  );
  const looksLikeDate =
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\b(?:\d{4}|Present)\b/.test(
      date.text,
    );
  const organizationBelow = Math.abs(title.bounds.x - organization.bounds.x) <= 12;
  return looksLikeRole && looksLikeDate && organizationBelow
    ? { text: `${title.text} ${date.text} ${organization.text}`, end: start + 3 }
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
  if (/\S{20,}$/u.test(previous) && /^[a-z]{1,4}[.,;:]?$/u.test(next.trim())) {
    return `${previous}${next.trim()}`;
  }
  return `${previous.trimEnd()} ${next.trimStart()}`;
}
