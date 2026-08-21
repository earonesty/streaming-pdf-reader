import { Inflate } from "pako";
import type { PdfSource } from "../source.js";
import { type ByteStoreOptions, type ByteStoreStats, SparseByteStore } from "../store/sparse.js";
import { isWhitespace, ValueParser } from "./parser.js";
import {
  isDict,
  isName,
  isRef,
  isStream,
  type PdfDict,
  type PdfRef,
  type PdfStream,
  type PdfValue,
} from "./values.js";

interface DirectXrefEntry {
  kind: "direct";
  offset: number;
  generation: number;
}

interface CompressedXrefEntry {
  kind: "compressed";
  streamObject: number;
  index: number;
}

type XrefEntry = DirectXrefEntry | CompressedXrefEntry;

export interface ParserLimits {
  maxObjectBytes?: number;
  maxDecodedStreamBytes?: number;
  maxXrefBytes?: number;
  maxPageTreeDepth?: number;
  maxCachedObjects?: number;
  maxObjectCacheBytes?: number;
}

export interface PdfParserOptions extends ByteStoreOptions, ParserLimits {}

export interface ParsedPage {
  ref: PdfRef;
  dict: PdfDict;
  resources?: PdfDict | undefined;
  mediaBox: [number, number, number, number];
  rotate: number;
}

const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_DECODED_STREAM_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_XREF_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PAGE_TREE_DEPTH = 128;
const DEFAULT_MAX_CACHED_OBJECTS = 256;
const DEFAULT_MAX_OBJECT_CACHE_BYTES = 16 * 1024 * 1024;
const latin1 = new TextDecoder("latin1");

export class PdfObjectReader {
  readonly store: SparseByteStore;
  readonly limits: Required<ParserLimits>;
  readonly #xref = new Map<number, XrefEntry>();
  readonly #xrefSectionOffsets = new Set<number>();
  readonly #cache = new Map<number, { value: PdfValue; size: number }>();
  #objectCacheBytes = 0;
  #peakObjectCacheBytes = 0;
  #root?: PdfRef;
  #pagesRoot: PdfRef | undefined;
  #pageCount: number | undefined;

  private constructor(source: PdfSource, options: PdfParserOptions) {
    this.store = new SparseByteStore(source, options);
    this.limits = {
      maxObjectBytes: options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES,
      maxDecodedStreamBytes: options.maxDecodedStreamBytes ?? DEFAULT_MAX_DECODED_STREAM_BYTES,
      maxXrefBytes: options.maxXrefBytes ?? DEFAULT_MAX_XREF_BYTES,
      maxPageTreeDepth: options.maxPageTreeDepth ?? DEFAULT_MAX_PAGE_TREE_DEPTH,
      maxCachedObjects: options.maxCachedObjects ?? DEFAULT_MAX_CACHED_OBJECTS,
      maxObjectCacheBytes: options.maxObjectCacheBytes ?? DEFAULT_MAX_OBJECT_CACHE_BYTES,
    };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
  }

  static async open(source: PdfSource, options: PdfParserOptions = {}): Promise<PdfObjectReader> {
    const reader = new PdfObjectReader(source, options);
    await reader.#initialize();
    return reader;
  }

  get stats(): Readonly<
    ByteStoreStats & { objectCacheBytes: number; peakObjectCacheBytes: number }
  > {
    return {
      ...this.store.stats,
      objectCacheBytes: this.#objectCacheBytes,
      peakObjectCacheBytes: this.#peakObjectCacheBytes,
    };
  }

