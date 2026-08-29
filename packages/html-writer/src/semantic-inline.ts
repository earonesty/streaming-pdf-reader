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
  return semanticText(text, lines, defaultColor, preserveWeight, "html");
}

export function semanticTextMarkdown(
  text: string,
  lines: TextLine[],
  defaultColor: string,
  preserveWeight = true,
): string {
  return semanticText(text, lines, defaultColor, preserveWeight, "markdown");
}

function semanticText(
  text: string,
  lines: TextLine[],
  defaultColor: string,
  preserveWeight: boolean,
  format: "html" | "markdown",
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
    html += escapeText(text.slice(offset, range.start), format);
    html += styledText(text.slice(range.start, range.end), range, format);
    offset = range.end;
  }
  return html + escapeText(text.slice(offset), format);
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

function styledText(value: string, range: StyledRange, format: "html" | "markdown"): string {
  let html = escapeText(value, format);
  if (range.color) html = `<span style="color:${range.color}">${html}</span>`;
  if (range.italic) html = format === "html" ? `<em>${html}</em>` : `_${html}_`;
  if (range.bold) html = format === "html" ? `<strong>${html}</strong>` : `**${html}**`;
  return html;
}

function escapeText(value: string, format: "html" | "markdown"): string {
  return format === "html" ? escapeHtml(value) : escapeMarkdown(value);
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
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
