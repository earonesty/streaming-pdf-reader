import type { Type1GlyphPath, Type1GlyphProgram, Type1Metrics } from "./type1-types.js";

export type { Type1Metrics } from "./type1-types.js";

export function parseType1GlyphPaths(bytes: Uint8Array): Type1GlyphProgram | undefined {
  const parsed = type1Program(bytes);
  if (!parsed) return undefined;
  const output: Type1GlyphPath[] = [];
  for (const [name, charString] of parsed.charStrings) {
    const glyph = interpretGlyph(charString, parsed.subroutines, parsed.scale);
    if (glyph) output.push({ name, ...glyph });
  }
  return output.length > 0
    ? { glyphs: output, privateDict: type1PrivateDict(parsed.privateText, parsed.scale) }
    : undefined;
}

const encoder = new TextEncoder();
const eexecMarker = encoder.encode("currentfile eexec");

export function parseType1Metrics(bytes: Uint8Array): Type1Metrics | undefined {
  const parsed = type1Program(bytes);
  if (!parsed) return undefined;
  const widths = new Map<string, number>();
  for (const [glyph, charString] of parsed.charStrings) {
    const width = readCharStringWidth(charString, parsed.subroutines);
    if (width !== undefined) widths.set(glyph, width * parsed.scale);
  }
  if (widths.size === 0) return undefined;
  return { widthOfGlyph: (glyph) => widths.get(glyph) };
}

function type1Program(bytes: Uint8Array):
  | {
      scale: number;
      subroutines: Map<number, Uint8Array>;
      charStrings: Map<string, Uint8Array>;
      privateText: string;
    }
  | undefined {
  const program = unwrapType1Program(bytes);
  const marker = findBytes(program, eexecMarker);
  if (marker < 0) return undefined;
  const clear = new TextDecoder("latin1").decode(program.subarray(0, marker));
  const encrypted = eexecBytes(program, marker + eexecMarker.length);
  if (!encrypted) return undefined;
  const privateProgram = decrypt(encrypted, 55_665, 4);
  const privateText = new TextDecoder("latin1").decode(privateProgram);
  const lenIV = Number(/\/lenIV\s+(-?\d+)/.exec(privateText)?.[1] ?? 4);
  if (!Number.isInteger(lenIV) || lenIV < -1 || lenIV > 32) return undefined;
  const matrix = /\/FontMatrix\s*\[\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(clear);
  const scale = Math.abs(Number(matrix?.[1] ?? 0.001));
  if (!Number.isFinite(scale) || scale === 0 || scale > 1) return undefined;
  const subroutines = readBinaryEntries(
    privateProgram,
    privateText,
    /dup\s+(\d+)\s+(\d+)\s+(?:RD|-\|)\s/g,
    lenIV,
  );
  const charStrings = readCharStringEntries(privateProgram, privateText, lenIV);
  if (charStrings.size === 0) return undefined;
  return { scale, subroutines, charStrings, privateText };
}

function type1PrivateDict(text: string, scale: number): Record<string, number | number[]> {
  const factor = scale * 1000;
  const output: Record<string, number | number[]> = {};
  const arrays = [
    ["BlueValues", 14],
    ["OtherBlues", 10],
    ["FamilyBlues", 14],
    ["FamilyOtherBlues", 10],
    ["StemSnapH", 12],
    ["StemSnapV", 12],
  ] as const;
  for (const [name, maximumValues] of arrays) {
    const match = new RegExp(`/${name}\\s*\\[([^\\]]{0,1024})\\]`).exec(text);
    if (!match?.[1]) continue;
    const values = boundedNumbers(match[1], maximumValues);
    const scaled = values?.map((value) => value * factor);
    if (scaled?.length && scaled.every(Number.isFinite))
      output[name.charAt(0).toLowerCase() + name.slice(1)] = scaled;
  }
  const numbers = [
    "BlueScale",
    "BlueShift",
    "BlueFuzz",
    "StdHW",
    "StdVW",
    "LanguageGroup",
    "ExpansionFactor",
  ];
  for (const name of numbers) {
    const match = new RegExp(`/${name}\\s+(?:\\[\\s*)?([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`).exec(
      text,
    );
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    const scaled = /^(?:BlueScale|LanguageGroup|ExpansionFactor)$/.test(name)
      ? value
      : value * factor;
    if (Number.isFinite(scaled)) output[name.charAt(0).toLowerCase() + name.slice(1)] = scaled;
  }
  if (/\/ForceBold\s+true\b/.test(text)) output.forceBold = 1;
  return output;
}

function boundedNumbers(text: string, maximum: number): number[] | undefined {
  const values: number[] = [];
  for (const match of text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g)) {
    if (values.length === maximum) return undefined;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return undefined;
    values.push(value);
  }
  return values;
}

