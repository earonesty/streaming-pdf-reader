import { describe, expect, it } from "vitest";
import { XrefIndex } from "../../src/syntax/xref.js";

describe("packed xref index", () => {
  it("stores sparse direct and compressed entries without per-entry objects", () => {
    const index = new XrefIndex();
    index.set(1, { kind: "direct", offset: 9_007_199_254_740, generation: 7 });
    index.set(4097, { kind: "compressed", streamObject: 42, index: 3 });
    expect(index.size).toBe(2);
    expect(index.get(1)).toEqual({
      kind: "direct",
      offset: 9_007_199_254_740,
      generation: 7,
    });
    expect(index.get(4097)).toEqual({ kind: "compressed", streamObject: 42, index: 3 });
    expect(index.has(2)).toBe(false);
    expect([...index.values()]).toHaveLength(2);
    expect(index.residentBytes).toBe(2 * 1024 * 13 + 8);
    expect(index.nextDirectOffset(0)).toBe(9_007_199_254_740);
    expect(index.nextDirectOffset(9_007_199_254_740)).toBeUndefined();
    index.clear();
    expect(index.size).toBe(0);
  });

  it("does not grow when a newer xref section replaces an entry", () => {
    const index = new XrefIndex();
    index.set(5, { kind: "direct", offset: 10, generation: 0 });
    index.set(5, { kind: "direct", offset: 20, generation: 1 });
    expect(index.size).toBe(1);
    expect(index.get(5)).toEqual({ kind: "direct", offset: 20, generation: 1 });
    expect(index.get(-1)).toBeUndefined();
  });

  it("fails with a typed resource error before exceeding its byte budget", () => {
    const index = new XrefIndex(1024 * 13 + 8);
    index.set(1, { kind: "direct", offset: 10, generation: 0 });
    expect(() => index.set(1024, { kind: "direct", offset: 20, generation: 0 })).toThrowError(
      expect.objectContaining({ code: "RESOURCE_LIMIT" }),
    );
    expect(index.residentBytes).toBe(1024 * 13 + 8);
  });

  it("keeps direct offsets sorted after entries change", () => {
    const index = new XrefIndex();
    index.set(1, { kind: "direct", offset: 30, generation: 0 });
    index.set(2, { kind: "direct", offset: 10, generation: 0 });
    expect(index.nextDirectOffset(10)).toBe(30);
    index.set(1, { kind: "direct", offset: 20, generation: 0 });
    expect(index.nextDirectOffset(10)).toBe(20);
  });
});