  async pageCount(): Promise<number> {
    await this.#loadPagesRoot();
    if (this.#pageCount === undefined) throw new Error("PDF page count was not initialized");
    return this.#pageCount;
  }

  async getPage(index: number): Promise<ParsedPage> {
    await this.#loadPagesRoot();
    const pageCount = this.#pageCount;
    const pagesRoot = this.#pagesRoot;
    if (pageCount === undefined || pagesRoot === undefined) {
      throw new Error("PDF page tree was not initialized");
    }
    if (!Number.isSafeInteger(index) || index < 0 || index >= pageCount) {
      throw new RangeError(`page index ${index} is outside 0..${pageCount - 1}`);
    }
    const result = await this.#findPage(pagesRoot, {}, index, 0);
    if (!result.page) throw new Error(`page tree ended before page index ${index}`);
    return result.page;
  }

  async #loadPagesRoot(): Promise<void> {
    if (this.#pagesRoot) return;
    if (!this.#root) throw new Error("PDF trailer has no /Root reference");
    const catalog = await this.resolve(this.#root);
    if (!isDict(catalog)) throw new Error("PDF catalog is not a dictionary");
    const pagesRef = catalog.get("Pages");
    if (!isRef(pagesRef)) throw new Error("PDF catalog has no /Pages reference");
    const root = await this.getObject(pagesRef.object);
    if (!isDict(root)) throw new Error("PDF /Pages root is not a dictionary");
    this.#pagesRoot = pagesRef;
    this.#pageCount = numberValue(root.get("Count"), "/Pages /Count");
  }

  async resolve(value: PdfValue): Promise<PdfValue> {
    return isRef(value) ? this.getObject(value.object) : value;
  }

  async resolveDict(value: PdfValue | undefined): Promise<PdfDict | undefined> {
    if (value === undefined) return undefined;
    const resolved = await this.resolve(value);
    if (!isDict(resolved)) throw new Error("expected PDF dictionary");
    return resolved;
  }

  async getObject(objectNumber: number): Promise<PdfValue> {
    const cached = this.#cache.get(objectNumber);
    if (cached !== undefined) {
      this.#cache.delete(objectNumber);
      this.#cache.set(objectNumber, cached);
      return cached.value;
    }
    const entry = this.#xref.get(objectNumber);
    if (!entry) throw new Error(`missing xref entry for object ${objectNumber}`);
    const value =
      entry.kind === "direct"
        ? await this.#readDirectObject(objectNumber, entry)
        : await this.#readCompressedObject(objectNumber, entry);
    const size = estimateObjectBytes(value);
    if (size <= this.limits.maxObjectCacheBytes) {
      while (
        this.#cache.size >= this.limits.maxCachedObjects ||
        this.#objectCacheBytes + size > this.limits.maxObjectCacheBytes
      ) {
        const oldest = this.#cache.keys().next().value;
        if (oldest === undefined) break;
        this.#deleteCached(oldest);
      }
      this.#cache.set(objectNumber, { value, size });
      this.#objectCacheBytes += size;
      this.#peakObjectCacheBytes = Math.max(this.#peakObjectCacheBytes, this.#objectCacheBytes);
    }
    return value;
  }

  releasePage(): void {
    this.#cache.clear();
    this.#objectCacheBytes = 0;
  }

  close(): void {
    this.#cache.clear();
    this.#objectCacheBytes = 0;
    this.#pagesRoot = undefined;
    this.#pageCount = undefined;
    this.store.clear();
  }

  #deleteCached(objectNumber: number): void {
    const cached = this.#cache.get(objectNumber);
    if (!cached) return;
    this.#cache.delete(objectNumber);
    this.#objectCacheBytes -= cached.size;
  }

  async decodeStream(stream: PdfStream): Promise<Uint8Array> {
    let bytes = stream.bytes;
    const filterValue = stream.dict.get("Filter");
    const filters = Array.isArray(filterValue)
      ? filterValue
      : filterValue === undefined
        ? []
        : [filterValue];
    for (const filter of filters) {
      if (!isName(filter)) throw new Error("unsupported indirect or malformed stream filter");
      if (filter.value === "FlateDecode" || filter.value === "Fl") {
        bytes = await inflate(bytes, this.limits.maxDecodedStreamBytes);
      } else if (filter.value === "ASCIIHexDecode" || filter.value === "AHx") {
        bytes = decodeAsciiHex(bytes, this.limits.maxDecodedStreamBytes);
      } else {
        throw new Error(`unsupported stream filter /${filter.value}`);
      }
    }
    return bytes;
  }

  async #initialize(): Promise<void> {
    const headerLength = Math.min(this.store.source.size, 1024);
    const header = latin1.decode(await this.store.read(0, headerLength));
    if (!header.includes("%PDF-")) throw new Error("input does not contain a PDF header");

    const tailLength = Math.min(this.store.source.size, this.limits.maxXrefBytes);
    const tailOffset = this.store.source.size - tailLength;
    const tail = latin1.decode(await this.store.read(tailOffset, tailLength));
    const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
    const last = matches.at(-1);
    if (!last) throw new Error("PDF has no startxref marker within the configured xref window");
    await this.#readXrefChain(Number(last[1]), new Set());
  }

  async #readXrefChain(offset: number, visited: Set<number>): Promise<void> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.store.source.size) {
      throw new Error(`invalid xref offset ${offset}`);
    }
    if (visited.has(offset)) throw new Error(`cyclic xref /Prev chain at ${offset}`);
    visited.add(offset);
    this.#xrefSectionOffsets.add(offset);
    const length = Math.min(this.limits.maxXrefBytes, this.store.source.size - offset);
    const bytes = await this.store.read(offset, length);
    const parser = new ValueParser(bytes);
    parser.skipSpace();
    const firstWord = parser.readWord();
    let trailer: PdfDict;
    if (firstWord === "xref") {
      trailer = this.#parseClassicXref(parser, offset);
    } else {
      const value = await this.#parseIndirectBytes(bytes, offset);
      if (!isStream(value) || !isName(value.dict.get("Type"), "XRef")) {
        throw new Error(`object at startxref ${offset} is not an xref stream`);
      }
      await this.#parseXrefStream(value);
      trailer = value.dict;
    }