function readCharStringEntries(
  bytes: Uint8Array,
  text: string,
  lenIV: number,
): Map<string, Uint8Array> {
  const output = new Map<string, Uint8Array>();
  const pattern = /\/([^\s/]+)\s+(\d+)\s+(?:RD|-\|)\s/g;
  for (const match of text.matchAll(pattern)) {
    const glyph = match[1];
    const length = Number(match[2]);
    const start = match.index + match[0].length;
    if (!glyph || !Number.isSafeInteger(length) || length < 0 || start + length > bytes.length)
      continue;
    const encoded = bytes.subarray(start, start + length);
    const charString = lenIV < 0 ? encoded : decrypt(encoded, 4_330, lenIV);
    output.set(glyph, charString);
  }
  return output;
}

function readBinaryEntries(
  bytes: Uint8Array,
  text: string,
  pattern: RegExp,
  lenIV: number,
): Map<number, Uint8Array> {
  const output = new Map<number, Uint8Array>();
  for (const match of text.matchAll(pattern)) {
    const key = Number(match[1]);
    const length = Number(match[2]);
    const start = match.index + match[0].length;
    if (!Number.isSafeInteger(key) || !Number.isSafeInteger(length) || length < 0) continue;
    if (start + length > bytes.length) continue;
    const encoded = bytes.subarray(start, start + length);
    output.set(key, lenIV < 0 ? encoded : decrypt(encoded, 4_330, lenIV));
  }
  return output;
}

function readCharStringWidth(
  bytes: Uint8Array,
  subroutines: Map<number, Uint8Array>,
): number | undefined {
  return interpretCharString(bytes, subroutines, [], 0, { operations: 0 });
}

function interpretCharString(
  bytes: Uint8Array,
  subroutines: Map<number, Uint8Array>,
  stack: number[],
  depth: number,
  work: { operations: number },
): number | undefined {
  if (depth > 16) return undefined;
  for (let index = 0; index < bytes.length; ) {
    work.operations += 1;
    if (work.operations > 100_000) return undefined;
    const value = bytes[index] as number;
    index += 1;
    if (value >= 32) {
      const decoded = decodeNumber(bytes, value, index);
      if (!decoded) return undefined;
      stack.push(decoded.value);
      index = decoded.next;
      if (stack.length > 48) return undefined;
      continue;
    }
    if (value === 13) return stack.length >= 2 ? stack.at(-1) : undefined;
    if (value === 10) {
      const subroutine = subroutines.get(stack.pop() ?? -1);
      if (!subroutine) return undefined;
      const width = interpretCharString(subroutine, subroutines, stack, depth + 1, work);
      if (width !== undefined) return width;
      continue;
    }
    if (value === 11) return undefined;
    if (value === 12) {
      const escaped = bytes[index];
      index += 1;
      if (escaped === 7) return stack.length >= 4 ? stack.at(-2) : undefined;
      if (escaped === 12 && stack.length >= 2) {
        const divisor = stack.pop() as number;
        const dividend = stack.pop() as number;
        if (divisor === 0) return undefined;
        stack.push(dividend / divisor);
        continue;
      }
    }
    stack.length = 0;
  }
  return undefined;
}

