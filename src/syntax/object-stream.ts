import { Inflate } from "pako";
import { PdfError } from "../errors.js";
import { ValueParser } from "./parser.js";
import { isDict, isName, type PdfStream, type PdfValue } from "./values.js";

const CHUNK = 64 * 1024;
interface Consumer<T> {
  push(bytes: Uint8Array, offset: number): void;
  finish(size: number): T;
}
export interface ObjectStreamMetrics {
  decodedBytes: number;
  peakBufferBytes: number;
}

/** Retain one target interval; replay only for a final entry or unsorted header. */
export function extractObjectStream(
  stream: PdfStream,
  object: number,
  index: number,
  limits: { maxObjectBytes: number; maxObjectStreamDecodedBytes: number },
  metrics: ObjectStreamMetrics,
  budget = { decodedBytes: 0 },
): PdfValue | undefined {
  const filter = stream.dict.get("Filter");
  const filters = Array.isArray(filter) ? filter : filter === undefined ? [] : [filter];
  const rawParameters = stream.dict.get("DecodeParms") ?? stream.dict.get("DP");
  const parameters = Array.isArray(rawParameters) ? rawParameters[0] : rawParameters;
  const flate =
    filters.length === 1 && (isName(filters[0], "FlateDecode") || isName(filters[0], "Fl"));
  if (filters.length && !flate) return undefined;
  if (parameters != null && (!isDict(parameters) || (parameters.get("Predictor") ?? 1) !== 1))
    return undefined;
  const count = integer(stream.dict.get("N"), "/N");
  const first = integer(stream.dict.get("First"), "/First");
  if (first > limits.maxObjectStreamDecodedBytes)
    resource("object stream header exceeds configured aggregate decoded traversal limit");
  if (count > Math.floor((first + 1) / 4)) invalid("invalid object stream header size");
  integer(index, "xref object stream index");
  const decode = <T>(factory: () => Consumer<T>): T =>
    traverse(stream.bytes, flate, limits.maxObjectStreamDecodedBytes, factory, metrics, budget);
  const selected = decode(() => {
    type Candidate = { offset: number; end?: number };
    let indexed: Candidate | undefined;
    let fallback: Candidate | undefined;
    let previous = -1;
    let maximum = -1;
    let sorted = true;
    let target: Uint8Array | undefined;
    let targetStart = 0;
    let copied = 0;
    const header = new HeaderScanner(count, first, (number, offset, position) => {
      if (offset < previous) sorted = false;
      previous = offset;
      maximum = Math.max(maximum, offset);
      if (indexed && offset > indexed.offset) indexed.end = Math.min(indexed.end ?? offset, offset);
      if (fallback && offset > fallback.offset)
        fallback.end = Math.min(fallback.end ?? offset, offset);
      if (number === object) {
        fallback ??= { offset };
        if (position === index) indexed = { offset };
      }
    });
    return {
      push(bytes, offset) {
        header.push(bytes);
        if (offset + bytes.length <= first) return;
        header.finish();
        const candidate = indexed ?? fallback;
        // Sorted headers reveal the next boundary before body output starts.
        // Unsorted headers and the final object use the validated replay below.
        if (!sorted || !candidate || candidate.end === undefined) return;
        if (!target) {
          const length = candidate.end - candidate.offset;
          if (length > limits.maxObjectBytes)
            resource("object stream target exceeds configured object limit");
          target = new Uint8Array(length);
          targetStart = first + candidate.offset;
        }
        metrics.peakBufferBytes = Math.max(metrics.peakBufferBytes, target.length + bytes.length);
        const from = Math.max(targetStart, offset);
        const to = Math.min(targetStart + target.length, offset + bytes.length);
        if (to > from) {
          target.set(bytes.subarray(from - offset, to - offset), from - targetStart);
          copied += to - from;
        }
      },
      finish(size) {
        header.finish();
        const candidate = indexed ?? fallback;
        if (!candidate) invalid(`object stream index mismatch for object ${object}`);
        if (first + maximum >= size) invalid("object stream offset outside decoded body");
        if (target && copied !== target.length) invalid("incomplete object stream target");
        return { start: first + candidate.offset, size, bytes: target };
      },
    };
  });
  if (selected.bytes) return new ValueParser(selected.bytes).parseValue();
  const bytes = decode(() => {
    let end = selected.size;
    let target: Uint8Array | undefined;
    let copied = 0;
    const header = new HeaderScanner(count, first, (_number, offset) => {
      const position = first + offset;
      if (position >= selected.size) invalid("object stream offset outside decoded body");
      if (position > selected.start) end = Math.min(end, position);
    });
    return {
      push(bytes, offset) {
        header.push(bytes);
        if (offset + bytes.length <= first) return;
        header.finish();
        if (!target) {
          const length = end - selected.start;
          if (length > limits.maxObjectBytes)
            resource("object stream target exceeds configured object limit");
          target = new Uint8Array(length);
        }
        metrics.peakBufferBytes = Math.max(metrics.peakBufferBytes, target.length + bytes.length);
        const from = Math.max(selected.start, offset);
        const to = Math.min(end, offset + bytes.length);
        if (to > from) {
          target.set(bytes.subarray(from - offset, to - offset), from - selected.start);
          copied += to - from;
        }
      },
      finish(size) {
        if (size !== selected.size || !target || copied !== target.length)
          invalid("incomplete object stream target");
        return target;
      },
    };
  });
  return new ValueParser(bytes).parseValue();
}

