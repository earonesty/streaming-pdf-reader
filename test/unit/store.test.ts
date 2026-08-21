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

  it("validates options, ranges, empty reads, and short source responses", async () => {
    const source = {
      size: 4,
      async read() {
        return new Uint8Array();
      },
    };
    expect(() => new SparseByteStore(source, { chunkSize: 0 })).toThrow(RangeError);
    expect(() => new SparseByteStore(source, { chunkSize: 4, maxBytes: 3 })).toThrow(RangeError);
    const store = new SparseByteStore(source, { chunkSize: 4, maxBytes: 4 });
    await expect(store.read(0, 0)).resolves.toEqual(new Uint8Array());
    for (const [offset, length] of [
      [-1, 1],
      [0.5, 1],
      [0, -1],
      [0, 0.5],
      [5, 0],
      [3, 2],
    ]) {
      await expect(store.read(offset ?? 0, length ?? 0)).rejects.toThrow(RangeError);
    }
    await expect(store.read(0, 1)).rejects.toThrow("source returned 0 bytes");
  });

  it("shares pending chunk loads and clears resident bytes", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const store = new SparseByteStore(
      {
        size: 8,
        async read(offset, length) {
          reads += 1;
          await gate;
          return Uint8Array.from({ length }, (_, index) => offset + index);
        },
      },
      { chunkSize: 4, maxBytes: 8 },
    );
    const first = store.read(0, 2);
    const second = store.read(1, 2);
    release?.();
    await Promise.all([first, second]);
    expect(reads).toBe(1);
    store.clear();
    expect(store.stats.residentBytes).toBe(0);
  });
});