function interpretGlyph(
  bytes: Uint8Array,
  subroutines: Map<number, Uint8Array>,
  scale: number,
): Omit<Type1GlyphPath, "name"> | undefined {
  const commands: Type1GlyphPath["commands"] = [];
  const stack: number[] = [];
  let x = 0;
  let y = 0;
  let width: number | undefined;
  let operations = 0;
  let inFlex = false;
  const type2Events: Type2Event[] = [];
  let activeStems = new Set<Type1Stem>();
  let initialStems: Set<Type1Stem> | undefined;
  let replacementPending = false;
  const type1Stems: Type1Stem[] = [];
  const addStems = (orientation: Type1Stem["orientation"], values: number[]) => {
    for (let index = 0; index + 1 < values.length; index += 2) {
      const stem: Type1Stem = {
        orientation,
        position: values[index] ?? 0,
        width: values[index + 1] ?? 0,
      };
      type1Stems.push(stem);
      activeStems.add(stem);
    }
  };
  const emit = (operator: number | [number, number], values: number[]) =>
    type2Events.push({ operator, values: [...values] });
  const move = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    commands.push({ type: "M", x: x * scale, y: y * scale });
  };
  const line = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    commands.push({ type: "L", x: x * scale, y: y * scale });
  };
  const curve = (values: number[], offset: number) => {
    const x1 = x + (values[offset] ?? 0);
    const y1 = y + (values[offset + 1] ?? 0);
    const x2 = x1 + (values[offset + 2] ?? 0);
    const y2 = y1 + (values[offset + 3] ?? 0);
    x = x2 + (values[offset + 4] ?? 0);
    y = y2 + (values[offset + 5] ?? 0);
    commands.push({
      type: "C",
      x1: x1 * scale,
      y1: y1 * scale,
      x2: x2 * scale,
      y2: y2 * scale,
      x: x * scale,
      y: y * scale,
    });
  };
  const run = (program: Uint8Array, depth: number): boolean => {
    if (depth > 16) return false;
    for (let index = 0; index < program.length; ) {
      operations += 1;
      if (operations > 100_000) return false;
      const operator = program[index] as number;
      index += 1;
      if (operator >= 32) {
        const decoded = decodeNumber(program, operator, index);
        if (!decoded) return false;
        stack.push(decoded.value);
        if (stack.length > 64) return false;
        index = decoded.next;
        continue;
      }
      if (operator === 10) {
        const subroutine = subroutines.get(Math.trunc(stack.pop() ?? -1));
        const activatesReplacement = replacementPending;
        if (activatesReplacement) replacementPending = false;
        if (!subroutine || !run(subroutine, depth + 1)) return false;
        if (activatesReplacement) {
          type2Events.push({ activeStems: new Set(activeStems) });
        }
        continue;
      }
      if (operator === 11) return true;
      if (operator === 12) {
        const escaped = program[index] as number;
        index += 1;
        if (escaped === 0 || escaped === 1 || escaped === 2) {
          if (escaped === 1) addStems("vertical", stack);
          if (escaped === 2) addStems("horizontal", stack);
          stack.length = 0;
          continue;
        }
        if (escaped === 7) {
          if (stack.length < 4) return false;
          const [sbx = 0, sby = 0, advance = 0] = stack;
          x = sbx;
          y = sby;
          width = advance;
          emit(21, [sbx, sby]);
          stack.length = 0;
          continue;
        }
        if (escaped === 6) {
          if (stack.length < 5) return false;
          const [asb = 0, adx = 0, ady = 0, bchar = 0, achar = 0] = stack;
          emit(14, [adx + x - asb, ady, bchar, achar]);
          stack.length = 0;
          return width !== undefined;
        }
        if (escaped === 12 && stack.length >= 2) {
          const divisor = stack.pop() as number;
          const dividend = stack.pop() as number;
          if (divisor === 0) return false;
          stack.push(dividend / divisor);
          continue;
        }
        if (escaped === 16 && stack.length >= 2) {
          const subroutine = Math.trunc(stack.pop() ?? -1);
          const argumentCount = Math.max(0, Math.trunc(stack.pop() ?? 0));
          if (subroutine === 1 && argumentCount === 0) {
            inFlex = true;
          } else if (subroutine === 0 && argumentCount === 3 && inFlex) {
            const values = stack.splice(-17, 17);
            if (values.length !== 17) return false;
            curve(
              [
                (values[2] ?? 0) + (values[0] ?? 0),
                (values[3] ?? 0) + (values[1] ?? 0),
                values[4] ?? 0,
                values[5] ?? 0,
                values[6] ?? 0,
                values[7] ?? 0,
              ],
              0,
            );
            curve(values.slice(8, 14), 0);
            emit(
              [12, 35],
              [
                (values[2] ?? 0) + (values[0] ?? 0),
                (values[3] ?? 0) + (values[1] ?? 0),
                ...values.slice(4, 15),
              ],
            );
            inFlex = false;
            stack.push(values[15] ?? 0, values[16] ?? 0);
          } else if (subroutine === 2 && argumentCount !== 0) {
            return false;
          } else if (subroutine === 3 && argumentCount === 1) {
            initialStems ??= new Set(activeStems);
            activeStems = new Set();
            replacementPending = true;
          }
          continue;
        }
        if (escaped === 17) {
          continue;
        }
        if (escaped === 33) {
          stack.length = 0;
          continue;
        }
        return false;
      }
      const values = stack.splice(0);
      switch (operator) {
        case 1:
          addStems("horizontal", values);
          break;
        case 3:
          addStems("vertical", values);
          break;
        case 4:
          if (inFlex) {
            stack.push(0, values.at(-1) ?? 0);
            break;
          }
          move(0, values.at(-1) ?? 0);
          emit(4, [values.at(-1) ?? 0]);
          break;
        case 5:
          for (let offset = 0; offset + 1 < values.length; offset += 2)
            line(values[offset] ?? 0, values[offset + 1] ?? 0);
          emit(5, values);
          break;
        case 6:
          for (const value of values) line(value, 0);
          emit(6, values);
          break;
        case 7:
          for (const value of values) line(0, value);
          emit(7, values);
          break;
        case 8:
          for (let offset = 0; offset + 5 < values.length; offset += 6) curve(values, offset);
          emit(8, values);
          break;
        case 9:
          commands.push({ type: "Z" });
          break;
        case 13:
          if (values.length < 2) return false;
          x = values[0] ?? 0;
          y = 0;
          width = values[1];
          emit(22, [values[0] ?? 0]);
          break;
        case 14:
          return width !== undefined;
        case 21:
          if (inFlex) {
            stack.push(...values);
            break;
          }
          if (values.length < 2) return false;
          move(values.at(-2) ?? 0, values.at(-1) ?? 0);
          emit(21, [values.at(-2) ?? 0, values.at(-1) ?? 0]);
          break;
        case 22:
          if (inFlex) {
            stack.push(values.at(-1) ?? 0, 0);
            break;
          }
          move(values.at(-1) ?? 0, 0);
          emit(22, [values.at(-1) ?? 0]);
          break;
        case 30:
        case 31: {
          let offset = 0;
          let verticalFirst = operator === 30;
          while (offset + 3 < values.length) {
            if (verticalFirst) {
              curve(
                [
                  0,
                  values[offset] ?? 0,
                  values[offset + 1] ?? 0,
                  values[offset + 2] ?? 0,
                  values[offset + 3] ?? 0,
                  offset + 4 === values.length - 1 ? (values[offset + 4] ?? 0) : 0,
                ],
                0,
              );
            } else {
              curve(
                [
                  values[offset] ?? 0,
                  0,
                  values[offset + 1] ?? 0,
                  values[offset + 2] ?? 0,
                  offset + 4 === values.length - 1 ? (values[offset + 4] ?? 0) : 0,
                  values[offset + 3] ?? 0,
                ],
                0,
              );
            }
            offset += offset + 4 === values.length - 1 ? 5 : 4;
            verticalFirst = !verticalFirst;
          }
          emit(operator, values);
          break;
        }
        default:
          return false;
      }
    }
    return true;
  };
  if (!run(bytes, 0) || width === undefined || type1Stems.length > 96) return undefined;
  return {
    width: width * scale,
    commands,
    type2CharString: encodeType2CharString(
      width,
      type1Stems,
      initialStems ?? new Set(type1Stems),
      type2Events,
      scale,
    ),
  };
}