class HeaderScanner {
  #position = 0;
  #pairs = 0;
  #number = 0;
  #digits = 0;
  #positive = false;
  #object: number | undefined;
  #comment = false;
  constructor(
    readonly count: number,
    readonly first: number,
    readonly pair: (object: number, offset: number, index: number) => void,
  ) {}
  push(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length && this.#position < this.first; i++, this.#position++) {
      const byte = bytes[i] ?? 0;
      if (this.#comment) {
        if (byte === 10 || byte === 13) this.#comment = false;
        continue;
      }
      if (byte === 43) {
        if (this.#digits || this.#positive || this.#pairs >= this.count)
          invalid("invalid object stream integer");
        this.#positive = true;
      } else if (byte >= 48 && byte <= 57) {
        if (this.#pairs >= this.count || ++this.#digits > 16)
          invalid("invalid object stream integer");
        this.#number = this.#number * 10 + byte - 48;
        if (!Number.isSafeInteger(this.#number)) invalid("unsafe object stream integer");
      } else if (
        byte === 0 ||
        byte === 9 ||
        byte === 10 ||
        byte === 12 ||
        byte === 13 ||
        byte === 32 ||
        byte === 37
      ) {
        this.#token();
        this.#comment = byte === 37;
      } else invalid("invalid object stream header token");
    }
  }
  #token(): void {
    if (!this.#digits) {
      if (this.#positive) invalid("invalid object stream integer");
      return;
    }
    if (this.#object === undefined) this.#object = this.#number;
    else {
      this.pair(this.#object, this.#number, this.#pairs++);
      this.#object = undefined;
    }
    this.#number = 0;
    this.#digits = 0;
    this.#positive = false;
  }
  finish(): void {
    if (this.#position !== this.first) invalid("truncated object stream header");
    this.#token();
    if (this.#object !== undefined || this.#pairs !== this.count || this.#comment)
      invalid("incomplete object stream header");
  }
}

function traverse<T>(
  bytes: Uint8Array,
  flate: boolean,
  limit: number,
  factory: () => Consumer<T>,
  metrics: ObjectStreamMetrics,
  budget: { decodedBytes: number },
): T {
  let failure: unknown;
  const header = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  const zlib = bytes.length > 1 && (bytes[0] ?? 0) % 16 === 8 && header % 31 === 0;
  // A recognized zlib wrapper must pass its checksum; raw fallback would bypass it.
  const attempts =
    flate && !zlib
      ? [
          { bytes, raw: false },
          { bytes, raw: true },
        ]
      : [{ bytes, raw: false }];
  for (const attempt of attempts) {
    const consumer = factory();
    let size = 0;
    const emit = (chunk: Uint8Array) => {
      budget.decodedBytes += chunk.length;
      metrics.decodedBytes += chunk.length;
      if (budget.decodedBytes > limit)
        resource("object stream exceeds configured aggregate decoded traversal limit");
      metrics.peakBufferBytes = Math.max(metrics.peakBufferBytes, chunk.length);
      consumer.push(chunk, size);
      size += chunk.length;
    };
    try {
      if (flate) {
        const inflater = new Inflate({ chunkSize: CHUNK, raw: attempt.raw }) as Inflate & {
          ended: boolean;
        };
        inflater.onData = (chunk) =>
          emit(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        for (let i = 0; i < attempt.bytes.length && !inflater.ended; i += CHUNK)
          inflater.push(attempt.bytes.subarray(i, i + CHUNK), i + CHUNK >= attempt.bytes.length);
        if (inflater.err || !inflater.ended)
          throw new Error(inflater.msg || "truncated FlateDecode stream");
      } else for (let i = 0; i < bytes.length; i += CHUNK) emit(bytes.subarray(i, i + CHUNK));
      return consumer.finish(size);
    } catch (error) {
      if (error instanceof PdfError) throw error;
      failure = error;
    }
  }
  invalid(`FlateDecode failed: ${failure instanceof Error ? failure.message : String(failure)}`);
}
function integer(value: PdfValue | undefined, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid(`invalid ${name}`);
  return value;
}
function invalid(message: string): never {
  throw new PdfError("INVALID_PDF", message);
}
function resource(message: string): never {
  throw new PdfError("RESOURCE_LIMIT", message);
}
