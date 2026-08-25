import { PdfError } from "../errors.js";

export interface DirectXrefEntry {
  kind: "direct";
  offset: number;
  generation: number;
}

export interface CompressedXrefEntry {
  kind: "compressed";
  streamObject: number;
  index: number;
}

export type XrefEntry = DirectXrefEntry | CompressedXrefEntry;

const CHUNK_SIZE = 1024;
const BYTES_PER_CHUNK = CHUNK_SIZE * (1 + 8 + 4);

interface XrefChunk {
  types: Uint8Array;
  primary: Float64Array;
  secondary: Uint32Array;
}

/** A sparse, packed xref index without one JavaScript object allocation per PDF object. */
export class XrefIndex {
  readonly #chunks = new Map<number, XrefChunk>();
  readonly #maxBytes: number;
  #size = 0;

  constructor(maxBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < BYTES_PER_CHUNK) {
      throw new RangeError(`maxXrefCacheBytes must be at least ${BYTES_PER_CHUNK}`);
    }
    this.#maxBytes = maxBytes;
  }

  get size(): number {
    return this.#size;
  }

  get residentBytes(): number {
    return this.#chunks.size * BYTES_PER_CHUNK;
  }

  has(object: number): boolean {
    const slot = this.#slot(object);
    return slot !== undefined && slot.chunk.types[this.#slotIndex(object)] !== 0;
  }

  get(object: number): XrefEntry | undefined {
    const slot = this.#slot(object);
    if (!slot) return undefined;
    const index = this.#slotIndex(object);
    const type = slot.chunk.types[index];
    if (type === 1) {
      return {
        kind: "direct",
        offset: slot.chunk.primary[index] ?? 0,
        generation: slot.chunk.secondary[index] ?? 0,
      };
    }
    if (type === 2) {
      return {
        kind: "compressed",
        streamObject: slot.chunk.primary[index] ?? 0,
        index: slot.chunk.secondary[index] ?? 0,
      };
    }
    return undefined;
  }

  set(object: number, entry: XrefEntry): void {
    if (!Number.isSafeInteger(object) || object < 0)
      throw new RangeError("invalid xref object number");
    const chunkNumber = Math.floor(object / CHUNK_SIZE);
    let chunk = this.#chunks.get(chunkNumber);
    if (!chunk) {
      if (this.residentBytes + BYTES_PER_CHUNK > this.#maxBytes) {
        throw new PdfError(
          "RESOURCE_LIMIT",
          `xref index exceeds configured ${this.#maxBytes}-byte cache limit`,
        );
      }
      chunk = {
        types: new Uint8Array(CHUNK_SIZE),
        primary: new Float64Array(CHUNK_SIZE),
        secondary: new Uint32Array(CHUNK_SIZE),
      };
      this.#chunks.set(chunkNumber, chunk);
    }
    const index = this.#slotIndex(object);
    if (chunk.types[index] === 0) this.#size += 1;
    chunk.types[index] = entry.kind === "direct" ? 1 : 2;
    chunk.primary[index] = entry.kind === "direct" ? entry.offset : entry.streamObject;
    chunk.secondary[index] = entry.kind === "direct" ? entry.generation : entry.index;
  }

  *values(): IterableIterator<XrefEntry> {
    for (const chunk of this.#chunks.values()) {
      for (let index = 0; index < CHUNK_SIZE; index += 1) {
        const type = chunk.types[index];
        if (type === 1) {
          yield {
            kind: "direct",
            offset: chunk.primary[index] ?? 0,
            generation: chunk.secondary[index] ?? 0,
          };
        } else if (type === 2) {
          yield {
            kind: "compressed",
            streamObject: chunk.primary[index] ?? 0,
            index: chunk.secondary[index] ?? 0,
          };
        }
      }
    }
  }

  clear(): void {
    this.#chunks.clear();
    this.#size = 0;
  }

  #slot(object: number): { chunk: XrefChunk } | undefined {
    const chunk = this.#chunks.get(Math.floor(object / CHUNK_SIZE));
    return chunk ? { chunk } : undefined;
  }

  #slotIndex(object: number): number {
    return object % CHUNK_SIZE;
  }
}
