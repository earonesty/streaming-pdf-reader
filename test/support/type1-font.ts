interface Type1FontOptions {
  container?: "pfa" | "pfb";
  eexec?: "binary" | "hex";
  widthOperator?: "hsbw" | "sbw" | "subroutine" | "div";
  lenIV?: number;
}

export function buildType1Font(width: number, options: Type1FontOptions = {}): Uint8Array {
  const lenIV = options.lenIV ?? 4;
  const widthProgram =
    options.widthOperator === "sbw"
      ? [139, 139, ...encodeNumber(width), 139, 12, 7]
      : options.widthOperator === "div"
        ? [139, ...encodeNumber(width * 2), ...encodeNumber(2), 12, 12, 13]
        : options.widthOperator === "subroutine"
          ? [139, 10]
          : [139, ...encodeNumber(width), 13];
  const charStringPlain = Uint8Array.of(
    ...Array.from({ length: Math.max(0, lenIV) }, () => 0),
    ...widthProgram,
  );
  const charString = lenIV < 0 ? charStringPlain : encrypt(charStringPlain, 4_330);
  const subroutinePlain = Uint8Array.of(
    ...Array.from({ length: Math.max(0, lenIV) }, () => 0),
    139,
    ...encodeNumber(width),
    13,
    11,
  );
  const subroutine =
    options.widthOperator === "subroutine"
      ? lenIV < 0
        ? subroutinePlain
        : encrypt(subroutinePlain, 4_330)
      : undefined;
  const privatePrefix = new TextEncoder().encode(
    `/lenIV ${lenIV} def\n${subroutine ? `/Subrs 1 array dup 0 ${subroutine.length} RD ` : ""}`,
  );
  const privateProgram = concatenate([
    Uint8Array.of(0, 0, 0, 0),
    privatePrefix,
    ...(subroutine ? [subroutine, new TextEncoder().encode(" NP\n")] : []),
    new TextEncoder().encode(`/CharStrings 1 dict dup begin\n/A ${charString.length} RD `),
    charString,
    new TextEncoder().encode(" ND\nend\n"),
  ]);
  const clear = new TextEncoder().encode(
    "%!PS-AdobeFont-1.0: Synthetic 1.0\n11 dict begin\n/FontName /Synthetic def\n/FontType 1 def\n/PaintType 0 def\n/FontMatrix [0.001 0 0 0.001 0 0] def\n/FontBBox [0 0 1000 1000] def\n/Encoding 256 array\ndup 65 /A put\nreadonly def\ncurrentfile eexec\n",
  );
  const encrypted = encrypt(privateProgram, 55_665);
  if (options.container === "pfb")
    return concatenate([
      pfbHeader(1, clear.length),
      clear,
      pfbHeader(2, encrypted.length),
      encrypted,
      Uint8Array.of(0x80, 3, 0, 0, 0, 0),
    ]);
  return concatenate([
    clear,
    options.eexec === "hex"
      ? new TextEncoder().encode(
          [...encrypted].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        )
      : encrypted,
  ]);
}

function pfbHeader(type: number, length: number): Uint8Array {
  const output = new Uint8Array(6);
  output.set([0x80, type]);
  new DataView(output.buffer).setUint32(2, length, true);
  return output;
}

function encodeNumber(value: number): number[] {
  if (value >= -107 && value <= 107) return [value + 139];
  if (value >= 108 && value <= 1131) {
    const adjusted = value - 108;
    return [247 + Math.floor(adjusted / 256), adjusted % 256];
  }
  if (value <= -108 && value >= -1131) {
    const adjusted = -value - 108;
    return [251 + Math.floor(adjusted / 256), adjusted % 256];
  }
  const output = new Uint8Array(5);
  output[0] = 255;
  new DataView(output.buffer).setInt32(1, value);
  return [...output];
}

function encrypt(bytes: Uint8Array, key: number): Uint8Array {
  const output = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const cipher = (bytes[index] as number) ^ (key >> 8);
    output[index] = cipher;
    key = ((cipher + key) * 52_845 + 22_719) & 0xffff;
  }
  return output;
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
