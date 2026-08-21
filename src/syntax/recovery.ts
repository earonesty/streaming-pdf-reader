import { ValueParser } from "./parser.js";
import { isDict, isRef, type PdfRef } from "./values.js";

const latin1 = new TextDecoder("latin1");

export interface RecoveredStructure {
  objects: Map<number, { offset: number; generation: number }>;
  root?: PdfRef | undefined;
}

/**
 * Recover top-level indirect-object offsets from a caller-bounded byte window.
 * Requiring an object header at a line boundary avoids most stream-content false positives.
 */
export function scanPdfStructure(bytes: Uint8Array, absoluteOffset: number): RecoveredStructure {
  const text = latin1.decode(bytes);
  const objects = new Map<number, { offset: number; generation: number }>();
  for (const match of text.matchAll(/(?:^|[\r\n])[ \t]*(\d+)[ \t]+(\d+)[ \t]+obj\b/g)) {
    const object = Number(match[1]);
    const generation = Number(match[2]);
    const header = match[0].search(/\d/);
    if (Number.isSafeInteger(object) && Number.isSafeInteger(generation) && header >= 0) {
      objects.set(object, { offset: absoluteOffset + (match.index ?? 0) + header, generation });
    }
  }
  return { objects, root: findTrailerRoot(bytes) };
}

export function findStartXref(bytes: Uint8Array): number | undefined {
  const matches = [...latin1.decode(bytes).matchAll(/startxref\s+(\d+)/g)];
  const value = Number(matches.at(-1)?.[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function findTrailerRoot(bytes: Uint8Array): PdfRef | undefined {
  const text = latin1.decode(bytes);
  const trailerOffset = text.lastIndexOf("trailer");
  if (trailerOffset >= 0) {
    try {
      const parser = new ValueParser(bytes, trailerOffset + "trailer".length);
      const trailer = parser.parseValue();
      const root = isDict(trailer) ? trailer.get("Root") : undefined;
      if (isRef(root)) return root;
    } catch {
      // Some recoverable PDFs omit the trailer dictionary delimiters.
    }
    const rootMatch = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(text.slice(trailerOffset));
    if (rootMatch) {
      return { type: "ref", object: Number(rootMatch[1]), generation: Number(rootMatch[2]) };
    }
  }
  const xrefStreamRoots = [...text.matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R/g)];
  const root = xrefStreamRoots.at(-1);
  return root ? { type: "ref", object: Number(root[1]), generation: Number(root[2]) } : undefined;
}
