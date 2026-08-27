import { describe, expect, it } from "vitest";
import { extractGraphicsStream } from "../../src/content/graphics.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";

describe("page graphics", () => {
  it("retains the active clipping path on subsequently painted paths", async () => {
    const reader = { limits: { maxFormDepth: 8 } } as PdfObjectReader;
    const bytes = new TextEncoder().encode("10 20 30 40 re W n 0 0 m 100 0 l 100 100 l h f");

    const graphics = await extractGraphicsStream(reader, bytes, undefined, [1, 0, 0, 1, 0, 0]);

    expect(graphics.paths).toHaveLength(1);
    expect(graphics.paths[0]?.clips).toEqual([{ d: "M10 20L40 20L40 60L10 60Z" }]);
  });

  it("restores clipping state with the graphics-state stack", async () => {
    const reader = { limits: { maxFormDepth: 8 } } as PdfObjectReader;
    const bytes = new TextEncoder().encode(
      "q 10 20 30 40 re W* n 0 0 m 100 0 l S Q 0 10 m 100 10 l S",
    );

    const graphics = await extractGraphicsStream(reader, bytes, undefined, [1, 0, 0, 1, 0, 0]);

    expect(graphics.paths[0]?.clips).toEqual([
      { d: "M10 20L40 20L40 60L10 60Z", fillRule: "evenodd" },
    ]);
    expect(graphics.paths[1]?.clips).toBeUndefined();
  });
});
