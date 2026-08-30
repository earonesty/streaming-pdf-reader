import { describe, expect, it } from "vitest";
import { decodeGroup4Mask } from "../../src/content/ccitt.js";
import { extractInlineImageMaskFills } from "../../src/content/type3-image.js";

describe("Type3 inline image masks", () => {
  it("turns decoded one-bit mask runs into transformed vector fills", () => {
    const prefix = new TextEncoder().encode(
      "q 8 0 0 3 10 20 cm BI /W 8 /H 1 /BPC 1 /IM true /D [1 0] ID\n",
    );
    const suffix = new TextEncoder().encode("\nEI Q");
    const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
    bytes.set(prefix);
    bytes[prefix.length] = 0b01010101;
    bytes.set(suffix, prefix.length + 1);

    const fills = extractInlineImageMaskFills(bytes, [1, 0, 0, 1, 0, 0]);
    expect(fills).toHaveLength(4);
    expect(fills[0]).toEqual({
      points: [
        [11, 20],
        [12, 20],
        [12, 23],
        [11, 23],
      ],
      color: "#000000",
    });
    expect(fills[3]?.points[1]).toEqual([18, 20]);
  });

  it("ignores unsupported or truncated inline images", () => {
    expect(
      extractInlineImageMaskFills(
        new TextEncoder().encode("BI /W 8 /H 1 /BPC 8 /IM true ID x EI"),
        [1, 0, 0, 1, 0, 0],
      ),
    ).toEqual([]);
  });

  it("decodes Group 4 compressed inline masks", () => {
    const prefix = new TextEncoder().encode(
      "BI /IM true /W 106 /H 100 /BPC 1 /D[1 0] /F/CCF /DP<</K -1 /Columns 106>> ID ",
    );
    const compressed = Uint8Array.from(
      Buffer.from(
        "JqCkeBS+n/6f6f/p/p/+n+n/6f6fOL7631++lfvrfX76316t9fvrfXq31++t9erfX76316t9fvrfX76V++t9fvrfT6318en+n/OBrdb69W+v31vr1b6/fW+vVvr99b6/fW+n1vr03yJrcSEBoJaG//4AIAI=",
        "base64",
      ),
    );
    const suffix = new TextEncoder().encode(" EI");
    const bytes = new Uint8Array(prefix.length + compressed.length + suffix.length);
    bytes.set(prefix);
    bytes.set(compressed, prefix.length);
    bytes.set(suffix, prefix.length + compressed.length);

    const fills = extractInlineImageMaskFills(bytes, [1, 0, 0, 1, 0, 0]);
    expect(fills.length).toBeGreaterThan(100);
  });

  it("rejects Group 4 masks whose decoded bitmap exceeds the pixel limit", () => {
    expect(() => decodeGroup4Mask(Uint8Array.of(0), 100_000, 100_000)).toThrow(
      "decoded pixel limit",
    );
  });

  it("enforces the vector fill limit across multiple inline masks", () => {
    const first = inlineMask(200_000, new Uint8Array(25_000).fill(0x55));
    const second = inlineMask(8, Uint8Array.of(0x40));
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first);
    bytes.set(second, first.length);

    expect(() => extractInlineImageMaskFills(bytes, [1, 0, 0, 1, 0, 0])).toThrow(
      "vector fill limit",
    );
  });
});

function inlineMask(width: number, data: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`BI /W ${width} /H 1 /BPC 1 /IM true /D [1 0] ID\n`);
  const suffix = new TextEncoder().encode("\nEI ");
  const bytes = new Uint8Array(prefix.length + data.length + suffix.length);
  bytes.set(prefix);
  bytes.set(data, prefix.length);
  bytes.set(suffix, prefix.length + data.length);
  return bytes;
}
