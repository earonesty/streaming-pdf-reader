import { describe, expect, it } from "vitest";
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
});
