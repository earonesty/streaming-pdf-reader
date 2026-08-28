import type { TextLine } from "@boxpdf/reader/structure";

interface StyledRange {
  start: number;
  end: number;
  color: string;
}

export function dominantTextColor(lines: TextLine[]): string {
  const counts = new Map<string, number>();
  for (const span of lines.flatMap((line) => line.spans)) {
    const color = normalizedColor(span.color) ?? "#000000";
    counts.set(color, (counts.get(color) ?? 0) + Math.max(1, [...span.text].length));
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "#000000";
}

export function semanticTextHtml(text: string, lines: TextLine[], defaultColor: string): string {
  const ranges: StyledRange[] = [];
  let cursor = 0;
  for (const span of lines.flatMap((line) => line.spans)) {
    if (!span.text) continue;
    const start = text.indexOf(span.text, cursor);
    if (start < 0) continue;
    cursor = start + span.text.length;
    const color = normalizedColor(span.color);
    if (color && color !== defaultColor) ranges.push({ start, end: cursor, color });
  }
  const merged = mergeRanges(ranges, text);
  let html = "";
  let offset = 0;
  for (const range of merged) {
    html += escapeHtml(text.slice(offset, range.start));
    html += `<span style="color:${range.color}">${escapeHtml(text.slice(range.start, range.end))}</span>`;
    offset = range.end;
  }
  return html + escapeHtml(text.slice(offset));
}

function mergeRanges(ranges: StyledRange[], text: string): StyledRange[] {
  const merged: StyledRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.color === range.color &&
      /^\s*$/.test(text.slice(previous.end, range.start))
    ) {
      previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function normalizedColor(value: string | undefined): string | undefined {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return undefined;
  const color = value.toLowerCase();
  return color === "#000000" || color === "#000" ? "#000000" : color;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
