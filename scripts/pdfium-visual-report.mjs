import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { pageToHtml } from "../packages/html-writer/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "corpus/manifest.json"), "utf8"));
const artifactRoot = resolve(root, "artifacts/pdfium-visual");
const baselinePath = resolve(root, "corpus/pdfium-visual-baseline.json");
const limit = numberArgument("--limit", manifest.fixtures.length);
const requestedIds = stringArgument("--fixtures")?.split(",").filter(Boolean);
const fixtures = selectFixtures(requestedIds, limit);
const writeBaseline = process.argv.includes("--write-baseline");
const gate = process.argv.includes("--gate");
const scale = 2;
const maximumFuzzyChangedFraction = 0.0055;

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

const pdfium = await PDFiumLibrary.init();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/snap/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-lcd-text"],
});
const chromiumVersion = browser.version();
const context = await browser.newContext({
  deviceScaleFactor: 1.5,
  viewport: { width: 1600, height: 1800 },
});

const results = [];
try {
  for (const [index, fixture] of fixtures.entries()) {
    const result = await compareFixture(fixture);
    results.push(result);
    console.log(
      `${String(index + 1).padStart(2)}/${fixtures.length} ${result.status.padEnd(14)} ${fixture.id} changed=${percent(result.strictChangedFraction)} fuzzy=${percent(result.fuzzyChangedFraction)} mae=${result.meanAbsoluteError.toFixed(2)}`,
    );
  }
} finally {
  await context.close();
  await browser.close();
  pdfium.destroy();
}

const summary = {
  generatedAt: new Date().toISOString(),
  fixtureCount: results.length,
  exact: results.filter((result) => result.status === "PASS_EXACT").length,
  tolerant: results.filter((result) => result.status === "PASS_TOLERANCE").length,
  failed: results.filter((result) => result.status === "FAIL_VISUAL").length,
  chromiumVersion,
  thresholds: {
    channelDelta: 12,
    fuzzyRadius: 1,
    maximumFuzzyChangedFraction,
    minimumInkRatio: 0.78,
    maximumInkRatio: 1.25,
  },
};
await writeFile(
  resolve(artifactRoot, "report.json"),
  `${JSON.stringify({ summary, results }, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));

const passingFixtureIds = results
  .filter((result) => result.status !== "FAIL_VISUAL")
  .map((result) => result.id)
  .sort();
if (writeBaseline) {
  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fixtureCount: summary.fixtureCount,
        passed: passingFixtureIds.length,
        passingFixtureIds,
        thresholds: summary.thresholds,
      },
      null,
      2,
    )}\n`,
  );
}
if (gate) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const passingIds = new Set(passingFixtureIds);
  const regressions = baseline.passingFixtureIds.filter((id) => !passingIds.has(id));
  if (passingFixtureIds.length < baseline.passed || regressions.length > 0) {
    throw new Error(
      `PDFium visual regression: ${passingFixtureIds.length}/${summary.fixtureCount} pass; baseline ${baseline.passed}/${baseline.fixtureCount}; regressed fixtures: ${regressions.join(", ") || "none"}`,
    );
  }
}

