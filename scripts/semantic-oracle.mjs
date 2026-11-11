import { marked } from "marked";
import { parse } from "parse5";

const ignored = new Set(["head", "script", "style", "template", "svg"]);
const boundaries = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "li",
  "ul",
  "ol",
  "table",
  "tr",
  "td",
  "th",
  "br",
  "pre",
  "address",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
function children(node) {
  return node.childNodes ?? [];
}
function attr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}
function rawText(node) {
  if (ignored.has(node.tagName)) return "";
  if (node.nodeName === "#text") return node.value;
  const value = children(node).map(rawText).join("");
  return boundaries.has(node.tagName) ? ` ${value} ` : value;
}
function normalize(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
function text(node) {
  return normalize(rawText(node));
}
function all(node, predicate) {
  if (ignored.has(node.tagName)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...children(node).flatMap((child) => all(child, predicate)),
  ];
}
function tagged(node, tag) {
  return all(node, (item) => item.tagName === tag);
}
function tokens(value) {
  return value.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}
function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}
function difference(expected, actual) {
  const available = counts(actual);
  const missing = [];
  for (const value of expected) {
    const remaining = available.get(value) ?? 0;
    if (remaining > 0) available.set(value, remaining - 1);
    else missing.push(value);
  }
  return missing;
}

export function inspectDocument(source, format = "html") {
  const root = parse(format === "markdown" ? marked.parse(source, { gfm: true }) : source);
  const definitions = definitionPairs(root, format);
  const headings = all(root, (node) => /^h[1-6]$/.test(node.tagName ?? ""));
  const lists = all(root, (node) => node.tagName === "ul" || node.tagName === "ol");
  return {
    definitions,
    tableHeaders: tableHeaders(root, format),
    tokens: tokens(text(root)),
    headings: headings.map((node) => `${node.tagName}:${text(node)}`),
    lists: lists.map((node) =>
      JSON.stringify({
        kind: node.tagName,
        start: attr(node, "start") ?? "1",
        items: children(node)
          .filter((item) => item.tagName === "li")
          .map(text),
      }),
    ),
    tableCaptions: tagged(root, "table").map((node) => tagged(node, "caption").map(text).join(" ")),
    tables: tagged(root, "table").map((node) =>
      JSON.stringify(
        tagged(node, "tr").map((row) =>
          children(row)
            .filter((cell) => cell.tagName === "td" || cell.tagName === "th")
            .map((cell) => ({
              text: text(cell),
              colspan: attr(cell, "colspan") ?? "1",
              rowspan: attr(cell, "rowspan") ?? "1",
            })),
        ),
      ),
    ),
    links: tagged(root, "a").map((node) => JSON.stringify([text(node), attr(node, "href") ?? ""])),
    code: tagged(root, "pre").map((node) => rawText(node).trim().replace(/\r\n/g, "\n")),
    records: headingRecords(root),
  };
}

export function compareDocuments(expected, actual) {
  const findings = [];
  for (const key of [
    "tokens",
    "headings",
    "lists",
    "tables",
    "links",
    "code",
    "records",
    "definitions",
    "tableHeaders",
    "tableCaptions",
  ]) {
    if (key === "tableCaptions" && (!expected[key] || !actual[key])) continue; // Older report snapshots lack captions.
    const missing = difference(expected[key], actual[key]);
    const extra = difference(actual[key], expected[key]);
    if (missing.length || extra.length)
      findings.push({
        check: key,
        missingCount: missing.length,
        extraCount: extra.length,
        missing: missing.slice(0, 8),
        extra: extra.slice(0, 8),
      });
  }
  // Longest common token subsequence, so one missing word cannot cascade into
  // hundreds of false ordering failures. Repeated occurrences are consumed once.
  const positions = new Map();
  actual.tokens.forEach((token, index) => {
    if (!positions.has(token)) positions.set(token, []);
    positions.get(token).push(index);
  });
  const tails = [];
  for (const token of expected.tokens) {
    const matches = positions.get(token) ?? [];
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const position = matches[index];
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (tails[middle] < position) low = middle + 1;
        else high = middle;
      }
      tails[low] = position;
    }
  }
  const shared = expected.tokens.length - difference(expected.tokens, actual.tokens).length;
  if (tails.length < shared)
    findings.push({ check: "readingOrder", orderedTokens: tails.length, sharedTokens: shared });
  return findings;
}