    const root = trailer.get("Root");
    if (!this.#root && isRef(root)) this.#root = root;
    const xrefStream = trailer.get("XRefStm");
    if (typeof xrefStream === "number") await this.#readXrefChain(xrefStream, visited);
    const previous = trailer.get("Prev");
    if (typeof previous === "number") await this.#readXrefChain(previous, visited);
  }

  #parseClassicXref(parser: ValueParser, absoluteOffset: number): PdfDict {
    while (true) {
      parser.skipSpace();
      const markerOffset = parser.offset;
      const word = parser.readWord();
      if (word === "trailer") {
        const trailer = parser.parseValue();
        if (!isDict(trailer)) throw new Error("xref trailer is not a dictionary");
        return trailer;
      }
      parser.offset = markerOffset;
      const first = parser.parseNumber();
      const count = parser.parseNumber();
      if (!Number.isInteger(first) || !Number.isInteger(count) || count < 0) {
        throw new Error(`invalid xref subsection at ${absoluteOffset + markerOffset}`);
      }
      for (let index = 0; index < count; index += 1) {
        const entryOffset = parser.parseNumber();
        const generation = parser.parseNumber();
        const status = parser.readWord();
        if (status === "n" && !this.#xref.has(first + index)) {
          this.#xref.set(first + index, { kind: "direct", offset: entryOffset, generation });
        }
      }
    }
  }

  async #parseXrefStream(stream: PdfStream): Promise<void> {
    const widths = numberArray(stream.dict.get("W"), 3, "/W");
    const size = numberValue(stream.dict.get("Size"), "/Size");
    const indexes = stream.dict.has("Index")
      ? numberArray(stream.dict.get("Index"), undefined, "/Index")
      : [0, size];
    if (indexes.length % 2 !== 0) throw new Error("xref stream /Index must contain pairs");
    const bytes = await this.decodeStream(stream);
    let position = 0;
    for (let pair = 0; pair < indexes.length; pair += 2) {
      const first = indexes[pair];
      const count = indexes[pair + 1];
      if (first === undefined || count === undefined) throw new Error("invalid xref /Index");
      for (let index = 0; index < count; index += 1) {
        const fields = widths.map((width) => {
          let value = 0;
          for (let byte = 0; byte < width; byte += 1)
            value = value * 256 + (bytes[position++] ?? 0);
          return value;
        });
        const type = widths[0] === 0 ? 1 : fields[0];
        const object = first + index;
        if (type === 1 && !this.#xref.has(object)) {
          this.#xref.set(object, {
            kind: "direct",
            offset: fields[1] ?? 0,
            generation: fields[2] ?? 0,
          });
        } else if (type === 2 && !this.#xref.has(object)) {
          this.#xref.set(object, {
            kind: "compressed",
            streamObject: fields[1] ?? 0,
            index: fields[2] ?? 0,
          });
        }
      }
    }
  }

  async #readDirectObject(objectNumber: number, entry: DirectXrefEntry): Promise<PdfValue> {
    const offsets = [...this.#xref.values()]
      .filter(
        (candidate): candidate is DirectXrefEntry =>
          candidate.kind === "direct" && candidate.offset > entry.offset,
      )
      .map((candidate) => candidate.offset);
    offsets.push(...[...this.#xrefSectionOffsets].filter((offset) => offset > entry.offset));
    const next = offsets.length > 0 ? Math.min(...offsets) : this.store.source.size;
    const length = Math.min(next - entry.offset, this.limits.maxObjectBytes);
    if (length <= 0) throw new Error(`invalid byte range for object ${objectNumber}`);
    const bytes = await this.store.read(entry.offset, length);
    return this.#parseIndirectBytes(bytes, entry.offset, objectNumber);
  }

  async #parseIndirectBytes(
    bytes: Uint8Array,
    absoluteOffset: number,
    expectedObject?: number,
  ): Promise<PdfValue> {
    const parser = new ValueParser(bytes);
    const object = parser.parseNumber();
    parser.parseNumber();
    if (parser.readWord() !== "obj")
      throw new Error(`invalid indirect object at ${absoluteOffset}`);
    if (expectedObject !== undefined && object !== expectedObject) {
      throw new Error(`xref for object ${expectedObject} points to object ${object}`);
    }
    const value = parser.parseValue();
    if (!isDict(value)) return value;
    parser.skipSpace();
    const markerOffset = parser.offset;
    if (parser.readWord() !== "stream") {
      parser.offset = markerOffset;
      return value;
    }
    if (bytes[parser.offset] === 0x0d) parser.offset += 1;
    if (bytes[parser.offset] === 0x0a) parser.offset += 1;
    const declaredLength = value.get("Length");
    let length = typeof declaredLength === "number" ? declaredLength : undefined;
    if (length === undefined) {
      const remainder = latin1.decode(bytes.subarray(parser.offset));
      const end = remainder.indexOf("endstream");
      if (end < 0)
        throw new Error(`stream at ${absoluteOffset} has no resolvable /Length or endstream`);
      length = end;
      while (length > 0 && isWhitespace(bytes[parser.offset + length - 1])) length -= 1;
    }
    if (length > this.limits.maxObjectBytes || parser.offset + length > bytes.length) {
      throw new Error(`stream at ${absoluteOffset} exceeds the configured object limit`);
    }
    return {
      type: "stream",
      dict: value,
      bytes: bytes.slice(parser.offset, parser.offset + length),
    };
  }

  async #readCompressedObject(objectNumber: number, entry: CompressedXrefEntry): Promise<PdfValue> {
    const container = await this.getObject(entry.streamObject);
    if (!isStream(container) || !isName(container.dict.get("Type"), "ObjStm")) {
      throw new Error(
        `object ${objectNumber} refers to invalid object stream ${entry.streamObject}`,
      );
    }
    const decoded = await this.decodeStream(container);
    const count = numberValue(container.dict.get("N"), "/N");
    const first = numberValue(container.dict.get("First"), "/First");
    const header = new ValueParser(decoded);
    const entries: Array<{ object: number; offset: number }> = [];
    for (let index = 0; index < count; index += 1) {
      entries.push({ object: header.parseNumber(), offset: header.parseNumber() });
    }
    const target = entries[entry.index];
    if (!target || target.object !== objectNumber) {
      throw new Error(`object stream index mismatch for object ${objectNumber}`);
    }
    return new ValueParser(decoded, first + target.offset).parseValue();
  }

  async #findPage(
    ref: PdfRef,
    inherited: {
      resources?: PdfDict | undefined;
      mediaBox?: [number, number, number, number] | undefined;
      rotate?: number | undefined;
    },
    target: number,
    depth: number,
  ): Promise<{ page?: ParsedPage; skipped: number }> {
    if (depth > this.limits.maxPageTreeDepth) throw new Error("page tree exceeds configured depth");
    const value = await this.getObject(ref.object);
    if (!isDict(value)) throw new Error(`page tree object ${ref.object} is not a dictionary`);
    const resources = (await this.resolveDict(value.get("Resources"))) ?? inherited.resources;
    const mediaBox = pdfBox(value.get("MediaBox")) ?? inherited.mediaBox;
    const rotateValue = value.get("Rotate");
    const rotate = typeof rotateValue === "number" ? rotateValue : (inherited.rotate ?? 0);
    if (isName(value.get("Type"), "Page")) {
      if (!mediaBox) throw new Error(`page object ${ref.object} has no inherited /MediaBox`);
      return target === 0
        ? { page: { ref, dict: value, resources, mediaBox, rotate }, skipped: 0 }
        : { skipped: 1 };
    }
    const kids = value.get("Kids");
    if (!Array.isArray(kids)) throw new Error(`pages object ${ref.object} has no /Kids array`);
    let skipped = 0;
    for (const kid of kids) {
      if (!isRef(kid)) throw new Error(`pages object ${ref.object} has a non-reference kid`);
      const kidValue = await this.getObject(kid.object);
      if (!isDict(kidValue)) throw new Error(`page-tree kid ${kid.object} is not a dictionary`);
      const countValue = isName(kidValue.get("Type"), "Page") ? 1 : kidValue.get("Count");
      const count = typeof countValue === "number" ? countValue : 1;
      if (target >= skipped + count) {
        skipped += count;
        continue;
      }
      const result = await this.#findPage(
        kid,
        { resources, mediaBox, rotate },
        target - skipped,
        depth + 1,
      );
      if (result.page) return result;
      skipped += result.skipped;
    }
    return { skipped };
  }
}

