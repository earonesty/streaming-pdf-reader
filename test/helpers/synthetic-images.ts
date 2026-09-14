import { deflateSync } from "node:zlib";

export interface ImageFixture {
  id: string;
  issue?: string;
  width?: number;
  height?: number;
  bits?: number;
  colorSpace?: string;
  pixels?: Uint8Array;
  imageEntries?: string;
  pageEntries?: string;
  content?: string;
  mask?: boolean;
}

// Distinct quadrants expose flipping, stretching, cropping, and accidental fit-to-page.
const quadrants = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0);
export const imageFixtures: ImageFixture[] = [
  { id: "page-sized-rgb" },
  {
    id: "low-resolution-rgb",
    width: 2,
    height: 2,
    issue: "browser smooths image despite default PDF Interpolate false",
  },
  { id: "oversized-rgb", content: "q 220 0 0 176 -10 -8 cm /Im Do Q" },
  { id: "high-resolution-rgb", width: 2400, height: 3200 },
  { id: "cropbox-offset", pageEntries: "/CropBox [20 30 180 130]" },
  ...[90, 180, 270].map((rotate) => ({
    id: `rotated-${rotate}`,
    pageEntries: `/Rotate ${rotate}`,
    content: "q 220 0 0 176 -10 -8 cm /Im Do Q",
  })),
  { id: "explicit-clip", content: "q 30 20 140 110 re W n 220 0 0 176 -10 -8 cm /Im Do Q" },
  { id: "reflected-image", content: "q -220 0 0 176 210 -8 cm /Im Do Q" },
  {
    id: "gray-8bit",
    colorSpace: "/DeviceGray",
    pixels: Uint8Array.of(0, 80, 160, 240),
    issue: "grayscale image omitted",
  },
  {
    id: "gray-1bit",
    bits: 1,
    colorSpace: "/DeviceGray",
    pixels: Uint8Array.of(0x40, 0x80),
    issue: "1-bit scan omitted",
  },
  {
    id: "cmyk",
    colorSpace: "/DeviceCMYK",
    pixels: Uint8Array.of(0, 255, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 0, 0, 255, 0),
    issue: "CMYK image omitted",
  },
  {
    id: "indexed",
    colorSpace: "[/Indexed /DeviceRGB 3 <ff000000ff000000ffffff00>]",
    pixels: Uint8Array.of(0, 1, 2, 3),
    issue: "indexed image omitted",
  },
  {
    id: "inverted-decode",
    imageEntries: "/Decode [1 0 1 0 1 0]",
    issue: "image Decode array ignored",
  },
  { id: "soft-mask", mask: true, imageEntries: "/SMask 6 0 R", issue: "soft mask ignored" },
  { id: "vector-before-image", content: "1 0 1 rg 0 0 200 160 re f q 200 0 0 160 0 0 cm /Im Do Q" },
  {
    id: "vector-after-image",
    content: "q 200 0 0 160 0 0 cm /Im Do Q 1 0 1 rg 50 40 100 80 re f",
    issue: "image incorrectly painted over later vector fill",
  },
];

/** A complete PDF with binary streams, exact lengths, and a real xref table. */
export function syntheticImagePdf(fixture: ImageFixture): Buffer {
  const width = fixture.width ?? (fixture.pixels ? 2 : 400);
  const height = fixture.height ?? (fixture.pixels ? 2 : 320);
  let pixels = fixture.pixels ?? quadrants;
  if (width !== 2 || height !== 2) {
    pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // A black edge band makes clipping visibly different from fitting to the page.
        if (x < width / 8) continue;
        const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
        pixels.set(quadrants.subarray(quadrant * 3, quadrant * 3 + 3), (y * width + x) * 3);
      }
    }
  }
  const stream = (dictionary: string, data: Uint8Array) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from("\nendstream"),
    ]);
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] ${fixture.pageEntries ?? ""} /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>`,
    stream("", Buffer.from(fixture.content ?? "q 200 0 0 160 0 0 cm /Im Do Q")),
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent ${fixture.bits ?? 8} /ColorSpace ${fixture.colorSpace ?? "/DeviceRGB"} /Filter /FlateDecode ${fixture.imageEntries ?? ""}`,
      deflateSync(pixels),
    ),
  ];
  if (fixture.mask)
    objects.push(
      stream(
        "/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray",
        Uint8Array.of(0, 255, 255, 0),
      ),
    );
  const chunks = [Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1")];
  const offsets = [0];
  let length = chunks[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(object),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