async function compareFixture(fixture) {
  const pdfPath = resolve(root, ".cache/pdfjs-corpus", fixture.file);
  const pdfBytes = await readFile(pdfPath);
  const referenceDocument = await pdfium.loadDocument(pdfBytes);
  let source;
  let reader;
  try {
    const pageIndex = Math.max(0, (fixture.firstPage ?? 1) - 1);
    const referencePage = referenceDocument.getPage(pageIndex);
    const rendered = await referencePage.render({ scale, colorSpace: "BGRA" });
    // @hyzyla/pdfium renders with PDFium's REVERSE_BYTE_ORDER flag, so its raw
    // four-channel bitmap is already RGBA despite the allocation format name.
    const reference = Buffer.from(rendered.data);
    const referencePng = await sharp(reference, {
      raw: { width: rendered.width, height: rendered.height, channels: 4 },
    })
      .png()
      .toBuffer();

    source = await fileSource(pdfPath);
    reader = await openPdf(source, {
      chunkSize: 16 * 1024,
      maxBytes: 2 * 1024 * 1024,
      maxObjectCacheBytes: 2 * 1024 * 1024,
      maxDecodedStreamBytes: 16 * 1024 * 1024,
    });
    const extracted = await reader.getPage(pageIndex);
    const fragment = await pageToHtml(extracted, { profile: "visual" });
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}.pdf-page{box-sizing:border-box;margin:0;background:#fff;color:#000}.pdf-page--positioned{position:relative;overflow:hidden}.pdf-page-content{position:absolute;transform-origin:0 0}.pdf-page-content--90{transform:translateX(100%) rotate(90deg)}.pdf-page-content--180{transform:translate(100%,100%) rotate(180deg)}.pdf-page-content--270{transform:translateY(100%) rotate(270deg)}.pdf-span{position:absolute;white-space:pre;transform-origin:left bottom;unicode-bidi:isolate}.pdf-span[data-direction=ttb]{writing-mode:vertical-rl}</style>${fragment}`;
    const browserPage = await context.newPage();
    let candidatePng;
    try {
      await browserPage.setContent(html, { waitUntil: "load" });
      await browserPage.evaluate(() => document.fonts.ready);
      candidatePng = await browserPage.locator(".pdf-page").screenshot({ animations: "disabled" });
    } finally {
      await browserPage.close();
    }
    const candidateImage = sharp(candidatePng).ensureAlpha();
    const metadata = await candidateImage.metadata();
    let candidate = await candidateImage.raw().toBuffer();
    if (metadata.width !== rendered.width || metadata.height !== rendered.height) {
      candidate = await sharp(candidatePng)
        .extract({
          left: 0,
          top: 0,
          width: Math.min(metadata.width, rendered.width),
          height: Math.min(metadata.height, rendered.height),
        })
        .extend({
          right: Math.max(0, rendered.width - metadata.width),
          bottom: Math.max(0, rendered.height - metadata.height),
          background: "white",
        })
        .ensureAlpha()
        .raw()
        .toBuffer();
    }

    const metrics = comparePixels(reference, candidate, rendered.width, rendered.height);
    const inkRatio =
      metrics.referenceInkPixels === 0
        ? metrics.candidateInkPixels === 0
          ? 1
          : null
        : metrics.candidateInkPixels / metrics.referenceInkPixels;
    const inkWithinTolerance = inkRatio !== null && inkRatio >= 0.78 && inkRatio <= 1.25;
    const status = metrics.exact
      ? "PASS_EXACT"
      : metrics.fuzzyChangedFraction <= maximumFuzzyChangedFraction && inkWithinTolerance
        ? "PASS_TOLERANCE"
        : "FAIL_VISUAL";
    const fixtureDirectory = resolve(artifactRoot, fixture.id);
    await mkdir(fixtureDirectory, { recursive: true });
    await Promise.all([
      writeFile(resolve(fixtureDirectory, "reference.png"), referencePng),
      writeFile(resolve(fixtureDirectory, "candidate.png"), candidatePng),
      writeFile(
        resolve(fixtureDirectory, "diff.png"),
        await sharp(metrics.diff, {
          raw: { width: rendered.width, height: rendered.height, channels: 4 },
        })
          .png()
          .toBuffer(),
      ),
    ]);
    return {
      id: fixture.id,
      page: pageIndex + 1,
      status,
      referenceSize: [rendered.width, rendered.height],
      candidateSize: [metadata.width, metadata.height],
      resizedForComparison:
        metadata.width !== rendered.width || metadata.height !== rendered.height,
      strictChangedFraction: metrics.strictChangedFraction,
      fuzzyChangedFraction: metrics.fuzzyChangedFraction,
      meanAbsoluteError: metrics.meanAbsoluteError,
      referenceInkPixels: metrics.referenceInkPixels,
      candidateInkPixels: metrics.candidateInkPixels,
      inkRatio,
    };
  } finally {
    referenceDocument.destroy();
    reader?.close();
    await source?.close();
  }
}

function comparePixels(reference, candidate, width, height) {
  const pixelCount = width * height;
  const diff = Buffer.alloc(pixelCount * 4);
  let exact = true;
  let strictChanged = 0;
  let fuzzyChanged = 0;
  let absoluteError = 0;
  let referenceInkPixels = 0;
  let candidateInkPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let maximumDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(reference[offset + channel] - candidate[offset + channel]);
      absoluteError += delta;
      maximumDelta = Math.max(maximumDelta, delta);
    }
    if (maximumDelta !== 0) exact = false;
    if (maximumDelta > 12) strictChanged += 1;
    if (isInk(reference, offset)) referenceInkPixels += 1;
    if (isInk(candidate, offset)) candidateInkPixels += 1;
    const fuzzyDelta = neighborhoodDelta(reference, candidate, pixel, width, height);
    if (fuzzyDelta > 12) fuzzyChanged += 1;
    const intensity = Math.min(255, maximumDelta * 4);
    diff[offset] = intensity;
    diff[offset + 1] = maximumDelta > 12 ? 0 : intensity;
    diff[offset + 2] = 0;
    diff[offset + 3] = 255;
  }
  return {
    exact,
    diff,
    strictChangedFraction: strictChanged / pixelCount,
    fuzzyChangedFraction: fuzzyChanged / pixelCount,
    meanAbsoluteError: absoluteError / (pixelCount * 3),
    referenceInkPixels,
    candidateInkPixels,
  };
}

function isInk(pixels, offset) {
  return pixels[offset] < 240 || pixels[offset + 1] < 240 || pixels[offset + 2] < 240;
}

function neighborhoodDelta(reference, candidate, pixel, width, height) {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  let best = 255;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nearX = x + dx;
      const nearY = y + dy;
      if (nearX < 0 || nearX >= width || nearY < 0 || nearY >= height) continue;
      const leftOffset = pixel * 4;
      const rightOffset = (nearY * width + nearX) * 4;
      let delta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        delta = Math.max(
          delta,
          Math.abs(reference[leftOffset + channel] - candidate[rightOffset + channel]),
        );
      }
      best = Math.min(best, delta);
    }
  }
  return best;
}

function selectFixtures(ids, maximum) {
  const textFixtures = manifest.fixtures.filter((fixture) => fixture.mode === "text");
  if (ids) {
    const byId = new Map(textFixtures.map((fixture) => [fixture.id, fixture]));
    return ids.map((id) => {
      const fixture = byId.get(id);
      if (!fixture) throw new Error(`unknown text fixture: ${id}`);
      return fixture;
    });
  }
  return textFixtures.slice(0, maximum);
}

function stringArgument(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArgument(name, fallback) {
  const value = Number(stringArgument(name) ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}
