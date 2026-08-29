interface Type1FontOptions {
  container?: "pfa" | "pfb";
  eexec?: "binary" | "hex";
  widthOperator?: "hsbw" | "sbw" | "subroutine" | "div";
  lenIV?: number;
  dynamicHints?: boolean;
  blueScale?: number;
  expansionFactor?: number;
}

export function buildType1Font(width: number, options: Type1FontOptions = {}): Uint8Array {
  const lenIV = options.lenIV ?? 4;
  const widthProgram =
    options.widthOperator === "sbw"
      ? [139, 139, ...encodeNumber(width), 139, 12, 7]
      : options.widthOperator === "div"
        ? [139, ...encodeNumber(width * 2), ...encodeNumber(2), 12, 12, 13]
        : options.widthOperator === "subroutine"
          ? [...encodeNumber(options.dynamicHints ? 4 : 0), 10]
          : [139, ...encodeNumber(width), 13];
  const dynamicProgram = options.dynamicHints
    ? [
        ...encodeNumber(10),
        ...encodeNumber(20),
        1,
        ...encodeNumber(0),
        ...encodeNumber(1),
        ...encodeNumber(3),
        12,
        16,
        12,
        17,
        ...encodeNumber(options.widthOperator === "subroutine" ? 5 : 4),
        10,
        ...encodeNumber(30),
        ...encodeNumber(40),
        21,
        14,
      ]
    : [];
  const charStringPlain = Uint8Array.of(
    ...Array.from({ length: Math.max(0, lenIV) }, () => 0),
    ...widthProgram,
    ...dynamicProgram,
  );
  const charString = lenIV < 0 ? charStringPlain : encrypt(charStringPlain, 4_330);
  const subroutinePrograms: number[][] = [];
  if (options.dynamicHints) subroutinePrograms.push([11], [11], [11], [11]);
  if (options.widthOperator === "subroutine")
    subroutinePrograms.push([139, ...encodeNumber(width), 13, 11]);
  if (options.dynamicHints)
    subroutinePrograms.push([...encodeNumber(100), ...encodeNumber(20), 1, 11]);
  const subroutines = subroutinePrograms.map((program) => {
    const plain = Uint8Array.of(...Array.from({ length: Math.max(0, lenIV) }, () => 0), ...program);
    return lenIV < 0 ? plain : encrypt(plain, 4_330);
  });
  const privatePrefix = new TextEncoder().encode(
    `/lenIV ${lenIV} def\n/BlueValues [-20 0 450 470] def\n/BlueScale ${options.blueScale ?? 0.039625} def\n/ExpansionFactor ${options.expansionFactor ?? 0.06} def\n/StemSnapH [30 38] def\n${subroutines.length > 0 ? `/Subrs ${subroutines.length} array ` : ""}`,
  );
  const encodedSubroutines = subroutines.flatMap((subroutine, index) => [
    new TextEncoder().encode(`dup ${index} ${subroutine.length} RD `),
    subroutine,
    new TextEncoder().encode(" NP\n"),
  ]);
  const privateProgram = concatenate([
    Uint8Array.of(0, 0, 0, 0),
    privatePrefix,
    ...encodedSubroutines,
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
