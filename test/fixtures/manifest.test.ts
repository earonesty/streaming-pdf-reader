import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Fixture {
  path: string;
  source: string;
  sha256: string;
  license: string;
  covers: string[];
}

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(await readFile(resolve(root, "fixtures/manifest.json"), "utf8")) as {
  schemaVersion: number;
  fixtures: Fixture[];
};

describe("fixture corpus", () => {
  for (const fixture of manifest.fixtures) {
    it(`${fixture.path} has the pinned contents and provenance`, async () => {
      const bytes = await readFile(resolve(root, "fixtures", fixture.path));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
      expect(fixture.source).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
      expect(fixture.license).toBeTruthy();
      expect(fixture.covers.length).toBeGreaterThan(0);
    });
  }
});
