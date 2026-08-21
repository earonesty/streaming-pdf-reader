import { describe, expect, it } from "vitest";
import { blobSource, memorySource } from "../../src/index.js";

describe("memorySource", () => {
  it("reads only the requested range", async () => {
    const source = memorySource(Uint8Array.from([10, 20, 30, 40]));
    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.from([20, 30]));
  });

  it("rejects out-of-bounds ranges", async () => {
    const source = memorySource(Uint8Array.from([10, 20]));
    for (const [offset, length] of [
      [-1, 1],
      [0.5, 1],
      [0, -1],
      [0, 0.5],
      [3, 0],
      [1, 2],
    ]) {
      await expect(source.read(offset ?? 0, length ?? 0)).rejects.toThrow(RangeError);
    }
  });

  it("reads Blob slices", async () => {
    const source = blobSource(new Blob([Uint8Array.of(1, 2, 3)]));
    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.of(2, 3));
  });
});
