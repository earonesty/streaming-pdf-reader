import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflate, deflateRaw } from "pako";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";
import { extractObjectStream } from "../../src/syntax/object-stream.js";
import type { PdfStream, PdfValue } from "../../src/syntax/values.js";

const encode = (s: string) => new TextEncoder().encode(s);
const limits = { maxObjectBytes: 1024, maxObjectStreamDecodedBytes: 1024 * 1024 };
function stream(
  header: string,
  body: string,
  count = 2,
  extra: Record<string, PdfValue> = {},
): PdfStream {
  return {
    type: "stream",
    bytes: deflate(encode(header + body)),
    dict: new Map(
      Object.entries({
        Type: { type: "name", value: "ObjStm" },
        Filter: { type: "name", value: "FlateDecode" },
        N: count,
        First: header.length,
        ...extra,
      }),
    ),
  };
}
const metrics = () => ({ decodedBytes: 0, peakBufferBytes: 0 });
describe("bounded object stream extraction", () => {
  it("opens the page tree and extracts text after a >32 MiB stream with 163,053 entries", async () => {
    const bytes = await readFile(new URL("../fixtures/large-object-stream.pdf", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "05a80de83db85a1a63773b63db99d3b89bd6ace64528aea4361648da934ddd49",
    );
    const pdf = await openPdf(memorySource(bytes), {
      maxBytes: 64 * 1024,
      maxObjectCacheBytes: 64 * 1024,
      maxDecodedStreamBytes: 2 * 1024 * 1024,
    });
    try {
      expect(await pdf.getPageCount()).toBe(1);
      expect((await pdf.getPage(0)).spans.map((s) => s.text).join("")).toBe(
        "Bounded object stream",
      );
      expect(pdf.stats.objectStreamDecodedBytes).toBeGreaterThan(80 * 1024 * 1024);
      expect(pdf.stats.peakObjectStreamBufferBytes).toBeLessThan(128 * 1024);
    } finally {
      pdf.close();
    }
  }, 30000);
  it.each([0, 1, 200])("selects the requested identity with xref index %i", (index) => {
    const s = stream("10 0 11 5 ", "true false");
    expect(extractObjectStream(s, 11, index, limits, metrics())).toBe(false);
  });
  it("decodes sorted non-final targets in one pass and replays the final target", () => {
    const s = stream("10 0 11 5 12 11 ", "true false null", 3);
    for (const [object, index, expected, passes] of [
      [10, 0, true, 1],
      [11, 1, false, 1],
      [12, 2, null, 2],
    ] as const) {
      const m = metrics();
      expect(extractObjectStream(s, object, index, limits, m)).toBe(expected);
      expect(m.decodedBytes).toBe((16 + 15) * passes);
    }
  });
  it("handles unsorted offsets and confines parsing to the target interval", () => {
    expect(extractObjectStream(stream("10 5 11 0 ", "true false"), 10, 0, limits, metrics())).toBe(
      false,
    );
    expect(() =>
      extractObjectStream(stream("10 0 11 2 ", "(xtrue"), 10, 0, limits, metrics()),
    ).toThrow("unterminated");
  });
  it("accepts comments, an EOF-terminated integer, raw deflate and no filter", () => {
    const s = stream("10% comment\n0 11 5", "true false");
    expect(extractObjectStream(s, 11, 1, limits, metrics())).toBe(false);
    s.bytes = deflateRaw(encode("10% comment\n0 11 5true false"));
    expect(extractObjectStream(s, 11, 1, limits, metrics())).toBe(false);
    s.dict.delete("Filter");
    s.bytes = encode("10% comment\n0 11 5true false");
    expect(extractObjectStream(s, 11, 1, limits, metrics())).toBe(false);
  });
  it.each(["10 0 11 999 ", "10 -1 11 5 ", "10 0 11 9007199254740992 ", "10 0 11 "])(
    "rejects malformed header %s",
    (header) => {
      expect(() =>
        extractObjectStream(stream(header, "true false"), 10, 0, limits, metrics()),
      ).toThrow();
    },
  );
  it("enforces target and traversal budgets separately", () => {
    const s = stream("10 0 11 5 ", "true false");
    expect(() =>
      extractObjectStream(s, 11, 1, { ...limits, maxObjectBytes: 2 }, metrics()),
    ).toThrow("object limit");
    expect(() =>
      extractObjectStream(s, 11, 1, { ...limits, maxObjectStreamDecodedBytes: 15 }, metrics()),
    ).toThrow("traversal limit");
  });
  it("counts both passes against a single aggregate work budget", () => {
    const s = stream("10 0 11 5 ", "true false");
    const m = metrics();
    expect(() =>
      extractObjectStream(s, 11, 1, { ...limits, maxObjectStreamDecodedBytes: 30 }, m),
    ).toThrow("aggregate decoded traversal limit");
    expect(m.decodedBytes).toBe(40);
  });
  it("does not reset a caller-owned budget during a lookup retry", () => {
    const s = stream("10 0 11 5 ", "true false");
    const work = { decodedBytes: 0 };
    const m = metrics();
    const bounded = { ...limits, maxObjectStreamDecodedBytes: 60 };
    expect(extractObjectStream(s, 11, 1, bounded, m, work)).toBe(false);
    expect(() => extractObjectStream(s, 11, 1, bounded, m, work)).toThrow(
      "aggregate decoded traversal limit",
    );
    expect(work.decodedBytes).toBe(80);
    expect(m.decodedBytes).toBe(80);
  });
  it("handles header tokens and comments spanning output chunks", () => {
    for (const header of [
      `%${"x".repeat(65534)}\n10 0 11 5 `,
      `${" ".repeat(65535)}10 0 11 5 `,
      "+10 +0 +11 +5 ",
    ]) {
      expect(extractObjectStream(stream(header, "true false"), 11, 1, limits, metrics())).toBe(
        false,
      );
    }
  });
  it("supports a filter array and the Fl alias", () => {
    const s = stream("10 0 11 5 ", "true false", 2, {
      Filter: [{ type: "name", value: "Fl" }],
      DecodeParms: [null],
    });
    expect(extractObjectStream(s, 11, 1, limits, metrics())).toBe(false);
  });
  it("validates checksum and truncation even after finding a target", () => {
    const s = stream("10 0 11 5 ", "true false");
    s.bytes[s.bytes.length - 1] = (s.bytes[s.bytes.length - 1] ?? 0) ^ 1;
    expect(() => extractObjectStream(s, 10, 0, limits, metrics())).toThrow("FlateDecode failed");
    s.bytes = s.bytes.subarray(0, -5);
    expect(() => extractObjectStream(s, 10, 0, limits, metrics())).toThrow();
  });
  it("leaves unsupported filters and predictors to the existing bounded decoder", () => {
    expect(
      extractObjectStream(
        stream("10 0 11 5 ", "true false", 2, { DecodeParms: new Map([["Predictor", 12]]) }),
        10,
        0,
        limits,
        metrics(),
      ),
    ).toBeUndefined();
    expect(
      extractObjectStream(
        stream("10 0 11 5 ", "true false", 2, { Filter: { type: "name", value: "LZWDecode" } }),
        10,
        0,
        limits,
        metrics(),
      ),
    ).toBeUndefined();
  });
});
