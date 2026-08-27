import { fileURLToPath } from "node:url";
import { openPdf } from "@boxpdf/reader";
import { fileSource } from "@boxpdf/reader/node";
import { describe, expect, it } from "vitest";
import { type SemanticDocumentStats, writeHtmlDocument } from "../src/index.js";

describe("semantic document flow", () => {
  it("renders labeled invoice metadata as sections and preserves wrapped values", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../../../fixtures/semantic/acme-studio-invoice.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let html = "";
    try {
      await writeHtmlDocument(
        pdf.pages(),
        (chunk) => {
          html += chunk;
        },
        { profile: "semantic" },
      );
    } finally {
      pdf.close();
      await source.close();
    }

    expect(html).toContain("<section><h2>Status</h2><p>Paid</p></section>");
    expect(html).toContain(
      "<section><h2>Notes</h2><p>Two fraction column should be wider and wrap later than the first column.</p></section>",
    );
  });

  it("uses typography and spacing to structure résumé records and unmarked lists", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../../../fixtures/semantic/resume.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let html = "";
    try {
      await writeHtmlDocument(
        pdf.pages(),
        (chunk) => {
          html += chunk;
        },
        { profile: "semantic" },
      );
    } finally {
      pdf.close();
      await source.close();
    }

    expect(html).toContain("<address>San Francisco, CA avery.chen@example.com");
    expect(html).toContain(
      "<h3>University of California, Berkeley</h3><p>B.A. Computer Science</p>",
    );
    expect(html).toContain(
      "<ul><li>TypeScript, Rust, Go</li><li>Cloudflare Workers, AWS Lambda, Kubernetes</li>",
    );
  });

  it("renders product cards, address sections, and totals from the order fixture", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../../../fixtures/semantic/order-confirmation.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let html = "";
    try {
      await writeHtmlDocument(
        pdf.pages(),
        (chunk) => {
          html += chunk;
        },
        { profile: "semantic" },
      );
    } finally {
      pdf.close();
      await source.close();
    }

    expect(html).toContain(
      "<header><h1>Thanks for your order, Sam.</h1><p>Order OW-2026-018723 · placed May 14, 2026</p><p>Track your shipment · Support</p></header>",
    );
    expect(html).toContain(
      '<section><h2>Items ordered</h2><table><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Amount</th></tr></thead>',
    );
    expect(html).toContain(
      '<tr><th scope="row">Field jacket<br><span>Olive · M</span></th><td>1</td><td>$198.00</td></tr>',
    );
    expect(html).toContain(
      "<section><h2>Ship to</h2><address><strong>Sam Reyes</strong><br>482 Page Street, Apt 2B",
    );
    expect(html).toContain("<section><h2>Billed to</h2><p><strong>Sam Reyes</strong></p>");
    expect(html).toContain("<section><dl>");
    expect(html).toContain(
      "<footer><p>Most orders arrive in 3–5 business days. You&#39;ll get a tracking email",
    );
    expect(html).toContain("<dt>Subtotal</dt><dd>$408.00</dd>");
    expect(html).toContain("<dt>Total</dt><dd>$457.70</dd>");
  });

  it("keeps nested document sections open across page boundaries", async () => {
    async function* pages() {
      yield semanticPage(1, [
        ["Avery Chen", 24],
        ["Summary", 16],
        ["An experienced systems engineer.", 12],
      ]);
      yield semanticPage(2, [
        ["Experience", 16],
        ["Built streaming document systems.", 12],
      ]);
    }

    let html = "";
    await writeHtmlDocument(
      pages(),
      (chunk) => {
        html += chunk;
      },
      { profile: "semantic", semanticLookaheadPages: 2 },
    );

    expect(html).toContain(
      '<header><h1>Avery Chen</h1></header><section data-level="2"><h2>Summary</h2><p>An experienced systems engineer.</p></section><section data-level="2"><h2>Experience</h2><p>Built streaming document systems.</p></section>',
    );
  });

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

    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain(
      "<header><h1>INVOICE</h1><h2>#2026-001872</h2><p>Issued: May 14, 2026 Bill to: Onward Travel, LLC.</p></header>",
    );
    expect(html.match(/Service line item #/g)).toHaveLength(80);
    expect(html).toContain("<th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th>");
    expect(html).toContain("Subtotal");
    expect(html).toContain(
      '<tfoot><tr><th scope="row" colspan="3">Subtotal</th><td>$21,000.00</td></tr>',
    );
    expect(html).not.toContain("<dl>");
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

  it("keeps receipt totals with the purchased items", async () => {
    const source = await fileSource(
      fileURLToPath(new URL("../../../fixtures/semantic/receipt.pdf", import.meta.url)),
    );
    const pdf = await openPdf(source);
    let html = "";
    try {
      await writeHtmlDocument(
        pdf.pages(),
        (chunk) => {
          html += chunk;
        },
        { profile: "semantic" },
      );
    } finally {
      pdf.close();
      await source.close();
    }

    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain(
      "<header><h1>Acme Supply Co.</h1><p>Receipt · Order #18472 · May 14, 2026</p></header>",
    );
    expect(html).toContain("<tfoot>");
    expect(html).toContain('<th scope="row" colspan="2">Subtotal</th>');
    expect(html).toContain('<th scope="row" colspan="2">Total</th>');
    expect(html).not.toContain("<dl>");
    expect(html).toContain("<footer><p>Thanks for your business.</p></footer>");
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

function semanticPage(number: number, rows: Array<[text: string, fontSize: number]>) {
  return {
    number,
    width: 612,
    height: 792,
    rotate: 0 as const,
    spans: rows.map(([text, fontSize], index) => ({
      text,
      bounds: { x: 40, y: 700 - index * 40, width: 300, height: fontSize },
      direction: "ltr" as const,
      fontSize,
      source: { page: number },
    })),
  };
}
