import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** Review-only serialization of an independently reviewed HTML target. */
export function oracleMarkdown(html) {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  service.use(gfm);
  service.remove(["head", "script", "style"]);
  service.addRule("figureCaptions", {
    filter: "figcaption",
    replacement(content) {
      return `\n\n${content}\n\n`;
    },
  });
  service.addRule("definitions", {
    filter: "dl",
    replacement(_content, node) {
      const entries = Array.from(node.children).flatMap((child) =>
        child.tagName === "DIV" ? Array.from(child.children) : [child],
      );
      let terms = [];
      let hasValue = false;
      const pairs = [];
      for (const entry of entries) {
        if (entry.tagName === "DT") {
          if (hasValue) terms = [];
          terms.push(service.turndown(entry.innerHTML));
          hasValue = false;
        } else if (entry.tagName === "DD") {
          for (const term of terms) pairs.push(`**${term}:** ${service.turndown(entry.innerHTML)}`);
          hasValue = true;
        }
      }
      return `\n\n${pairs.join("\n\n")}\n\n`;
    },
  });
  service.addRule("semanticTables", {
    filter: "table",
    replacement(_content, node) {
      const rows = Array.from(node.querySelectorAll("tr"));
      // Preserve structures GFM cannot represent faithfully, including spans.
      if (node.querySelector("[colspan], [rowspan], table") || !rows.length)
        return `\n\n${node.outerHTML}\n\n`;
      const first = Array.from(rows[0].children);
      if (
        !first.length ||
        !first.every((cell) => cell.tagName === "TH" && cell.getAttribute("scope") !== "row")
      )
        return `\n\n${node.outerHTML}\n\n`;
      const lines = rows.map(
        (row, index) =>
          `| ${Array.from(row.children)
            .map((cell) => {
              let value = service
                .turndown(cell.innerHTML)
                .replace(/\n+/g, "<br>")
                .replace(/\|/g, "\\|");
              if (index > 0 && cell.tagName === "TH") value = `**${value}**`;
              return value;
            })
            .join(" | ")} |`,
      );
      lines.splice(1, 0, `| ${first.map(() => "---").join(" | ")} |`);
      const caption = node.querySelector("caption");
      return `\n\n${caption ? `${service.turndown(caption.innerHTML)}\n\n` : ""}${lines.join("\n")}\n\n`;
    },
  });
  return `${service.turndown(html)}\n`;
}
