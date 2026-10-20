import { describe, expect, it } from "vitest";
import { parseToUnicode } from "../../src/content/cmap.js";

const parse = (body: string) =>
  parseToUnicode(new TextEncoder().encode(`1 beginbfrange\n${body}\nendbfrange`));

describe("bounded ToUnicode ranges", () => {
  it("preserves sequential and array ranges", () => {
    expect([...parse("<0001> <0003> <0041>").mapping.values()]).toEqual(["A", "B", "C"]);
    const array = parse("<0001> <0003> [<0041> <0042> <0043>]");
    expect([1, 2, 3].map((code) => array.mapping.get(code))).toEqual(["A", "B", "C"]);
  });
  it("accepts the complete 65,536-code range", () => {
    const result = parse("<0000> <ffff> <0000>");
    expect(result.mapping.size).toBe(65536);
    expect(result.mapping.get(65535)).toBe("\uffff");
  });
  it.each(["<0000> <10000> <0041>", "<0000> <ffffffff> [<0041>]"])(
    "skips oversized expansion %s without losing a following valid range",
    (body) => {
      const result = parse(`${body}\n<01> <01> <0042>`);
      expect([...result.mapping.entries()]).toEqual([[1, "B"]]);
      expect(result.codeBytes).toBe(1);
    },
  );
  it.each([
    "<ffffffffffffff> <ffffffffffffff> <0041>",
    "<ffffffffffffff> <ffffffffffffff> [<0041>]",
  ])("rejects unsafe endpoints %s", (body) => {
    expect(parse(body).mapping.size).toBe(0);
  });
});
