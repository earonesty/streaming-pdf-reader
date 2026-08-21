import { describe, expect, it } from "vitest";
import { SparseByteStore } from "../../src/store/sparse.js";

describe("SparseByteStore", () => {
  it("coalesces reads into chunks and evicts least-recently-used bytes", async () => {
    const reads: Array<[number, number]> = [];
    const source = {
      size: 32,
      async read(offset: number, length: number) {
        reads.push([offset, length]);
        return Uint8Array.from({ length }, (_, index) => offset + index);
      },
    };
    const store = new SparseByteStore(source, { chunkSize: 8, maxBytes: 16 });

    expect(await store.read(3, 10)).toEqual(Uint8Array.from({ length: 10 }, (_, i) => i + 3));
    await store.read(4, 2);
    await store.read(20, 2);

    expect(reads).toEqual([
      [0, 8],
      [8, 8],
      [16, 8],
    ]);
    expect(store.stats.cacheHits).toBeGreaterThan(0);
    expect(store.stats.peakResidentBytes).toBeLessThanOrEqual(16);
  });
});