function headingRecords(root) {
  const records = [];
  let current;
  function visit(node) {
    if (ignored.has(node.tagName)) return;
    if (/^h[1-6]$/.test(node.tagName ?? "")) {
      current = { heading: text(node), content: "" };
      records.push(current);
      return;
    }
    if (node.nodeName === "#text") {
      if (current) current.content += node.value;
      return;
    }
    if (current && boundaries.has(node.tagName)) current.content += " ";
    for (const child of children(node)) visit(child);
    if (current && boundaries.has(node.tagName)) current.content += " ";
  }
  visit(root);
  return records.map((record) =>
    JSON.stringify([record.heading, tokens(normalize(record.content))]),
  );
}

// Normalize only explicit label/value syntax. Never strip colons globally.
function definitionPairs(root, format) {
  const pairs = [];
  for (const list of tagged(root, "dl")) {
    let terms = [];
    let hasValue = false;
    const entries = children(list).flatMap((node) =>
      node.tagName === "div" ? children(node) : [node],
    );
    for (const entry of entries) {
      if (entry.tagName === "dt") {
        if (hasValue) terms = [];
        terms.push(text(entry));
        hasValue = false;
      } else if (entry.tagName === "dd") {
        for (const term of terms) pairs.push(JSON.stringify([term, text(entry)]));
        hasValue = true;
      }
    }
  }
  if (format !== "markdown") return pairs;
  for (const paragraph of tagged(root, "p")) {
    const nodes = [...children(paragraph)];
    while (nodes[0]?.nodeName === "#text" && !nodes[0].value.trim()) nodes.shift();
    const label = nodes[0];
    if (label?.tagName !== "strong") continue;
    const labelText = text(label);
    const remainder = nodes.slice(1);
    const inside = labelText.endsWith(":");
    const outside =
      !inside && remainder[0]?.nodeName === "#text" && /^\s*:/.test(remainder[0].value);
    if (!inside && !outside) continue;
    const term = inside ? labelText.slice(0, -1).trim() : labelText;
    const value = normalize(
      remainder
        .map(rawText)
        .join("")
        .replace(outside ? /^\s*:/ : /$^/, ""),
    );
    if (!term || !value) continue;
    pairs.push(JSON.stringify([term, value]));
    if (inside) {
      const leaf = all(label, (node) => node.nodeName === "#text").at(-1);
      leaf.value = leaf.value.replace(/:\s*$/, "");
    } else remainder[0].value = remainder[0].value.replace(/^\s*:/, "");
  }
  return pairs;
}

// Header roles are checked separately from cell contents. GFM has no row-header
// syntax; a fully bold first cell is the reviewed Markdown representation.
function tableHeaders(root, format) {
  return tagged(root, "table").flatMap((table, tableIndex) =>
    tagged(table, "tr").flatMap((row, rowIndex) =>
      children(row)
        .filter((cell) => cell.tagName === "td" || cell.tagName === "th")
        .flatMap((cell, columnIndex) => {
          let role;
          if (cell.tagName === "th") {
            role =
              attr(cell, "scope") ??
              (row.parentNode?.tagName === "thead" || rowIndex === 0
                ? "col"
                : columnIndex === 0
                  ? "row"
                  : "header");
          } else if (format === "markdown" && columnIndex === 0) {
            const content = children(cell).filter(
              (node) => node.nodeName !== "#text" || node.value.trim(),
            );
            if (content.length === 1 && content[0].tagName === "strong" && text(content[0]))
              role = "row";
          }
          return role
            ? [
                JSON.stringify({
                  table: tableIndex,
                  row: rowIndex,
                  column: columnIndex,
                  role,
                  text: text(cell),
                }),
              ]
            : [];
        }),
    ),
  );
}