function decodeNumber(
  bytes: Uint8Array,
  first: number,
  index: number,
): { value: number; next: number } | undefined {
  if (first <= 246) return { value: first - 139, next: index };
  if (first <= 250 && index < bytes.length)
    return { value: (first - 247) * 256 + (bytes[index] as number) + 108, next: index + 1 };
  if (first <= 254 && index < bytes.length)
    return { value: -(first - 251) * 256 - (bytes[index] as number) - 108, next: index + 1 };
  if (first === 255 && index + 4 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + index, 4);
    return { value: view.getInt32(0), next: index + 4 };
  }
  return undefined;
}

function eexecBytes(bytes: Uint8Array, offset: number): Uint8Array | undefined {
  while (offset < bytes.length && isSpace(bytes[offset] as number)) offset += 1;
  const sample = bytes.subarray(offset, Math.min(bytes.length, offset + 8));
  const isHex = sample.length >= 8 && [...sample].every(isHexDigit);
  if (!isHex) return bytes.subarray(offset);
  const output: number[] = [];
  let high: number | undefined;
  for (let index = offset; index < bytes.length; index += 1) {
    const byte = bytes[index] as number;
    if (isSpace(byte)) continue;
    const nibble = hexValue(byte);
    if (nibble < 0) break;
    if (high === undefined) high = nibble;
    else {
      output.push((high << 4) | nibble);
      high = undefined;
    }
  }
  return output.length > 0 ? Uint8Array.from(output) : undefined;
}

function decrypt(bytes: Uint8Array, key: number, discard: number): Uint8Array {
  const output = new Uint8Array(Math.max(0, bytes.length - discard));
  for (let index = 0; index < bytes.length; index += 1) {
    const cipher = bytes[index] as number;
    const plain = cipher ^ (key >> 8);
    key = ((cipher + key) * 52_845 + 22_719) & 0xffff;
    if (index >= discard) output[index - discard] = plain;
  }
  return output;
}

export function unwrapType1Program(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x80) return bytes;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let offset = 0; offset + 6 <= bytes.length; ) {
    if (bytes[offset] !== 0x80) break;
    const type = bytes[offset + 1];
    if (type === 3) break;
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 2, 4).getUint32(0, true);
    offset += 6;
    if ((type !== 1 && type !== 2) || size > bytes.length - offset) break;
    chunks.push(bytes.subarray(offset, offset + size));
    length += size;
    offset += size;
  }
  if (chunks.length === 0) return bytes;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function isSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isHexDigit(byte: number): boolean {
  return hexValue(byte) >= 0;
}

function hexValue(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

import { findBytes } from "./bytes.js";
import { encodeType2CharString, type Type1Stem, type Type2Event } from "./type2-charstring.js";
