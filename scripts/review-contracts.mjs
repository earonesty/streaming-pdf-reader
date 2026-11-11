import { marked } from "marked";
import { parse } from "parse5";

const children = (node) => node.childNodes ?? [];
const ignored = new Set(["head", "style", "script", "svg"]);
function all(node, predicate) {
  if (ignored.has(node.tagName)) return predicate(node) ? [node] : [];
  return [
    ...(predicate(node) ? [node] : []),
    ...children(node).flatMap((child) => all(child, predicate)),
  ];
}
function plain(node) {
  if (ignored.has(node.tagName)) return "";
  return node.nodeName === "#text"
    ? node.value
    : children(node)
        .map((child) => {
          const value = plain(child);
          return /^(?:p|div|section|article|h[1-6]|table|tr|td|th|li|dt|dd|br)$/.test(
            child.tagName ?? "",
          )
            ? ` ${value} `
            : value;
        })
        .join("");
}
const normalize = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
const tokens = (value) => normalize(value).match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
function find(haystack, needle, start = 0) {
  for (let index = start; index <= haystack.length - needle.length; index += 1)
    if (needle.every((value, offset) => haystack[index + offset] === value)) return index;
  return -1;
}
function sequence(value, phrases) {
  const content = tokens(value);
  let offset = 0;
  for (const phrase of phrases) {
    const part = tokens(phrase);
    const index = find(content, part, offset);
    if (index < 0) return false;
    offset = index + part.length;
  }
  return true;
}
export function checkReviewContracts(source, format, checks) {
  const root = parse(format === "markdown" ? marked.parse(source, { gfm: true }) : source);
  const text = plain(root);
  const rows = all(root, (node) => node.tagName === "tr").map((row) =>
    children(row)
      .filter((node) => ["th", "td"].includes(node.tagName))
      .map((cell) => normalize(plain(cell))),
  );
  return checks.flatMap((check, index) => {
    let pass = false;
    switch (check.kind) {
      case "sequence":
        pass = sequence(text, check.values);
        break;
      case "contains":
        pass = sequence(text, [check.value]);
        break;
      case "row":
        pass = rows.some(
          (row) =>
            row.length === check.cells.length &&
            row.every(
              (cell, i) => JSON.stringify(tokens(cell)) === JSON.stringify(tokens(check.cells[i])),
            ),
        );
        break;
      case "rowContains":
        pass = rows.some((row) => {
          let cursor = 0;
          for (const expected of check.cells) {
            const index = row.findIndex((cell, i) => i >= cursor && sequence(cell, [expected]));
            if (index < 0) return false;
            cursor = index + 1;
          }
          return true;
        });
        break;
      case "tableRows":
        pass = all(root, (node) => node.tagName === "table").some(
          (table) => all(table, (node) => node.tagName === "tr").length >= check.min,
        );
        break;
      case "flowParagraph":
        pass = all(root, (node) => node.tagName === "p").some((node) => {
          for (let parent = node.parentNode; parent; parent = parent.parentNode)
            if (["table", "td", "th"].includes(parent.tagName)) return false;
          return sequence(plain(node), check.values);
        });
        break;
      case "group":
        pass = all(root, (node) => node.tagName === check.tag).some((node) =>
          sequence(plain(node), check.values),
        );
        break;
      case "labelValue": {
        const groups = all(root, (node) => ["p", "tr", "li", "div"].includes(node.tagName));
        pass = groups.some((node) => {
          // A whole document wrapper is not evidence of a label/value association.
          if (
            all(
              node,
              (child) =>
                child !== node &&
                ["section", "article", "table", "div", "p", "li", "tr"].includes(child.tagName),
            ).length
          )
            return false;
          return sequence(plain(node), [check.label, check.value]);
        });
        break;
      }
      case "noControls":
        pass = [...text].every((character) => {
          const code = character.codePointAt(0);
          return !(
            code <= 8 ||
            code === 11 ||
            code === 12 ||
            (code >= 14 && code <= 31) ||
            (code >= 127 && code <= 159)
          );
        });
        break;
      case "mediaCaption": {
        pass = all(root, (node) => node.tagName === "figure").some(
          (figure) =>
            sequence(plain(figure), [check.caption]) &&
            all(figure, (node) => node.tagName === check.media).length > 0,
        );
        if (!pass && format === "markdown") {
          // Markdown emits a media block followed by an italic caption paragraph.
          const blocks = children(all(root, (node) => node.tagName === "body")[0] ?? root).filter(
            (node) => node.tagName,
          );
          pass = blocks.some((block, i) => {
            const next = blocks[i + 1]?.tagName === "hr" ? blocks[i + 2] : blocks[i + 1];
            return (
              all(block, (node) => node.tagName === check.media).length > 0 &&
              next?.tagName === "p" &&
              sequence(plain(next), [check.caption])
            );
          });
        }
        break;
      }
      default:
        throw new Error(`Unknown review contract: ${check.kind}`);
    }
    return pass ? [] : [{ check: `contract:${check.kind}`, index, expected: check }];
  });
}
