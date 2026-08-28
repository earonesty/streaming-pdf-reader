import type { SemanticBlock, TextLine } from "@boxpdf/reader/structure";
import { describe, expect, it } from "vitest";
import { isClearMediaCaption } from "../src/semantic-caption.js";
import type { SemanticMedia } from "../src/semantic-media.js";

describe("language-independent media captions", () => {
  const media: SemanticMedia = {
    bounds: { x: 50, y: 300, width: 300, height: 180 },
    html: "<svg></svg>",
  };
  const body = line("Texte courant autour du média.", 50, 500, 300, "Body-Regular");
  const captionLine = line("説明文は画像の直下で中央揃えされる。", 52, 280, 296, "Caption-Medium");
  const caption: SemanticBlock = {
    type: "paragraph",
    text: captionLine.text,
    lines: [captionLine],
  };

  it("accepts centered adjacent text with a distinct font without inspecting its language", () => {
    expect(isClearMediaCaption(media, caption, 400, 600, [body, captionLine])).toBe(true);
  });

  it("rejects off-center or typographically indistinct text", () => {
    const offCenter = line(captionLine.text, 120, 280, 220, "Caption-Medium");
    expect(
      isClearMediaCaption(
        media,
        { type: "paragraph", text: offCenter.text, lines: [offCenter] },
        400,
        600,
        [body, offCenter],
      ),
    ).toBe(false);
    const sameFont = line(captionLine.text, 52, 280, 296, "Body-Regular");
    expect(
      isClearMediaCaption(
        media,
        { type: "paragraph", text: sameFont.text, lines: [sameFont] },
        400,
        600,
        [body, sameFont],
      ),
    ).toBe(false);
  });
});

function line(text: string, x: number, y: number, width: number, fontFamily: string): TextLine {
  return {
    type: "line",
    text,
    bounds: { x, y, width, height: 12 },
    spans: [
      {
        text,
        bounds: { x, y, width, height: 12 },
        direction: "ltr",
        fontSize: 10,
        fontFamily,
        source: { page: 1 },
      },
    ],
    confidence: 1,
    reasons: [],
  };
}
