import type { RasterImage } from "@boxpdf/reader";
import { encode } from "jpeg-js";
import { Deflate } from "pako";

export interface ImageEncodingOptions {
  /** Lossless preserves JPEG bytes and encodes RGB as PNG. Compact selects the smaller PNG/JPEG. */
  imageEncoding?: "lossless" | "compact";
  /** JPEG quality for compact RGB encoding, from 1 to 100. Default: 80. */
  imageQuality?: number;
}

export function validateImageEncoding(options: ImageEncodingOptions): void {
  if (
    options.imageEncoding !== undefined &&
    !["lossless", "compact"].includes(options.imageEncoding)
  ) {
    throw new RangeError('imageEncoding must be "lossless" or "compact"');
  }
  if (
    options.imageQuality !== undefined &&
    (!Number.isFinite(options.imageQuality) ||
      options.imageQuality < 1 ||
      options.imageQuality > 100)
  ) {
    throw new RangeError("imageQuality must be between 1 and 100");
  }
}

export function encodeRaster(
  image: RasterImage,
  options: ImageEncodingOptions = {},
): {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
} {
  validateImageEncoding(options);
  if (image.format === "jpeg")
    return { data: image.data, mimeType: "image/jpeg", extension: "jpg" };
  const { width, height, data } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    data.length !== width * height * 3
  ) {
    throw new RangeError("Invalid RGB image dimensions or data length");
  }
  const png = rgbPng(image);
  // JPEG's dimensions are limited to 16 bits. Larger images remain lossless.
  if (options.imageEncoding === "compact" && width <= 65535 && height <= 65535) {
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba[pixel * 4] = data[pixel * 3] ?? 0;
      rgba[pixel * 4 + 1] = data[pixel * 3 + 1] ?? 0;
      rgba[pixel * 4 + 2] = data[pixel * 3 + 2] ?? 0;
      rgba[pixel * 4 + 3] = 255;
    }
    const jpeg = encode({ width, height, data: rgba }, options.imageQuality ?? 80).data;
    if (jpeg.length < png.length) return { data: jpeg, mimeType: "image/jpeg", extension: "jpg" };
  }
  return { data: png, mimeType: "image/png", extension: "png" };
}

// Feed filtered scanlines into one zlib stream; do not allocate a second raw image.
function rgbPng({ width, height, data }: RasterImage): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2], 8); // 8-bit truecolor, no interlace.
  const deflater = new Deflate();
  const stride = width * 3;
  const row = new Uint8Array(stride + 1);
  for (let y = 0; y < height; y++) {
    row[0] = y === 0 ? 1 : 2; // Sub on first row; Up thereafter.
    for (let x = 0; x < stride; x++) {
      const previous =
        y === 0 ? (x < 3 ? 0 : (data[x - 3] ?? 0)) : (data[(y - 1) * stride + x] ?? 0);
      row[x + 1] = (data[y * stride + x] ?? 0) - previous;
    }
    deflater.push(row, y === height - 1);
  }
  if (deflater.err) throw new Error(`PNG compression failed: ${deflater.msg}`);
  const chunks = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    chunk("IDAT", deflater.result as Uint8Array),
    chunk("IEND", new Uint8Array()),
  ];
  const output = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function chunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(new TextEncoder().encode(type), 4);
  output.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, -4))
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  view.setUint32(output.length - 4, (crc ^ 0xffffffff) >>> 0);
  return output;
}
