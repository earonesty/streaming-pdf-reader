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
  #directCount = 0;
  #sortedDirectOffsets: Float64Array | undefined;

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
    return this.#chunks.size * BYTES_PER_CHUNK + this.#directCount * Float64Array.BYTES_PER_ELEMENT;
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
    const index = this.#slotIndex(object);
    const previousType = chunk?.types[index] ?? 0;
    const directDelta = (entry.kind === "direct" ? 1 : 0) - (previousType === 1 ? 1 : 0);
    const additionalChunkBytes = chunk ? 0 : BYTES_PER_CHUNK;
    if (
      this.residentBytes + additionalChunkBytes + directDelta * Float64Array.BYTES_PER_ELEMENT >
      this.#maxBytes
    ) {
      throw new PdfError(
        "RESOURCE_LIMIT",
        `xref index exceeds configured ${this.#maxBytes}-byte cache limit`,
      );
    }
    if (!chunk) {
      chunk = {
        types: new Uint8Array(CHUNK_SIZE),
        primary: new Float64Array(CHUNK_SIZE),
        secondary: new Uint32Array(CHUNK_SIZE),
      };
      this.#chunks.set(chunkNumber, chunk);
    }
    if (chunk.types[index] === 0) this.#size += 1;
    this.#directCount += directDelta;
    this.#sortedDirectOffsets = undefined;
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

  nextDirectOffset(offset: number): number | undefined {
    if (!this.#sortedDirectOffsets) this.#sortedDirectOffsets = this.#buildDirectOffsets();
    const offsets = this.#sortedDirectOffsets;
    let low = 0;
    let high = offsets.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if ((offsets[middle] ?? 0) <= offset) low = middle + 1;
      else high = middle;
    }
    return offsets[low];
  }

  clear(): void {
    this.#chunks.clear();
    this.#size = 0;
    this.#directCount = 0;
    this.#sortedDirectOffsets = undefined;
  }

  #slot(object: number): { chunk: XrefChunk } | undefined {
    const chunk = this.#chunks.get(Math.floor(object / CHUNK_SIZE));
    return chunk ? { chunk } : undefined;
  }

  #slotIndex(object: number): number {
    return object % CHUNK_SIZE;
  }

  #buildDirectOffsets(): Float64Array {
    const offsets = new Float64Array(this.#directCount);
    let output = 0;
    for (const entry of this.values()) {
      if (entry.kind === "direct") offsets[output++] = entry.offset;
    }
    offsets.sort();
    return offsets;
  }
}
