import type { ExtractedPage, VectorFill, VectorPath } from "@boxpdf/reader";
import { describe, expect, it } from "vitest";
import { semanticMedia } from "../src/semantic-media.js";

describe("semantic vector components", () => {
  it("clusters nearby primitives and ignores off-page white backgrounds and isolated rules", () => {
    const page = fixturePage(
      [rectangle(10, 100, 20, 20), rectangle(35, 100, 20, 20), rectangle(120, 100, 30, 30), line()],
      [
        fill("#ffffff", [
          [-20, -20],
          [220, -20],
          [220, 220],
          [-20, 220],
        ]),
      ],
    );

    const media = semanticMedia(page);
    expect(media).toHaveLength(2);
    expect(media.map((item) => item.bounds)).toEqual([
      { x: 10, y: 100, width: 45, height: 20 },
      { x: 120, y: 100, width: 30, height: 30 },
    ]);
    expect(media.every((item) => item.html.startsWith('<svg class="pdf-semantic-media"'))).toBe(
      true,
    );
  });

  it("keeps small colored fills and removes page-sized white fills", () => {
    const page = fixturePage(
      [],
      [
        fill("#ffffff", [
          [0, 0],
          [200, 0],
          [200, 200],
          [0, 200],
        ]),
        fill("#ff0000", [
          [40, 40],
          [80, 40],
          [80, 80],
          [40, 80],
        ]),
      ],
    );
    const media = semanticMedia(page);
    expect(media).toHaveLength(1);
    expect(media[0]?.bounds).toEqual({ x: 40, y: 40, width: 40, height: 40 });
    expect(media[0]?.html).toContain('fill="#ff0000"');
  });

  it("combines touching raster and vector pieces but leaves page backdrops independent", () => {
    const page = {
      ...fixturePage([rectangle(48, 100, 30, 40)], []),
      images: [raster([40, 0, 0, 40, 10, 100]), raster([200, 0, 0, 200, 0, 0])],
    };
    const media = semanticMedia(page);
    expect(media).toHaveLength(2);
    const composite = media.find((item) => item.kind === "composite");
    expect(composite?.bounds).toEqual({ x: 10, y: 100, width: 68, height: 40 });
    expect(composite?.html).toContain('<img class="pdf-semantic-media"');
    expect(composite?.html).toContain('<svg class="pdf-semantic-media"');
    expect(media.filter((item) => item.kind === "raster")).toHaveLength(1);
  });
});

function fixturePage(paths: VectorPath[], fills: VectorFill[]): ExtractedPage {
  return { number: 1, width: 200, height: 200, rotate: 0, spans: [], paths, fills };
}

function rectangle(x: number, y: number, width: number, height: number): VectorPath {
  return {
    d: `M${x} ${y}L${x + width} ${y}L${x + width} ${y + height}L${x} ${y + height}Z`,
    stroke: "#000000",
    fill: "none",
    strokeWidth: 1,
  };
}

function line(): VectorPath {
  return { d: "M0 10L200 10", stroke: "#000000", fill: "none", strokeWidth: 1 };
}

function fill(color: string, points: VectorFill["points"]): VectorFill {
  return { color, points, opacity: 1 };
}

function raster(transform: [number, number, number, number, number, number]) {
  return {
    width: 1,
    height: 1,
    format: "rgb" as const,
    data: Uint8Array.of(255, 0, 0),
    transform,
  };
}
