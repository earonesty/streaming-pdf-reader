import { extractPageGraphics } from "./content/graphics.js";
import { extractPageText } from "./content/text.js";
import { normalizePdfError } from "./errors.js";
import type { PdfSource } from "./source.js";
import { PdfObjectReader, type PdfParserOptions } from "./syntax/document.js";
import type { EmbeddedFont, ExtractedPage } from "./types.js";

export interface OpenPdfOptions extends PdfParserOptions {}

export interface ReaderStats {
  sourceBytesRead: number;
  sourceReadCount: number;
  cacheHits: number;
  cacheMisses: number;
  residentBytes: number;
  peakResidentBytes: number;
  largestSourceRead: number;
  objectCacheBytes: number;
  peakObjectCacheBytes: number;
  xrefEntries: number;
  xrefResidentBytes: number;
}

export class StreamingPdfReader {
  readonly #objects: PdfObjectReader;

  private constructor(objects: PdfObjectReader) {
    this.#objects = objects;
  }

  static async open(source: PdfSource, options: OpenPdfOptions = {}): Promise<StreamingPdfReader> {
    return new StreamingPdfReader(await PdfObjectReader.open(source, options));
  }

  get stats(): Readonly<ReaderStats> {
    return this.#objects.stats;
  }

  async getPageCount(): Promise<number> {
    try {
      return await this.#objects.pageCount();
    } catch (error) {
      throw normalizePdfError(error);
    }
  }

  async getPage(index: number): Promise<ExtractedPage> {
    try {
      const page = await this.#objects.getPage(index);
      const [x1, y1, x2, y2] = page.mediaBox;
      const fonts: EmbeddedFont[] = [];
      const spans = await extractPageText(this.#objects, page, fonts);
      const { fills, paths } = await extractPageGraphics(this.#objects, page);
      for (const span of spans) span.source.page = index + 1;
      return {
        number: index + 1,
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        rotate: normalizeRotation(page.rotate),
        spans,
        ...(fonts.length > 0 ? { fonts } : {}),
        ...(fills.length > 0 ? { fills } : {}),
        ...(paths.length > 0 ? { paths } : {}),
      };
    } catch (error) {
      throw normalizePdfError(error);
    }
  }

  async *pages(): AsyncGenerator<ExtractedPage> {
    const count = await this.getPageCount();
    for (let index = 0; index < count; index += 1) {
      yield await this.getPage(index);
      this.releasePage();
    }
  }

  releasePage(): void {
    this.#objects.releasePage();
  }

  close(): void {
    this.#objects.close();
  }
}

export async function openPdf(
  source: PdfSource,
  options: OpenPdfOptions = {},
): Promise<StreamingPdfReader> {
  return StreamingPdfReader.open(source, options);
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270)
    return normalized;
  return 0;
}
