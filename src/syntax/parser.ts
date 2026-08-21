import type { PdfArray, PdfDict, PdfName, PdfRef, PdfString, PdfValue } from "./values.js";

const decoder = new TextDecoder("latin1");

export class ValueParser {
  readonly bytes: Uint8Array;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.offset = offset;
  }

  parseValue(): PdfValue {
    this.skipSpace();
    const byte = this.bytes[this.offset];
    if (byte === 0x2f) return this.parseName();
    if (byte === 0x28) return this.parseLiteralString();
    if (byte === 0x3c && this.bytes[this.offset + 1] === 0x3c) return this.parseDict();
    if (byte === 0x3c) return this.parseHexString();
    if (byte === 0x5b) return this.parseArray();
    if (isNumberStart(byte)) return this.parseNumberOrRef();

    const word = this.readWord();
    if (word === "null") return null;
    if (word === "true") return true;
    if (word === "false") return false;
    if (!word) throw new Error(`expected PDF value at byte ${this.offset}`);
    return word;
  }

  skipSpace(): void {
    while (this.offset < this.bytes.length) {
      const byte = this.bytes[this.offset];
      if (byte === 0x25) {
        while (this.offset < this.bytes.length && !isLineEnd(this.bytes[this.offset]))
          this.offset += 1;
      } else if (isWhitespace(byte)) {
        this.offset += 1;
      } else {
        break;
      }
    }
  }

  readWord(): string {
    this.skipSpace();
    const start = this.offset;
    while (this.offset < this.bytes.length && !isDelimiter(this.bytes[this.offset]))
      this.offset += 1;
    return decoder.decode(this.bytes.subarray(start, this.offset));
  }

  parseNumber(): number {
    const word = this.readWord();
    const value = Number(word);
    if (!Number.isFinite(value)) throw new Error(`invalid PDF number ${word}`);
    return value;
  }

  private parseNumberOrRef(): number | PdfRef {
    const first = this.parseNumber();
    const afterFirst = this.offset;
    this.skipSpace();
    if (!Number.isInteger(first) || !isNumberStart(this.bytes[this.offset])) {
      this.offset = afterFirst;
      return first;
    }
    const second = this.parseNumber();
    this.skipSpace();
    if (Number.isInteger(second) && this.readWord() === "R") {
      return { type: "ref", object: first, generation: second };
    }
    this.offset = afterFirst;
    return first;
  }

  private parseName(): PdfName {
    this.offset += 1;
    const start = this.offset;
    while (this.offset < this.bytes.length && !isDelimiter(this.bytes[this.offset]))
      this.offset += 1;
    const raw = decoder.decode(this.bytes.subarray(start, this.offset));
    return {
      type: "name",
      value: raw.replace(/#([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
    };
  }

  private parseLiteralString(): PdfString {
    this.offset += 1;
    const output: number[] = [];
    let depth = 1;
    while (this.offset < this.bytes.length && depth > 0) {
      let byte = this.bytes[this.offset++];
      if (byte === undefined) break;
      if (byte === 0x5c) {
        byte = this.bytes[this.offset++];
        if (byte === undefined) throw new Error("unterminated PDF string escape");
        if (byte === 0x0d && this.bytes[this.offset] === 0x0a) this.offset += 1;
        if (byte === 0x0d || byte === 0x0a) continue;
        const escapes: Record<number, number> = {
          110: 0x0a,
          114: 0x0d,
          116: 0x09,
          98: 0x08,
          102: 0x0c,
        };
        const escaped = escapes[byte];
        if (escaped !== undefined) {
          output.push(escaped);
        } else if (byte >= 0x30 && byte <= 0x37) {
          let octal = String.fromCharCode(byte);
          for (let count = 1; count < 3; count += 1) {
            const next = this.bytes[this.offset];
            if (next === undefined || next < 0x30 || next > 0x37) break;
            octal += String.fromCharCode(next);
            this.offset += 1;
          }
          output.push(Number.parseInt(octal, 8) & 0xff);
        } else {
          output.push(byte);
        }
      } else if (byte === 0x28) {
        depth += 1;
        output.push(byte);
      } else if (byte === 0x29) {
        depth -= 1;
        if (depth > 0) output.push(byte);
      } else {
        output.push(byte);
      }
    }
    if (depth !== 0) throw new Error("unterminated PDF literal string");
    return { type: "string", bytes: Uint8Array.from(output) };
  }

  private parseHexString(): PdfString {
    this.offset += 1;
    let hex = "";
    while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0x3e) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) break;
      if (!isWhitespace(byte)) hex += String.fromCharCode(byte);
    }
    if (this.bytes[this.offset] !== 0x3e) throw new Error("unterminated PDF hex string");
    this.offset += 1;
    if (hex.length % 2 === 1) hex += "0";
    return {
      type: "string",
      bytes: Uint8Array.from(hex.match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? []),
    };
  }

  private parseArray(): PdfArray {
    this.offset += 1;
    const values: PdfArray = [];
    while (true) {
      this.skipSpace();
      if (this.bytes[this.offset] === 0x5d) {
        this.offset += 1;
        return values;
      }
      values.push(this.parseValue());
    }
  }

  private parseDict(): PdfDict {
    this.offset += 2;
    const dict: PdfDict = new Map();
    while (true) {
      this.skipSpace();
      if (this.bytes[this.offset] === 0x3e && this.bytes[this.offset + 1] === 0x3e) {
        this.offset += 2;
        return dict;
      }
      const key = this.parseName();
      dict.set(key.value, this.parseValue());
    }
  }
}

export function isWhitespace(byte: number | undefined): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isLineEnd(byte: number | undefined): boolean {
  return byte === 10 || byte === 13;
}

function isNumberStart(byte: number | undefined): boolean {
  return (
    byte === 0x2b ||
    byte === 0x2d ||
    byte === 0x2e ||
    (byte !== undefined && byte >= 0x30 && byte <= 0x39)
  );
}

function isDelimiter(byte: number | undefined): boolean {
  return (
    byte === undefined ||
    isWhitespace(byte) ||
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}
