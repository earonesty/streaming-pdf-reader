import UTIF from "utif2";

export function decodeGroup4Mask(data: Uint8Array, width: number, height: number): Uint8Array {
  const tiff = group4Tiff(data, width, height);
  const buffer = tiff.slice().buffer as ArrayBuffer;
  const ifd = UTIF.decode(buffer)[0];
  if (!ifd) return new Uint8Array();
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  if (rgba.length !== width * height * 4) return new Uint8Array();
  const stride = Math.ceil(width / 8);
  const output = new Uint8Array(stride * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (
      (rgba[offset] ?? 0) >= 128 &&
      (rgba[offset + 1] ?? 0) >= 128 &&
      (rgba[offset + 2] ?? 0) >= 128
    ) {
      const row = Math.floor(pixel / width);
      const column = pixel % width;
      const byte = row * stride + Math.floor(column / 8);
      output[byte] = (output[byte] ?? 0) | (1 << (7 - (column % 8)));
    }
  }
  return output;
}

function group4Tiff(data: Uint8Array, width: number, height: number): Uint8Array {
  const entryCount = 11;
  const dataOffset = 8 + 2 + entryCount * 12 + 4;
  const output = new Uint8Array(dataOffset + data.length);
  const view = new DataView(output.buffer);
  output.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entryCount, true);
  let offset = 10;
  const entry = (tag: number, type: 3 | 4, value: number): void => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, 1, true);
    if (type === 3) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
    offset += 12;
  };
  entry(256, 4, width);
  entry(257, 4, height);
  entry(258, 3, 1);
  entry(259, 3, 4);
  entry(262, 3, 0);
  entry(266, 3, 1);
  entry(273, 4, dataOffset);
  entry(277, 3, 1);
  entry(278, 4, height);
  entry(279, 4, data.length);
  entry(293, 4, 0);
  output.set(data, dataOffset);
  return output;
}
