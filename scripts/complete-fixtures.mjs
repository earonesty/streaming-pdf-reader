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
    const block =
      /^(?:html|body|main|article|header|footer|section|div|p|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|ul|ol|li|dl|dt|dd|blockquote|address|figure|figcaption)$/.test(
        node.tagName ?? "",
      );
    const preformatted = pre || node.tagName === "pre";
    const content = merged.filter((child) => child !== "");
    if (block && !preformatted) {
      if (typeof content[0] === "string") content[0] = content[0].trimStart();
      if (typeof content.at(-1) === "string")
        content[content.length - 1] = content.at(-1).trimEnd();
      // Whitespace between block children is formatting, not inline word spacing.
      for (let i = content.length - 1; i >= 0; i--) {
        if (typeof content[i] !== "string" || content[i].trim()) continue;
        const adjacent = [content[i - 1], content[i + 1]];
        if (
          !content[i] ||
          adjacent.some(
            (child) =>
              child &&
              typeof child !== "string" &&
              /^(?:p|div|section|header|footer|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|ul|ol|li|dl|dt|dd|figure|figcaption|blockquote|address|hr|br)$/.test(
                child.tag,
              ),
          )
        )
          content.splice(i, 1);
      }
    }
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
