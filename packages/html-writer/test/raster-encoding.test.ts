import type { ExtractedPage, RasterImage } from "@boxpdf/reader";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { pageToHtml, writeHtmlDocument, writeMarkdownDocument } from "../src/index.js";
import { encodeRaster } from "../src/raster-encoding.js";

function rgb(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  return { width, height, data, format: "rgb", transform: [200, 0, 0, 160, 0, 0] };
}

function page(image: RasterImage): ExtractedPage {
  return { number: 1, width: 200, height: 160, rotate: 0, spans: [], images: [image] };
}

describe("compressed raster output", () => {
  it.each([
    [1, 1],
    [3, 5],
    [128, 128],
  ])("preserves every RGB sample for %i x %i PNGs", async (width, height) => {
    const image = rgb(width, height);
    const encoded = encodeRaster(image);
    expect(encoded.mimeType).toBe("image/png");
    const decoded = await sharp(encoded.data).raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height, decoded.info.channels]).toEqual([
      width,
      height,
      3,
    ]);
    expect(new Uint8Array(decoded.data)).toEqual(image.data);
  });

  it("compresses a scan-sized flat image without BMP expansion", () => {
    const image = rgb(2400, 3200);
    image.data.fill(220);
    const result = encodeRaster(image);
    expect(result.data.length).toBeLessThan(100_000);
  });

  it("selects a smaller decodable JPEG for noisy RGB in compact mode and honors quality", async () => {
    const image = rgb(128, 128);
    const png = encodeRaster(image);
    const low = encodeRaster(image, { imageEncoding: "compact", imageQuality: 30 });
    const high = encodeRaster(image, { imageEncoding: "compact", imageQuality: 90 });
    expect(low.mimeType).toBe("image/jpeg");
    expect(low.data.length).toBeLessThan(high.data.length);
    expect(high.data.length).toBeLessThan(png.data.length);
    const metadata = await sharp(low.data).metadata();
    expect([metadata.width, metadata.height]).toEqual([128, 128]);
  });

  it("keeps PNG when lossy encoding would make the asset larger", () => {
    const image = rgb(128, 128);
    image.data.fill(255);
    const result = encodeRaster(image, { imageEncoding: "compact" });
    expect(result.mimeType).toBe("image/png");
  });

  it.each(["lossless", "compact"] as const)(
    "passes original JPEG bytes through in %s mode",
    async (imageEncoding) => {
      const image = rgb(16, 16);
      const data = await sharp(image.data, { raw: { width: 16, height: 16, channels: 3 } })
        .jpeg()
        .toBuffer();
      const result = encodeRaster({ ...image, format: "jpeg", data }, { imageEncoding });
      expect(result.data).toBe(data);
      expect(result.mimeType).toBe("image/jpeg");
    },
  );

  it.each([0, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid quality %s even with no images",
    async (imageQuality) => {
      await expect(
        pageToHtml(page(rgb(1, 1)), { imageQuality, imageOptions: "excluded" }),
      ).rejects.toThrow("imageQuality");
    },
  );

  it("rejects malformed RGB samples instead of silently padding them", () => {
    expect(() => encodeRaster({ ...rgb(2, 2), data: new Uint8Array(2) })).toThrow("Invalid RGB");
    expect(() => encodeRaster({ ...rgb(1, 1), width: 0 })).toThrow("Invalid RGB");
  });

  it.each(["visual", "semantic", "markdown"] as const)(
    "applies compact encoding to referenced %s assets",
    async (profile) => {
      const assets: { name: string; mimeType: string; data: Uint8Array }[] = [];
      const options = {
        imageEncoding: "compact" as const,
        imageQuality: 30,
        imageOptions: "references" as const,
        onImage: (asset: (typeof assets)[number]) => {
          assets.push(asset);
        },
      };
      let html = "";
      const write = (chunk: string) => {
        html += chunk;
      };
      if (profile === "markdown")
        await writeMarkdownDocument([page(rgb(128, 128))], write, options);
      else await writeHtmlDocument([page(rgb(128, 128))], write, { ...options, profile });
      expect(assets).toHaveLength(1);
      expect(assets[0]?.mimeType).toBe("image/jpeg");
      expect(html).toContain("page-1-image-1.jpg");
      expect((await sharp(assets[0]?.data).metadata()).format).toBe("jpeg");
    },
  );
});
