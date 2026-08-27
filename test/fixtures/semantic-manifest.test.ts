import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface SemanticFixture {
  id: string;
  file: string;
  sha256: string;
  pages: number[];
  challenge: string;
  expect: {
    readingOrder: string[][];
    elements: Record<string, { min?: number; max?: number }>;
    notes: string;
  };
}

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/semantic");
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  schemaVersion: number;
  fixtures: SemanticFixture[];
};

describe("semantic fixture contracts", () => {
  it("contains ten distinct hand-authored cases", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures).toHaveLength(10);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(10);
  });

  for (const fixture of manifest.fixtures) {
    it(`${fixture.id} pins a PDF and meaningful semantic expectations`, async () => {
      const bytes = await readFile(resolve(fixtureRoot, fixture.file));
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
      expect(fixture.pages.length).toBeGreaterThan(0);
      expect(fixture.challenge).toBeTruthy();
      expect(fixture.expect.readingOrder.length).toBeGreaterThan(0);
      expect(Object.keys(fixture.expect.elements).length).toBeGreaterThan(0);
      expect(fixture.expect.notes).toBeTruthy();
    });
  }

  it("keeps the adversarial two-column pair semantically opposed", () => {
    const research = manifest.fixtures.find((fixture) => fixture.id === "research-paper");
    const invoice = manifest.fixtures.find((fixture) => fixture.id === "acme-studio-invoice");
    if (!research || !invoice) throw new Error("semantic fixture pair is missing");
    expect(research.expect.elements.table?.max).toBe(0);
    expect(invoice.expect.elements.table?.min).toBe(1);
  });
});
