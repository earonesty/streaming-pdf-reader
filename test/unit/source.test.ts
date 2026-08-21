import { describe, expect, it } from "vitest";
import { memorySource } from "../../src/index.js";

describe("memorySource", () => {
  it("reads only the requested range", async () => {
    const source = memorySource(Uint8Array.from([10, 20, 30, 40]));
    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.from([20, 30]));
  });

  it("rejects out-of-bounds ranges", async () => {
    const source = memorySource(Uint8Array.from([10, 20]));
    await expect(source.read(1, 2)).rejects.toThrow(RangeError);
  });
});
