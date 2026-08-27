import { describe, expect, it } from "vitest";
import { componentColor } from "../../src/content/color-space.js";
import type { PdfObjectReader } from "../../src/syntax/document.js";
import { isRef, type PdfDict, type PdfValue } from "../../src/syntax/values.js";

describe("component color spaces", () => {
  it("maps device and ICC component counts to deterministic CSS colors", async () => {
    const profile = {
      type: "stream" as const,
      dict: new Map<string, PdfValue>([["N", 3]]),
      bytes: new Uint8Array(),
    };
    const spaces: PdfDict = new Map([
      [
        "CS0",
        [
          { type: "name", value: "ICCBased" },
          { type: "ref", object: 9, generation: 0 },
        ],
      ],
    ]);
    const resources: PdfDict = new Map([["ColorSpace", spaces]]);
    const reader = {
      resolveDict: async (value: PdfValue | undefined) =>
        value instanceof Map ? value : undefined,
      resolve: async (value: PdfValue) => (isRef(value) ? profile : value),
    } as unknown as PdfObjectReader;

    await expect(componentColor(reader, resources, "CS0", [1, 0.5, 0])).resolves.toBe("#ff8000");
    await expect(componentColor(reader, resources, "DeviceGray", [0.25])).resolves.toBe("#404040");
    await expect(componentColor(reader, resources, "DeviceCMYK", [0, 1, 1, 0])).resolves.toBe(
      "#ff0000",
    );
  });

  it("leaves unsupported pattern and malformed ICC spaces unresolved", async () => {
    const reader = {
      resolveDict: async (value: PdfValue | undefined) =>
        value instanceof Map ? value : undefined,
      resolve: async (value: PdfValue) => value,
    } as unknown as PdfObjectReader;
    await expect(componentColor(reader, new Map(), "Pattern", [1])).resolves.toBeUndefined();
    await expect(componentColor(reader, undefined, undefined, [1])).resolves.toBeUndefined();
  });
});
