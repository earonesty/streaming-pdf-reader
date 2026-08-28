import type { TextLine } from "@boxpdf/reader/structure";

interface StyledRange {
  start: number;
  end: number;
  color?: string;
  bold: boolean;
  italic: boolean;
}

export function dominantTextColor(lines: TextLine[]): string {
  const counts = new Map<string, number>();
  for (const span of lines.flatMap((line) => line.spans)) {
    const color = normalizedColor(span.color) ?? "#000000";
    counts.set(color, (counts.get(color) ?? 0) + Math.max(1, [...span.text].length));
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "#000000";
}

export function semanticTextHtml(
  text: string,
  lines: TextLine[],
  defaultColor: string,
  preserveWeight = true,
): string {
  const ranges: StyledRange[] = [];
  let cursor = 0;
  for (const span of lines.flatMap((line) => line.spans)) {
    if (!span.text) continue;
    const start = text.indexOf(span.text, cursor);
    if (start < 0) continue;
    cursor = start + span.text.length;
    const color = normalizedColor(span.color);
    const bold =
      preserveWeight && /(?:bold|semibold|demi|medium|medi)/i.test(span.fontFamily ?? "");
    const italic = /(?:italic|oblique|slanted|slant|ital)/i.test(span.fontFamily ?? "");
    const nondefaultColor = color && color !== defaultColor ? color : undefined;
    if (nondefaultColor || bold || italic) {
      ranges.push({
        start,
        end: cursor,
        ...(nondefaultColor ? { color: nondefaultColor } : {}),
        bold,
        italic,
      });
    }
  }
  const merged = mergeRanges(ranges, text);
  let html = "";
  let offset = 0;
  for (const range of merged) {
    html += escapeHtml(text.slice(offset, range.start));
    html += styledHtml(text.slice(range.start, range.end), range);
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
      previous.bold === range.bold &&
      previous.italic === range.italic &&
      /^\s*$/.test(text.slice(previous.end, range.start))
    ) {
      previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function styledHtml(value: string, range: StyledRange): string {
  let html = escapeHtml(value);
  if (range.color) html = `<span style="color:${range.color}">${html}</span>`;
  if (range.italic) html = `<em>${html}</em>`;
  if (range.bold) html = `<strong>${html}</strong>`;
  return html;
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
