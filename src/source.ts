/** Random-access input used by the parser. Implementations must not read ahead implicitly. */
export interface PdfSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

function validateRange(size: number, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`offset must be a non-negative safe integer; received ${offset}`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`length must be a non-negative safe integer; received ${length}`);
  }
  if (offset > size || length > size - offset) {
    throw new RangeError(
      `requested range [${offset}, ${offset + length}) exceeds source size ${size}`,
    );
  }
}

export function memorySource(bytes: Uint8Array): PdfSource {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      validateRange(bytes.byteLength, offset, length);
      return bytes.slice(offset, offset + length);
    },
  };
}

export function blobSource(blob: Blob): PdfSource {
  return {
    size: blob.size,
    async read(offset, length) {
      validateRange(blob.size, offset, length);
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
  };
}
