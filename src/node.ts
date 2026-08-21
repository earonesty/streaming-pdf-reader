import { type FileHandle, open } from "node:fs/promises";
import type { PdfSource } from "./source.js";

export class FilePdfSource implements PdfSource {
  readonly size: number;
  readonly #handle: FileHandle;

  private constructor(handle: FileHandle, size: number) {
    this.#handle = handle;
    this.size = size;
  }

  static async open(path: string): Promise<FilePdfSource> {
    const handle = await open(path, "r");
    try {
      const stats = await handle.stat();
      if (!Number.isSafeInteger(stats.size))
        throw new Error("PDF file size exceeds safe integer range");
      return new FilePdfSource(handle, stats.size);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset > this.size ||
      length > this.size - offset
    ) {
      throw new RangeError(
        `invalid file byte range [${offset}, ${offset + length}) for size ${this.size}`,
      );
    }
    const bytes = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await this.#handle.read(
        bytes,
        filled,
        length - filled,
        offset + filled,
      );
      if (bytesRead === 0) throw new Error(`unexpected EOF at byte ${offset + filled}`);
      filled += bytesRead;
    }
    return bytes;
  }

  async close(): Promise<void> {
    await this.#handle.close();
  }
}

export function fileSource(path: string): Promise<FilePdfSource> {
  return FilePdfSource.open(path);
}
