import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { convertCffFont } from "../../src/content/cff-font-convert.js";

describe("embedded CFF conversion", () => {
  it("preserves the original CFF table while adding browser cmap and metrics", () => {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(400, 0);
    path.lineTo(400, 700);
    path.closePath();
    const source = new opentype.Font({
      familyName: "Synthetic CFF",
      styleName: "Regular",
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs: [
        new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
        new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path }),
      ],
    });
    const cff = tableBytes(new Uint8Array(source.toArrayBuffer()), "CFF ");
    const glyphNames: Array<string | undefined> = [];
    const characters: string[] = [];
    glyphNames[65] = "A";
    characters[65] = "A";
    const converted = convertCffFont(
      cff,
      "font-1",
      "Synthetic CFF",
      characters,
      glyphNames,
      new Map(),
      new Map([["A", 600]]),
      500,
    );
    expect(converted?.format).toBe("opentype");
    if (!converted) throw new Error("missing converted CFF font");
    expect(new TextDecoder("latin1").decode(converted.data.subarray(0, 4))).toBe("OTTO");
    expect(tableBytes(converted.data, "CFF ")).toEqual(cff);
    const parsed = opentype.parse(converted.data.slice().buffer as ArrayBuffer);
    expect(parsed.charToGlyphIndex("A")).toBe(1);
    expect(parsed.charToGlyphIndex(String.fromCodePoint(0xf0041))).toBe(1);
    expect(parsed.glyphs.get(1).advanceWidth).toBe(600);
  });

  it("rejects malformed and unsupported CFF programs", () => {
    expect(
      convertCffFont(new Uint8Array(), "font-1", undefined, [], [], new Map(), new Map(), 1000),
    ).toBeUndefined();
  });
});

function tableBytes(font: Uint8Array, wantedTag: string): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = new TextDecoder("latin1").decode(font.subarray(record, record + 4));
    if (tag !== wantedTag) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    return font.slice(offset, offset + length);
  }
  throw new Error(`missing ${wantedTag} table`);
}
