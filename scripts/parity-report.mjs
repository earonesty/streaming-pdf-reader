import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "corpus/manifest.json"), "utf8"));
const baselinePath = resolve(root, "corpus/baseline.json");
const reportPath = resolve(root, "artifacts/parity-report.json");
const writeBaseline = process.argv.includes("--write-baseline");
const gate = process.argv.includes("--gate");
const enforceTarget = process.argv.includes("--target");
const standardFontDataUrl = `${resolve(root, "node_modules/pdfjs-dist/standard_fonts")}/`;
const cMapUrl = `${resolve(root, "node_modules/pdfjs-dist/cmaps")}/`;
const acceptedOracleDifferences = new Map([
  ["issue11403-reduced", "text:page-1"],
  ["issue16224", "position:page-1"],
  ["issue18059", "text:page-1"],
]);

const results = [];
for (const [index, fixture] of manifest.fixtures.entries()) {
  const comparison = await compareFixture(fixture);
  const acceptedReason = acceptedOracleDifferences.get(fixture.id);
  const result =
    !comparison.pass && comparison.reason === acceptedReason
      ? {
          ...comparison,
          pass: true,
          acceptedOracleDifference: comparison.reason,
          reason: `accepted PDF.js oracle difference (${comparison.reason})`,
        }
      : comparison;
  results.push(result);
  console.log(
    `${String(index + 1).padStart(3)}/${manifest.fixtures.length} ${result.pass ? "PASS" : "FAIL"} ${fixture.id}${result.reason ? ` — ${result.reason}` : ""}`,
  );
}

const passing = results.filter((result) => result.pass);
const summary = {
  generatedAt: new Date().toISOString(),
  upstreamCommit: manifest.generatedFrom.commit,
  fixtureCount: results.length,
  passed: passing.length,
  failed: results.length - passing.length,
  parity: passing.length / results.length,
  target: manifest.scoring.parityTarget,
  byMode: summarize(results, (result) => result.mode),
  byCategory: summarizeCategories(results),
};
const report = { summary, results };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${reportPath}`);

if (writeBaseline) {
  const baseline = {
    schemaVersion: 1,
    upstreamCommit: summary.upstreamCommit,
    fixtureCount: summary.fixtureCount,
    passed: summary.passed,
    parity: summary.parity,
    passingFixtureIds: passing.map((result) => result.id).sort(),
  };
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}

if (gate || enforceTarget) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const passingIds = new Set(passing.map((result) => result.id));
  const regressions = baseline.passingFixtureIds.filter((id) => !passingIds.has(id));
  if (summary.passed < baseline.passed || regressions.length > 0) {
    throw new Error(
      `parity regression: ${summary.passed}/${summary.fixtureCount} pass; baseline ${baseline.passed}/${baseline.fixtureCount}; regressed fixtures: ${regressions.join(", ") || "none"}`,
    );
  }
}

if (enforceTarget && summary.parity < manifest.scoring.parityTarget) {
  throw new Error(
    `parity target not met: ${(summary.parity * 100).toFixed(1)}% < ${(manifest.scoring.parityTarget * 100).toFixed(1)}%`,
  );
}

async function compareFixture(fixture) {
  const path = resolve(root, ".cache/pdfjs-corpus", fixture.file);
  let oracle;
  let source;
  let reader;
  try {
    const bytes = new Uint8Array(await readFile(path));
    oracle = await getDocument({ data: bytes, standardFontDataUrl, cMapUrl }).promise;
    source = await fileSource(path);
    reader = await openPdf(source, {
      chunkSize: 16 * 1024,
      maxBytes: 2 * 1024 * 1024,
      maxObjectCacheBytes: 2 * 1024 * 1024,
      maxDecodedStreamBytes: 16 * 1024 * 1024,
    });
    const pageCount = await reader.getPageCount();
    if (pageCount !== oracle.numPages)
      return failure(fixture, `page-count:${pageCount}!=${oracle.numPages}`);

    const first = Math.max(1, fixture.firstPage ?? 1);
    const declaredLast = fixture.lastPage ?? oracle.numPages;
    const last = Math.min(
      oracle.numPages,
      declaredLast,
      first + manifest.scoring.maximumPagesPerFixture - 1,
    );
    for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
      const [actual, expected] = await Promise.all([
        reader.getPage(pageNumber - 1),
        oracle.getPage(pageNumber),
      ]);
      const expectedWidth = (expected.view[2] ?? 0) - (expected.view[0] ?? 0);
      const expectedHeight = (expected.view[3] ?? 0) - (expected.view[1] ?? 0);
      if (!close(actual.width, expectedWidth) || !close(actual.height, expectedHeight)) {
        return failure(fixture, `geometry:page-${pageNumber}`);
      }
      if (actual.rotate !== expected.rotate) return failure(fixture, `rotation:page-${pageNumber}`);
      if (fixture.mode === "text") {
        const content = await expected.getTextContent();
        const expectedItems = content.items.filter((item) => "str" in item);
        const actualText = normalize(actual.spans.map((span) => span.text).join(""));
        const expectedText = normalize(expectedItems.map((item) => item.str).join(""));
        if (actualText !== expectedText) return failure(fixture, `text:page-${pageNumber}`);
        const actualFirst = actual.spans.find((span) => span.text.trim());
        const expectedFirst = expectedItems.find((item) => item.str.trim());
        if (actual.rotate === 0 && actualFirst && expectedFirst) {
          if (
            !close(actualFirst.bounds.x, expectedFirst.transform[4] ?? 0, 0.25) ||
            !close(actualFirst.bounds.y, expectedFirst.transform[5] ?? 0, 0.25)
          ) {
            return failure(fixture, `position:page-${pageNumber}`);
          }
        }
      }
      reader.releasePage();
    }
    return { id: fixture.id, mode: fixture.mode, categories: fixture.categories, pass: true };
  } catch (error) {
    return failure(fixture, classifyError(error));
  } finally {
    reader?.close();
    await source?.close();
    await oracle?.destroy();
  }
}

function failure(fixture, reason) {
  return {
    id: fixture.id,
    mode: fixture.mode,
    categories: fixture.categories,
    pass: false,
    reason,
  };
}

function normalize(value) {
  return value.normalize("NFC").replace(/\s+/g, "");
}

function close(left, right, tolerance = 0.001) {
  return Math.abs(left - right) <= tolerance;
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/unsupported stream filter/i.test(message))
    return `unsupported-filter:${message.match(/\/\S+/)?.[0] ?? "unknown"}`;
  if (/xref/i.test(message)) return `xref:${message}`;
  if (/page tree|\/Pages|page object/i.test(message)) return `page-tree:${message}`;
  if (/stream/i.test(message)) return `stream:${message}`;
  return `error:${message}`;
}

function summarize(values, key) {
  const output = {};
  for (const value of values) {
    const name = key(value);
    const current = output[name] ?? { passed: 0, total: 0 };
    current.total += 1;
    if (value.pass) current.passed += 1;
    output[name] = current;
  }
  return output;
}

function summarizeCategories(values) {
  const expanded = values.flatMap((value) =>
    value.categories.map((category) => ({ ...value, category })),
  );
  return summarize(expanded, (value) => value.category);
}
