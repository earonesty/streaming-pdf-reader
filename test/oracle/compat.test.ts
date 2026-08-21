import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { memorySource, openPdf } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const fixtures = [
  "qpdf/minimal.pdf",
  "qpdf/minimal-linearized.pdf",
  "qpdf/object-stream.pdf",
  "pdfjs/basicapi.pdf",
  "pdfjs/rotation.pdf",
  "pdfjs/structure-simple.pdf",
  "pdfjs/unicode-cidfont.pdf",
];

interface OracleTextItem {
  str: string;
  transform: number[];
}

describe("PDF.js compatibility quality gate", () => {
  for (const fixture of fixtures) {
    it(`${fixture} matches normalized text and page geometry`, async () => {
      const bytes = new Uint8Array(await readFile(resolve(root, "fixtures", fixture)));
      const actualReader = await openPdf(memorySource(bytes), {
        chunkSize: 4 * 1024,
        maxBytes: 32 * 1024,
      });
      const oracle = await getDocument({ data: bytes.slice() }).promise;

      try {
        expect(await actualReader.getPageCount()).toBe(oracle.numPages);
        for (let index = 0; index < oracle.numPages; index += 1) {
          const [actual, oraclePage] = await Promise.all([
            actualReader.getPage(index),
            oracle.getPage(index + 1),
          ]);
          const oracleText = await oraclePage.getTextContent();
          const oracleItems = oracleText.items.filter(
            (item): item is typeof item & OracleTextItem => "str" in item,
          );

          expect(actual.width).toBeCloseTo(
            (oraclePage.view[2] ?? 0) - (oraclePage.view[0] ?? 0),
            5,
          );
          expect(actual.height).toBeCloseTo(
            (oraclePage.view[3] ?? 0) - (oraclePage.view[1] ?? 0),
            5,
          );
          expect(actual.rotate).toBe(oraclePage.rotate);
          expect(normalizeCharacters(actual.spans.map((span) => span.text).join(""))).toBe(
            normalizeCharacters(oracleItems.map((item) => item.str).join("")),
          );

          const actualFirst = actual.spans.find((span) => span.text.trim());
          const oracleFirst = oracleItems.find((item) => item.str.trim());
          if (actual.rotate === 0 && actualFirst && oracleFirst) {
            expect(actualFirst.bounds.x).toBeCloseTo(oracleFirst.transform[4] ?? 0, 1);
            expect(actualFirst.bounds.y).toBeCloseTo(oracleFirst.transform[5] ?? 0, 1);
          }
          actualReader.releasePage();
        }
      } finally {
        actualReader.close();
        await oracle.destroy();
      }
    });
  }
});

function normalizeCharacters(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "");
}
