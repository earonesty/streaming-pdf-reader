import type { SemanticBlock, TextLine } from "@boxpdf/reader/structure";
import { describe, expect, it } from "vitest";
import {
  clearMediaCaptionAssociations,
  isClearMediaCaption,
  mediaCaptionEvidence,
} from "../src/semantic-caption.js";
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

  it("scores alignment continuously and rejects typographically indistinct text", () => {
    const offCenter = line(captionLine.text, 120, 280, 220, "Caption-Medium");
    const centeredEvidence = mediaCaptionEvidence(media, caption, 400, 600, [body, captionLine]);
    const offCenterEvidence = mediaCaptionEvidence(
      media,
      { type: "paragraph", text: offCenter.text, lines: [offCenter] },
      400,
      600,
      [body, offCenter],
    );
    expect(offCenterEvidence?.score).toBeLessThan(centeredEvidence?.score ?? 0);
    const sameFont = line(captionLine.text, 52, 280, 296, "Body-Regular");
    const sameFontEvidence = mediaCaptionEvidence(
      media,
      { type: "paragraph", text: sameFont.text, lines: [sameFont] },
      400,
      600,
      [body, sameFont],
    );
    expect(sameFontEvidence?.score).toBeLessThan(centeredEvidence?.score ?? 0);
  });

  it("accepts clear captions above media and mutually matches neighboring pairs", () => {
    const leftMedia = { ...media, bounds: { x: 30, y: 180, width: 150, height: 90 } };
    const rightMedia = { ...media, bounds: { x: 220, y: 180, width: 150, height: 90 } };
    const leftLine = line("Légende gauche", 32, 276, 146, "Caption-Medium");
    const rightLine = line("右側の説明", 222, 276, 146, "Caption-Medium");
    const leftBlock = { type: "paragraph" as const, text: leftLine.text, lines: [leftLine] };
    const rightBlock = { type: "paragraph" as const, text: rightLine.text, lines: [rightLine] };
    const associations = clearMediaCaptionAssociations(
      [leftMedia, rightMedia],
      [leftBlock, rightBlock],
      400,
      600,
      [body, leftLine, rightLine],
    );
    expect(associations.get(leftBlock)).toBe(leftMedia);
    expect(associations.get(rightBlock)).toBe(rightMedia);
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
