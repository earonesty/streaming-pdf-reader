import { fileURLToPath } from "node:url";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";
import { describe, expect, it } from "vitest";
import { type SemanticDocumentStats, writeHtmlDocument } from "../src/index.js";

describe("semantic document flow", () => {
  it("merges the multipage invoice table and removes repeated page furniture", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../../../fixtures/semantic/multipage-invoice.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let html = "";
    let stats: SemanticDocumentStats | undefined;
    try {
      await writeHtmlDocument(
        pdf.pages(),
        (chunk) => {
          html += chunk;
        },
        {
          profile: "semantic",
          semanticLookaheadPages: 3,
          onSemanticStats: (value) => {
            stats = value;
          },
        },
      );
    } finally {
      pdf.close();
      await source.close();
    }

    expect(html.match(/<table>/g)).toHaveLength(2);
    expect(html.match(/Service line item #/g)).toHaveLength(80);
    expect(html).toContain("<th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th>");
    expect(html).toContain("Subtotal");
    expect(html).not.toContain("Page 1 of 3");
    expect(html).not.toContain("Page 2 of 3");
    expect(html).not.toContain("Page 3 of 3");
    expect(html.match(/>INVOICE</g)).toHaveLength(1);
    expect(stats).toMatchObject({
      pagesProcessed: 3,
      peakBufferedPages: 3,
      mergedTables: 2,
    });
  });

  it("keeps a thousand-page semantic conversion inside the configured window", async () => {
    async function* pages() {
      for (let number = 1; number <= 1_000; number += 1) {
        yield {
          number,
          width: 612,
          height: 792,
          rotate: 0 as const,
          spans: [
            {
              text: `Content ${number}`,
              bounds: { x: 40, y: 400, width: 80, height: 12 },
              direction: "ltr" as const,
              fontSize: 12,
              source: { page: number },
            },
          ],
        };
      }
    }

    let stats: SemanticDocumentStats | undefined;
    let chunks = 0;
    await writeHtmlDocument(
      pages(),
      () => {
        chunks += 1;
      },
      {
        profile: "semantic",
        semanticLookaheadPages: 4,
        onSemanticStats: (value) => {
          stats = value;
        },
      },
    );

    expect(chunks).toBeGreaterThan(1_000);
    expect(stats).toMatchObject({
      pagesProcessed: 1_000,
      peakBufferedPages: 4,
      peakBufferedLines: 4,
    });
  });
});
