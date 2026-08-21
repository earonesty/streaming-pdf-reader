import type { PdfSource } from "../source.js";

export interface ByteStoreOptions {
  chunkSize?: number;
  maxBytes?: number;
}

export interface ByteStoreStats {
  sourceBytesRead: number;
  sourceReadCount: number;
  cacheHits: number;
  cacheMisses: number;
  residentBytes: number;
  peakResidentBytes: number;
  largestSourceRead: number;
}

interface Chunk {
  bytes: Uint8Array;
  usedAt: number;
}

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export class SparseByteStore {
  readonly source: PdfSource;
  readonly chunkSize: number;
  readonly maxBytes: number;

  readonly #chunks = new Map<number, Chunk>();
  readonly #pending = new Map<number, Promise<Uint8Array>>();
  #clock = 0;
  #stats: ByteStoreStats = {
    sourceBytesRead: 0,
    sourceReadCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    residentBytes: 0,
    peakResidentBytes: 0,
    largestSourceRead: 0,
  };

  constructor(source: PdfSource, options: ByteStoreOptions = {}) {
    this.source = source;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(this.chunkSize) || this.chunkSize <= 0) {
      throw new RangeError("chunkSize must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < this.chunkSize) {
      throw new RangeError("maxBytes must be a safe integer at least as large as chunkSize");
    }
  }

  get stats(): Readonly<ByteStoreStats> {
    return { ...this.#stats };
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    validateRange(this.source.size, offset, length);
    if (length === 0) return new Uint8Array();

    const result = new Uint8Array(length);
    const first = Math.floor(offset / this.chunkSize);
    const last = Math.floor((offset + length - 1) / this.chunkSize);
    let written = 0;

    for (let index = first; index <= last; index += 1) {
      const chunk = await this.#getChunk(index);
      const chunkStart = index * this.chunkSize;
      const from = Math.max(offset, chunkStart) - chunkStart;
      const to = Math.min(offset + length, chunkStart + chunk.byteLength) - chunkStart;
      result.set(chunk.subarray(from, to), written);
      written += to - from;
    }
    return result;
  }

  clear(): void {
    this.#chunks.clear();
    this.#stats.residentBytes = 0;
  }

  async #getChunk(index: number): Promise<Uint8Array> {
    const cached = this.#chunks.get(index);
    if (cached) {
      cached.usedAt = ++this.#clock;
      this.#stats.cacheHits += 1;
      return cached.bytes;
    }

    this.#stats.cacheMisses += 1;
    const existing = this.#pending.get(index);
    if (existing) return existing;

    const pending = this.#loadChunk(index);
    this.#pending.set(index, pending);
    try {
      return await pending;
    } finally {
      this.#pending.delete(index);
    }
  }

  async #loadChunk(index: number): Promise<Uint8Array> {
    const offset = index * this.chunkSize;
    const length = Math.min(this.chunkSize, this.source.size - offset);
    const bytes = await this.source.read(offset, length);
    if (bytes.byteLength !== length) {
      throw new Error(
        `source returned ${bytes.byteLength} bytes for a ${length}-byte read at ${offset}`,
      );
    }

    this.#stats.sourceBytesRead += length;
    this.#stats.sourceReadCount += 1;
    this.#stats.largestSourceRead = Math.max(this.#stats.largestSourceRead, length);
    this.#evictFor(length, index);
    this.#chunks.set(index, { bytes, usedAt: ++this.#clock });
    this.#stats.residentBytes += length;
    this.#stats.peakResidentBytes = Math.max(
      this.#stats.peakResidentBytes,
      this.#stats.residentBytes,
    );
    return bytes;
  }

  #evictFor(incomingBytes: number, protectedIndex: number): void {
    while (this.#stats.residentBytes + incomingBytes > this.maxBytes) {
      let oldestIndex: number | undefined;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [index, chunk] of this.#chunks) {
        if (index !== protectedIndex && chunk.usedAt < oldestUse) {
          oldestIndex = index;
          oldestUse = chunk.usedAt;
        }
      }
      if (oldestIndex === undefined) return;
      const removed = this.#chunks.get(oldestIndex);
      this.#chunks.delete(oldestIndex);
      this.#stats.residentBytes -= removed?.bytes.byteLength ?? 0;
    }
  }
}

function validateRange(size: number, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new RangeError("offset and length must be non-negative safe integers");
  }
  if (offset > size || length > size - offset) {
    throw new RangeError(
      `requested range [${offset}, ${offset + length}) exceeds source size ${size}`,
    );
  }
}
