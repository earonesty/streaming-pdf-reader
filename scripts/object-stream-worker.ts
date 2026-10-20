import { openPdf } from "../src/index.js";

/** Local smoke worker: range reads stay in a host service binding, never a public URL. */
export default {
  async fetch(request: Request, env: { RANGES: { fetch(url: string): Promise<Response> } }) {
    const input = (await request.json()) as { size: number; pages: number[] };
    const started = Date.now();
    const pdf = await openPdf(
      {
        size: input.size,
        async read(offset, length) {
          const response = await env.RANGES.fetch(
            `http://range/?offset=${offset}&length=${length}`,
          );
          if (!response.ok) throw new Error(`range service HTTP ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        },
      },
      {
        maxObjectBytes: 16 * 1024 * 1024,
        maxBytes: 8 * 1024 * 1024,
        maxObjectCacheBytes: 8 * 1024 * 1024,
        maxXrefCacheBytes: 8 * 1024 * 1024,
      },
    );
    try {
      const count = await pdf.getPageCount();
      const pages = [];
      for (const number of input.pages) {
        const page = await pdf.getPage(number - 1);
        const text = page.spans.map((span) => span.text).join("\n");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        pages.push({
          number,
          spans: page.spans.length,
          textSha256: Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
        });
        pdf.releasePage();
      }
      return Response.json({ count, pages, wallMs: Date.now() - started, reader: pdf.stats });
    } finally {
      pdf.close();
    }
  },
};
