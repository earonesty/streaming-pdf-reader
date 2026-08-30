import { describe, expect, it } from "vitest";
import { ValueParser } from "../../src/syntax/parser.js";

const encode = (value: string) => new TextEncoder().encode(value);

describe("ValueParser", () => {
  it("parses primitive values, references, arrays, dictionaries, and escaped names", () => {
    const parser = new ValueParser(
      encode("null true false 12 -3.5 4 2 R /A#20B [1 /X] << /K (v) >>"),
    );
    expect(parser.parseValue()).toBeNull();
    expect(parser.parseValue()).toBe(true);
    expect(parser.parseValue()).toBe(false);
    expect(parser.parseValue()).toBe(12);
    expect(parser.parseValue()).toBe(-3.5);
    expect(parser.parseValue()).toEqual({ type: "ref", object: 4, generation: 2 });
    expect(parser.parseValue()).toEqual({ type: "name", value: "A B" });
    expect(parser.parseValue()).toEqual([1, { type: "name", value: "X" }]);
    expect(parser.parseValue()).toEqual(new Map([["K", { type: "string", bytes: encode("v") }]]));
  });

  it("handles comments and literal string escapes", () => {
    const parser = new ValueParser(encode("% comment\r\n(a\\n\\053\\\r\nb\\(c\\))"));
    expect(parser.parseValue()).toEqual({ type: "string", bytes: encode("a\n+b(c)") });
  });

  it("parses odd hexadecimal strings and restores number lookahead", () => {
    const parser = new ValueParser(encode("<4142f> 7 2 nope"));
    expect(parser.parseValue()).toEqual({ type: "string", bytes: Uint8Array.of(0x41, 0x42, 0xf0) });
    expect(parser.parseValue()).toBe(7);
    expect(parser.parseValue()).toBe(2);
    expect(parser.parseValue()).toBe("nope");
  });

  it.each([
    ["", "expected PDF value"],
    ["nope", null],
    ["1e", "invalid PDF number"],
    ["(unterminated", "unterminated PDF literal string"],
    ["(x\\", "unterminated PDF string escape"],
    ["<00", "unterminated PDF hex string"],
  ])("handles malformed input %j", (input, message) => {
    const action = () => new ValueParser(encode(input)).parseValue();
    if (message) expect(action).toThrow(message);
    else expect(action()).toBe("nope");
  });

  it("rejects values beyond the configured nesting depth", () => {
    expect(() => new ValueParser(encode("[[[0]]]"), 0, 2).parseValue()).toThrow(
      "maximum nesting depth",
    );
    expect(() =>
      new ValueParser(encode("<< /A << /B << /C 0 >> >> >>"), 0, 2).parseValue(),
    ).toThrow("maximum nesting depth");
  });
});
