import { describe, expect, it } from "vitest";
import { resolveExtendedGraphicsState } from "../../src/content/extgstate.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import type { PdfDict, PdfRef, PdfValue } from "../../src/syntax/values.js";

describe("extended graphics state", () => {
  it("resolves line width and page-resource font overrides", async () => {
    const fontRef: PdfRef = { type: "ref", object: 10, generation: 0 };
    const state: PdfDict = new Map<string, PdfValue>([
      ["LW", 4],
      ["Font", [fontRef, 36]],
      ["ca", 0.25],
      ["CA", 1.5],
    ]);
    const resources: PdfDict = new Map<string, PdfValue>([
      ["ExtGState", new Map<string, PdfValue>([["GS1", state]])],
      ["Font", new Map<string, PdfValue>([["F0", fontRef]])],
    ]);
    const reader = {
      resolveDict: async (value: PdfValue | undefined) =>
        value instanceof Map ? value : undefined,
    } as unknown as PdfObjectReader;

    await expect(
      resolveExtendedGraphicsState(reader, resources, { type: "name", value: "GS1" }),
    ).resolves.toEqual({
      lineWidth: 4,
      fillOpacity: 0.25,
      strokeOpacity: 1,
      fontName: "F0",
      fontSize: 36,
    });
  });

  it("ignores malformed and unknown state resources", async () => {
    const reader = {
      resolveDict: async (value: PdfValue | undefined) =>
        value instanceof Map ? value : undefined,
    } as unknown as PdfObjectReader;
    await expect(
      resolveExtendedGraphicsState(reader, new Map(), undefined),
    ).resolves.toBeUndefined();
    await expect(
      resolveExtendedGraphicsState(
        reader,
        new Map<string, PdfValue>([
          [
            "ExtGState",
            new Map<string, PdfValue>([["Bad", new Map<string, PdfValue>([["LW", -1]])]]),
          ],
        ]),
        { type: "name", value: "Bad" },
      ),
    ).resolves.toEqual({});
  });
});
