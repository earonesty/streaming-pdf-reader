import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";
import { imageFixtures, syntheticImagePdf } from "../helpers/synthetic-images.js";

describe("synthetic raster image extraction", () => {
  it("preserves an oversized placement instead of fitting it to the page", async () => {
    const reader = await openPdf(
      memorySource(
        syntheticImagePdf({
          id: "oversized",
          content: "q 220 0 0 176 -10 -8 cm /Im Do Q",
        }),
      ),
    );
    try {
      const page = await reader.getPage(0);
      expect([page.width, page.height]).toEqual([200, 160]);
      expect(page.images).toHaveLength(1);
      expect(page.images?.[0]?.transform).toEqual([220, 0, 0, 176, -10, -8]);
    } finally {
      reader.close();
    }
  });

  it("normalizes the CropBox origin without rescaling the image", async () => {
    const reader = await openPdf(
      memorySource(
        syntheticImagePdf({
          id: "crop",
          pageEntries: "/CropBox [20 30 180 130]",
        }),
      ),
    );
    try {
      const page = await reader.getPage(0);
      expect([page.width, page.height]).toEqual([160, 100]);
      expect(page.images?.[0]?.transform).toEqual([200, 0, 0, 160, -20, -30]);
    } finally {
      reader.close();
    }
  });

  it("retains explicit clipping separately from image placement", async () => {
    const reader = await openPdf(
      memorySource(
        syntheticImagePdf({
          id: "clip",
          content: "q 30 20 140 110 re W n 220 0 0 176 -10 -8 cm /Im Do Q",
        }),
      ),
    );
    try {
      const page = await reader.getPage(0);
      expect(page.images?.[0]?.transform).toEqual([220, 0, 0, 176, -10, -8]);
      expect(page.images?.[0]?.clips).toEqual([{ d: "M30 20L170 20L170 130L30 130Z" }]);
    } finally {
      reader.close();
    }
  });

  for (const id of ["gray-8bit", "gray-1bit", "cmyk", "indexed"]) {
    it.fails(`known gap: ${id} should yield an image`, async () => {
      const fixture = imageFixtures.find((fixture) => fixture.id === id);
      if (!fixture) throw new Error(`Missing fixture ${id}`);
      const reader = await openPdf(memorySource(syntheticImagePdf(fixture)));
      try {
        const page = await reader.getPage(0);
        expect(page.images).toHaveLength(1);
      } finally {
        reader.close();
      }
    });
  }
});
