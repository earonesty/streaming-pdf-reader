import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPdf } from "../../src/index.js";
import { fileSource } from "../../src/node.js";

describe("fileSource", () => {
  it("reads bounded ranges from a file without materializing it", async () => {
    const source = await fileSource(
      resolve(import.meta.dirname, "../../fixtures/qpdf/minimal.pdf"),
    );
    try {
      expect(new TextDecoder().decode(await source.read(0, 8))).toBe("%PDF-1.3");
      await expect(source.read(source.size, 1)).rejects.toThrow(RangeError);
      const reader = await openPdf(source, { chunkSize: 128, maxBytes: 512 });
      const page = await reader.getPage(0);
      expect(page.spans.map((span) => span.text).join("")).toBe("Potato");
      expect(reader.stats.largestSourceRead).toBeLessThanOrEqual(128);
      reader.close();
    } finally {
      await source.close();
    }
  });
});
