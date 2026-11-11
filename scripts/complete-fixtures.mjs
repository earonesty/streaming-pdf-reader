import { marked } from "marked";
import { parse } from "parse5";

// Compare the entire semantic tree, including emphasis, links, grouping and
// table attributes. Ignore document chrome, presentation and attribute order.
export function completeTree(source, format = "html") {
  const root = parse(format === "markdown" ? marked.parse(source) : source);
  function visit(node, pre = false) {
    if (node.nodeName === "#text") return [pre ? node.value : node.value.replace(/\s+/g, " ")];
    if (["head", "style", "script"].includes(node.tagName)) return [];
    const children = (node.childNodes ?? []).flatMap((child) =>
      visit(child, pre || node.tagName === "pre"),
    );
    const merged = [];
    for (const child of children) {
      if (typeof child === "string" && typeof merged.at(-1) === "string")
        merged[merged.length - 1] += child;
      else merged.push(child);
    }
    if (node.tagName === "span") return merged;
    const content = merged
      .map((child) => (typeof child === "string" && !pre ? child.trim() : child))
      .filter((child) => child !== "");
    if (!node.tagName || ["html", "body", "main", "span"].includes(node.tagName)) return content;
    const attrs = (node.attrs ?? [])
      .filter(
        (attr) => !["class", "style", "id"].includes(attr.name) && !attr.name.startsWith("data-"),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ tag: node.tagName, attrs, children: content }];
  }
  return visit(root);
}
export function compareComplete(expected, actual, format) {
  const expectedTree = completeTree(expected, format);
  const actualTree = completeTree(actual, format);
  return JSON.stringify(expectedTree) === JSON.stringify(actualTree)
    ? []
    : [{ check: "complete-document", expected: expectedTree, actual: actualTree, enforced: true }];
}
