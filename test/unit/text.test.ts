import { describe, expect, it } from "vitest";
import { parseToUnicode, reorderBidiLines } from "../../src/content/text.js";
import type { TextSpan } from "../../src/types.js";

describe("text flow normalization", () => {
  it("reorders visual RTL chunks by line while retaining LTR lines", () => {
    const spans = [span("ג", 10, 20), span("ב", 15, 20), span("א", 20, 20), span("abc", 5, 10)];
    const reordered = reorderBidiLines(spans);
    expect(reordered.map((item) => item.text).join("")).toBe("אבגabc");
    expect(reordered[0]?.bounds.x).toBe(10);
    expect(reordered[0]?.direction).toBe("rtl");
    expect(reordered[3]?.direction).toBe("ltr");
  });

  it("parses sequential and array ToUnicode ranges with their source width", () => {
    const cmap = parseToUnicode(
      new TextEncoder().encode(`2 beginbfrange
<01> <02> <0061>
<03> <04> [<0066> <00660069>]
endbfrange`),
    );
    expect(cmap.codeBytes).toBe(1);
    expect([...cmap.mapping.entries()]).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "f"],
      [4, "fi"],
    ]);
  });
});

function span(text: string, x: number, y: number): TextSpan {
  return {
    text,
    bounds: { x, y, width: 5, height: 10 },
    direction: "ltr",
    fontSize: 10,
    source: { page: 1, objectNumber: 1 },
  };
}
