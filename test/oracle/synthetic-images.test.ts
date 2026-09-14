import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { type Browser, chromium } from "playwright-core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeHtmlDocument } from "../../packages/html-writer/src/index.js";
import { memorySource, openPdf } from "../../src/index.js";
import { imageFixtures, syntheticImagePdf } from "../helpers/synthetic-images.js";

const executablePath =
  process.env.CHROMIUM_PATH ??
  ["/usr/bin/google-chrome", "/snap/bin/chromium", chromium.executablePath()].find(existsSync);
const artifactRoot = resolve("artifacts/synthetic-images");

// Opt in: these tests launch Chromium and emit PDFs, HTML, PNG pairs, and metrics.
// Ordinary oracle runs do not need a browser installed.
describe.skipIf(process.env.SYNTHETIC_IMAGE_ORACLE !== "1")("synthetic image visual parity", () => {
  let pdfium: PDFiumLibrary;
  let browser: Browser;
  const results: {
    id: string;
    images: number;
    changedFraction: number;
    issue: string | null;
    pdfBytes: number;
    htmlBytes: number;
  }[] = [];
  beforeAll(async () => {
    if (!executablePath) throw new Error("Set CHROMIUM_PATH to run the synthetic image oracle");
    await mkdir(artifactRoot, { recursive: true });
    pdfium = await PDFiumLibrary.init();
    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  });
  afterAll(async () => {
    await browser?.close();
    pdfium?.destroy();
    await writeFile(
      resolve(artifactRoot, "index.html"),
      `<!doctype html><meta charset="utf-8">
      <title>Synthetic image parity</title><style>body{font:16px system-ui;max-width:960px;margin:2rem auto}article{border-top:1px solid #ccc;padding:1rem 0}.pair{display:flex;gap:1rem}figure{margin:0;flex:1}img{max-width:100%;border:1px solid #ccc}</style>
      <h1>Synthetic image parity</h1><p>PDFium reference compared with HTML rendered by Chromium. Known gaps remain unfixed.</p>
      ${results.map((r) => `<article><h2>${r.id}</h2><p>${r.issue ?? "Visual parity passes"}; ${(r.changedFraction * 100).toFixed(2)}% changed pixels</p><p><a href="${r.id}.pdf">Source PDF</a> | <a href="${r.id}.html">Generated HTML</a></p><div class="pair"><figure><figcaption>PDFium</figcaption><img src="${r.id}-pdf.png"></figure><figure><figcaption>HTML / Chromium</figcaption><img src="${r.id}-html.png"></figure></div></article>`).join("")}`,
    );
    await writeFile(resolve(artifactRoot, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  });

  for (const fixture of imageFixtures) {
    it(fixture.id, async () => {
      const bytes = syntheticImagePdf(fixture);
      await writeFile(resolve(artifactRoot, `${fixture.id}.pdf`), bytes);
      const referenceDocument = await pdfium.loadDocument(bytes);
      const referencePage = referenceDocument.getPage(0);
      const reader = await openPdf(memorySource(bytes));
      const browserPage = await browser.newPage({
        deviceScaleFactor: 1.5,
        viewport: { width: 800, height: 800 },
      });
      try {
        const rendered = await referencePage.render({ scale: 2, colorSpace: "BGRA" });
        // The wrapper sets REVERSE_BYTE_ORDER: rendered bytes are already RGBA,
        // despite the BGRA bitmap name. See pdfium-color-order.test.ts; do not swap R/B.
        const reference = Buffer.from(rendered.data);
        await sharp(reference, {
          raw: { width: rendered.width, height: rendered.height, channels: 4 },
        })
          .png()
          .toFile(resolve(artifactRoot, `${fixture.id}-pdf.png`));
        const page = await reader.getPage(0);
        let html = "";
        await writeHtmlDocument(
          [page],
          (chunk) => {
            html += chunk;
          },
          { profile: "visual" },
        );
        await writeFile(resolve(artifactRoot, `${fixture.id}.html`), html);
        await browserPage.setContent(html, { waitUntil: "load" });
        await browserPage.addStyleTag({
          content: "html,body{margin:0;padding:0}.pdf-page{margin:0}",
        });
        await browserPage.evaluate(async () => {
          await Promise.all(
            Array.from(document.querySelectorAll("svg image")).map(async (image) => {
              const href = image.getAttribute("href");
              if (!href) throw new Error("Missing image source");
              const bitmap = await createImageBitmap(await (await fetch(href)).blob());
              bitmap.close();
            }),
          );
        });
        const bounds = await browserPage.locator(".pdf-page").boundingBox();
        expect((bounds?.width ?? 0) * 1.5).toBeCloseTo(rendered.width, 0);
        expect((bounds?.height ?? 0) * 1.5).toBeCloseTo(rendered.height, 0);
        // Capture at the origin and crop device pixels, avoiding fractional CSS bbox rounding.
        const png = await sharp(await browserPage.screenshot({ animations: "disabled" }))
          .extract({ left: 0, top: 0, width: rendered.width, height: rendered.height })
          .png()
          .toBuffer();
        await writeFile(resolve(artifactRoot, `${fixture.id}-html.png`), png);
        const { data: candidate, info } = await sharp(png)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([info.width, info.height]).toEqual([rendered.width, rendered.height]);
        // Ignore a two-pixel border around quadrant edges: renderers interpolate differently.
        // A >1% large-channel-error rate indicates lost content, color, or placement.
        let changed = 0;
        let compared = 0;
        for (let y = 2; y < info.height - 2; y++) {
          for (let x = 2; x < info.width - 2; x++) {
            if (Math.abs(x - info.width / 2) <= 2 || Math.abs(y - info.height / 2) <= 2) continue;
            const offset = (y * info.width + x) * 4;
            compared++;
            if (
              [0, 1, 2].some(
                (channel) =>
                  Math.abs(
                    (candidate[offset + channel] ?? 0) - (reference[offset + channel] ?? 0),
                  ) > 32,
              )
            )
              changed++;
          }
        }
        const changedFraction = changed / compared;
        const result = {
          id: fixture.id,
          images: page.images?.length ?? 0,
          changedFraction,
          issue: fixture.issue ?? null,
          pdfBytes: bytes.length,
          htmlBytes: Buffer.byteLength(html),
        };
        results.push(result);
        console.log(JSON.stringify(result));
        // Explicit known-gap baseline: fixing one requires promoting it to a passing fixture.
        // Setup/decode errors still fail; only the measured visual mismatch is expected.
        if (fixture.issue && process.env.SYNTHETIC_IMAGE_STRICT !== "1")
          expect(changedFraction, fixture.issue).toBeGreaterThan(0.01);
        else expect(changedFraction).toBeLessThan(0.01);
      } finally {
        await browserPage.close();
        reader.close();
        referenceDocument.destroy();
      }
    }, 30_000);
  }
});
