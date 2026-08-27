import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "parse5";
import { describe, expect, it } from "vitest";

interface OracleFixture {
  id: string;
  pdf: string;
  html: string;
}

const oracleRoot = resolve(import.meta.dirname, "../../fixtures/semantic/ideal");
const manifest = JSON.parse(await readFile(resolve(oracleRoot, "manifest.json"), "utf8")) as {
  schemaVersion: number;
  method: string;
  fixtures: OracleFixture[];
};

describe("ideal semantic HTML oracles", () => {
  it("covers exactly ten independently authored PDFs", async () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.method).toContain("no extractor output");
    expect(manifest.fixtures).toHaveLength(10);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(10);

    const htmlFiles = (await readdir(oracleRoot)).filter((file) => file.endsWith(".html")).sort();
    expect(htmlFiles).toEqual(manifest.fixtures.map((fixture) => fixture.html).sort());
  });

  for (const fixture of manifest.fixtures) {
    it(`${fixture.id} is a complete, parseable semantic target`, async () => {
      const [pdf, html] = await Promise.all([
        readFile(resolve(oracleRoot, fixture.pdf)),
        readFile(resolve(oracleRoot, fixture.html), "utf8"),
      ]);
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
      expect(html.trim().length).toBeGreaterThan(200);

      const parseErrors: string[] = [];
      parse(html, { onParseError: (error) => parseErrors.push(error.code) });
      expect(parseErrors.filter((error) => error !== "missing-doctype")).toEqual([]);
      expect(html.match(/<h1\b/gi)).toHaveLength(1);
      expect(html).toMatch(/<(?:article|main)\b/i);
      expect(html).not.toMatch(/<img\b(?![^>]*\bsrc=)[^>]*>/i);

      for (const figure of html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)) {
        expect(figure[2]).toMatch(/<figcaption\b/i);
        expect(`${figure[1]}${figure[2]}`).toMatch(
          /(?:<img\b[^>]*\bsrc=|<svg\b|<table\b|data-visual-required="true")/i,
        );
      }
    });
  }

  it("captures structures that the old assertion gate missed", async () => {
    const research = await readFile(resolve(oracleRoot, "research-paper.html"), "utf8");
    const researchWords = research
      .replace(/<[^>]+>/g, " ")
      .trim()
      .split(/\s+/);
    expect(researchWords.length).toBeGreaterThan(12_000);
    expect(research).toMatch(/<header\b[\s\S]*aria-label="Authors"/i);
    expect(research).toMatch(/<pre\b[\s\S]*<code\b/i);
    expect(research.match(/<figure\b/gi)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(research).toMatch(/<figcaption\b[^>]*>[\s\S]*Sample program/i);
    expect(research).toMatch(/<figure\b[^>]*>[\s\S]*<table\b[\s\S]*Figure 13[\s\S]*<\/figure>/i);
    expect(research).not.toMatch(/(?:&gt;|&lt;|[?@#$%]){8,}/);
  });
});
