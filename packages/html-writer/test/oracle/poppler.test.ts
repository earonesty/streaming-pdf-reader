import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeHtmlDocument } from "../../src/index.js";

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../../..");
let temporaryDirectory = "";

beforeAll(async () => {
  try {
    await run("pdftohtml", ["-v"]);
  } catch (error) {
    throw new Error("Poppler pdftohtml is required for the HTML oracle tests", { cause: error });
  }
  temporaryDirectory = await mkdtemp(join(tmpdir(), "boxpdf-poppler-"));
});

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true });
});

describe("Poppler positioned HTML oracle", () => {
  it.each(["fixtures/qpdf/minimal.pdf", "fixtures/pdfjs/rotation.pdf"])(
    "matches page geometry and normalized text for %s",
    async (fixture) => {
      const pdfPath = resolve(repository, fixture);
      const source = await fileSource(pdfPath);
      const reader = await openPdf(source, { maxBytes: 64 * 1024 });
      const chunks: string[] = [];
      try {
        await writeHtmlDocument(
          reader.pages(),
          (chunk) => {
            chunks.push(chunk);
          },
          { includeDocument: false },
        );
      } finally {
        reader.close();
        await source.close();
      }

      const oraclePath = join(temporaryDirectory, `${fixture.replaceAll("/", "-")}.html`);
      await run("pdftohtml", [
        "-q",
        "-c",
        "-hidden",
        "-noframes",
        "-zoom",
        "1",
        pdfPath,
        oraclePath,
      ]);
      const actual = parseWriterHtml(chunks.join(""));
      const expected = parsePopplerHtml(await readFile(oraclePath, "utf8"));
      expect(actual.pages).toEqual(expected.pages);
      expect(normalize(actual.text)).toBe(normalize(expected.text));
      if (fixture.endsWith("minimal.pdf")) {
        expect(actual.firstLeft).toBeCloseTo(expected.firstLeft ?? 0, 0);
        expect(Math.abs((actual.firstTop ?? 0) - (expected.firstTop ?? 0))).toBeLessThan(10);
      }
    },
  );
});

interface HtmlSummary {
  pages: Array<{ width: number; height: number }>;
  text: string;
  firstLeft?: number;
  firstTop?: number;
}

function parseWriterHtml(html: string): HtmlSummary {
  const pages = [
    ...html.matchAll(/pdf-page--positioned[^>]+width:([\d.]+)pt;height:([\d.]+)pt/g),
  ].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  const spans = [
    ...html.matchAll(
      /<span[^>]+left:([\d.]+)pt;bottom:([\d.]+)pt;width:[\d.]+pt;height:([\d.]+)pt[^>]*>([\s\S]*?)<\/span>/g,
    ),
  ];
  const firstPage = pages[0];
  const firstSpan = spans[0];
  return {
    pages,
    text: spans.map((match) => decodeEntities(stripTags(match[4] ?? ""))).join(""),
    ...(firstSpan ? { firstLeft: Number(firstSpan[1]) } : {}),
    ...(firstSpan && firstPage
      ? { firstTop: firstPage.height - Number(firstSpan[2]) - Number(firstSpan[3]) }
      : {}),
  };
}

function parsePopplerHtml(html: string): HtmlSummary {
  const pages = [...html.matchAll(/id="page\d+-div"[^>]+width:([\d.]+)px;height:([\d.]+)px/g)].map(
    (match) => ({ width: Number(match[1]), height: Number(match[2]) }),
  );
  const paragraphs = [
    ...html.matchAll(/<p[^>]+top:([\d.]+)px;left:([\d.]+)px[^>]*>([\s\S]*?)<\/p>/g),
  ];
  const first = paragraphs[0];
  return {
    pages,
    text: paragraphs.map((match) => decodeEntities(stripTags(match[3] ?? ""))).join(""),
    ...(first ? { firstLeft: Number(first[2]), firstTop: Number(first[1]) } : {}),
  };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function normalize(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "");
}