function numberValue(value: PdfValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function numberArray(
  value: PdfValue | undefined,
  length: number | undefined,
  label: string,
): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new Error(`${label} must be a numeric array`);
  }
  if (length !== undefined && value.length !== length)
    throw new Error(`${label} must contain ${length} numbers`);
  return value as number[];
}

function pdfBox(value: PdfValue | undefined): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== "number"))
    return undefined;
  return value as [number, number, number, number];
}

async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const inflater = new Inflate({ chunkSize: Math.min(64 * 1024, limit + 1) });
  const chunks: Uint8Array[] = [];
  let size = 0;
  inflater.onData = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > limit) {
      throw new Error(`decoded stream exceeds configured limit of ${limit} bytes`);
    }
    chunks.push(bytes);
  };
  inflater.push(bytes, true);
  if (inflater.err) throw new Error(`FlateDecode failed: ${inflater.msg}`);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeAsciiHex(bytes: Uint8Array, limit: number): Uint8Array {
  let hex = latin1.decode(bytes).replace(/\s/g, "");
  const end = hex.indexOf(">");
  if (end >= 0) hex = hex.slice(0, end);
  if (hex.length % 2 === 1) hex += "0";
  if (hex.length / 2 > limit)
    throw new Error(`decoded stream exceeds configured limit of ${limit} bytes`);
  return Uint8Array.from(hex.match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

function estimateObjectBytes(value: PdfValue, seen = new Set<object>()): number {
  if (value === null || typeof value === "boolean" || typeof value === "number") return 8;
  if (typeof value === "string") return value.length * 2;
  if (typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return 16 + value.reduce<number>((total, item) => total + estimateObjectBytes(item, seen), 0);
  }
  if (value instanceof Map) {
    let total = 32;
    for (const [key, item] of value) total += key.length * 2 + estimateObjectBytes(item, seen);
    return total;
  }
  if ("type" in value && value.type === "stream") {
    return value.bytes.byteLength + estimateObjectBytes(value.dict, seen);
  }
  if ("type" in value && value.type === "string") return value.bytes.byteLength + 16;
  if ("type" in value && value.type === "name") return value.value.length * 2 + 16;
  return 24;
}
