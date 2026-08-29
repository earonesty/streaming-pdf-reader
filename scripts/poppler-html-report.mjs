import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "parse5";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { writeHtmlDocument } from "../packages/html-writer/dist/index.js";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "corpus/manifest.json"), "utf8"));
const baselinePath = resolve(root, "corpus/poppler-html-baseline.json");
const reportPath = resolve(root, "artifacts/poppler-html-report.json");
const writeBaseline = process.argv.includes("--write-baseline");
const gate = process.argv.includes("--gate");
const fixtures = manifest.fixtures.filter((fixture) => fixture.mode === "text");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "boxpdf-poppler-corpus-"));

try {
  await run("pdftohtml", ["-v"]);
  const results = [];
  for (const [index, fixture] of fixtures.entries()) {
    const result = await compareFixture(fixture);
    results.push(result);
    console.log(
      `${String(index + 1).padStart(2)}/${fixtures.length} ${result.pass ? "PASS" : "FAIL"} ${fixture.id}${result.reason ? ` — ${result.reason}` : ""}`,
    );
  }

  const passing = results.filter((result) => result.pass);
  const summary = {
    generatedAt: new Date().toISOString(),
    popplerVersion: await popplerVersion(),
    fixtureCount: results.length,
    passed: passing.length,
    failed: results.length - passing.length,
    parity: passing.length / results.length,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  if (writeBaseline) {
    const baseline = {
      schemaVersion: 1,
      fixtureCount: summary.fixtureCount,
      passed: summary.passed,
      parity: summary.parity,
      passingFixtureIds: passing.map((result) => result.id).sort(),
    };
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  }

  if (gate) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const passingIds = new Set(passing.map((result) => result.id));
    const regressions = baseline.passingFixtureIds.filter((id) => !passingIds.has(id));
    if (summary.passed < baseline.passed || regressions.length > 0) {
      throw new Error(
        `Poppler HTML regression: ${summary.passed}/${summary.fixtureCount} pass; baseline ${baseline.passed}/${baseline.fixtureCount}; regressed fixtures: ${regressions.join(", ") || "none"}`,
      );
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true });
}

async function compareFixture(fixture) {
  const pdfPath = resolve(root, ".cache/pdfjs-corpus", fixture.file);
  const firstPage = Math.max(1, fixture.firstPage ?? 1);
  let source;
  let reader;
  try {
    source = await fileSource(pdfPath);
    reader = await openPdf(source, {
      chunkSize: 16 * 1024,
      maxBytes: 2 * 1024 * 1024,
      maxObjectCacheBytes: 2 * 1024 * 1024,
      maxDecodedStreamBytes: 16 * 1024 * 1024,
    });
    const pageCount = await reader.getPageCount();
    const lastPage = Math.min(
      pageCount,
      fixture.lastPage ?? pageCount,
      firstPage + manifest.scoring.maximumPagesPerFixture - 1,
    );
    let writerHtml = "";
    const evidence = { pages: 0, text: "" };
    await writeHtmlDocument(
      selectedPages(reader, firstPage, lastPage, evidence),
      (chunk) => {
        writerHtml += chunk;
      },
      { title: fixture.id },
    );

    const oraclePath = join(temporaryDirectory, `${fixture.id}.html`);
    await run("pdftohtml", [
      "-q",
      "-c",
      "-hidden",
      "-noframes",
      "-zoom",
      "1",
      "-f",
      String(firstPage),
      "-l",
      String(lastPage),
      pdfPath,
      oraclePath,
    ]);
    const actual = summarizeWriter(writerHtml);
    if (actual.pages.length !== evidence.pages)
      return failure(fixture, `html-page-count:${actual.pages.length}!=${evidence.pages}`);
    const serializedText = sanitizeHtmlText(evidence.text);
    if (actual.text !== serializedText)
      return failure(fixture, `html-${textDifference(actual.text, serializedText)}`);
    const expected = summarizePoppler(await readFile(oraclePath, "utf8"));
    let reference;
    const pdfJsReference = async () => {
      reference ??= await summarizePdfJs(pdfPath, firstPage, lastPage);
      return reference;
    };
    const justifiedDivergences = [];
    if (actual.pages.length !== expected.pages.length)
      return failure(fixture, `page-count:${actual.pages.length}!=${expected.pages.length}`);
    for (let index = 0; index < actual.pages.length; index += 1) {
      const left = actual.pages[index];
      const right = expected.pages[index];
      if (!close(left.width, right.width) || !close(left.height, right.height)) {
        const pdfJsPage = (await pdfJsReference()).pages[index];
        if (
          !pdfJsPage ||
          !close(left.width, pdfJsPage.width) ||
          !close(left.height, pdfJsPage.height)
        )
          return failure(fixture, `geometry:page-${firstPage + index}`);
        justifiedDivergences.push(`pdfjs-geometry:page-${firstPage + index}`);
      }
    }
    const actualText = normalize(actual.text);
    const expectedText = normalize(expected.text);
    if (actualText !== expectedText) {
      const pdfJsText = normalize((await pdfJsReference()).text);
      if (actualText !== pdfJsText)
        return failure(fixture, textDifference(actualText, expectedText));
      justifiedDivergences.push("pdfjs-text");
    }
    return {
      id: fixture.id,
      pass: true,
      ...(justifiedDivergences.length > 0 ? { reason: justifiedDivergences.join(",") } : {}),
    };
  } catch (error) {
    return failure(fixture, error instanceof Error ? error.message : String(error));
  } finally {
    reader?.close();
    await source?.close();
  }
}

async function summarizePdfJs(pdfPath, firstPage, lastPage) {
  const document = await getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    verbosity: 0,
  }).promise;
  try {
    const pages = [];
    let text = "";
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
      page.cleanup();
    }
    return { pages, text };
  } finally {
    await document.destroy();
  }
}

async function* selectedPages(reader, firstPage, lastPage, evidence) {
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
    const page = await reader.getPage(pageNumber - 1);
    evidence.pages += 1;
    evidence.text += page.spans.map((span) => span.text).join("");
    yield page;
    reader.releasePage();
  }
}

function sanitizeHtmlText(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 13) return "\n";
      const forbidden =
        codePoint <= 8 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127;
      return forbidden ? "�" : character;
    })
    .join("");
}

function summarizeWriter(html) {
  const parseErrors = [];
  const document = parse(html, { onParseError: (error) => parseErrors.push(error.code) });
  if (parseErrors.length > 0)
    throw new Error(`invalid-html:${[...new Set(parseErrors)].join(",")}`);
  const htmlElement = children(document).find((node) => node.tagName === "html");
  const head = children(htmlElement).find((node) => node.tagName === "head");
  const body = children(htmlElement).find((node) => node.tagName === "body");
  const main = descendants(body).find(
    (node) => node.tagName === "main" && attribute(node, "class") === "pdf-document",
  );
  if (!htmlElement || !head || !body || !main) throw new Error("invalid-html:document-structure");
  const sections = children(main).filter(
    (node) => node.tagName === "section" && hasClass(node, "pdf-page--positioned"),
  );
  return {
    pages: sections.map((section) => pageGeometry(attribute(section, "style"))),
    text: sections
      .flatMap((section) => {
        const nodes = descendants(section);
        const accessibleText = nodes.find(
          (node) => node.tagName === "span" && hasClass(node, "pdf-accessible-text"),
        );
        return accessibleText
          ? [accessibleText]
          : nodes.filter(
              (node) =>
                attribute(node, "aria-label") || node.tagName === "span" || node.tagName === "text",
            );
      })
      .map((node) => attribute(node, "aria-label") || textContent(node))
      .join(""),
  };
}

function pageGeometry(style) {
  const match = /(?:^|;)width:([\d.]+)pt;height:([\d.]+)pt(?:;|$)/.exec(style);
  if (!match) throw new Error("invalid-html:page-geometry");
  return { width: Number(match[1]), height: Number(match[2]) };
}

function children(node) {
  return node?.childNodes ?? [];
}

function descendants(node) {
  const output = [];
  for (const child of children(node)) {
    output.push(child, ...descendants(child));
  }
  return output;
}

function attribute(node, name) {
  return node?.attrs?.find((candidate) => candidate.name === name)?.value ?? "";
}

function hasClass(node, name) {
  return attribute(node, "class").split(/\s+/).includes(name);
}

function textContent(node) {
  return children(node)
    .map((child) => (child.nodeName === "#text" ? child.value : textContent(child)))
    .join("");
}

function summarizePoppler(html) {
  return {
    pages: [...html.matchAll(/id="page\d+-div"[^>]+width:([\d.]+)px;height:([\d.]+)px/g)].map(
      (match) => ({ width: Number(match[1]), height: Number(match[2]) }),
    ),
    text: [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((match) => decodeEntities(stripTags(match[1] ?? "")))
      .join(""),
  };
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, "");
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function normalize(value) {
  return value.normalize("NFC").replace(/\s+/g, "");
}

function close(left, right) {
  return Math.abs(left - right) <= 1;
}

function textDifference(actual, expected) {
  let offset = 0;
  while (
    offset < actual.length &&
    offset < expected.length &&
    actual[offset] === expected[offset]
  ) {
    offset += 1;
  }
  const contextStart = Math.max(0, offset - 12);
  return `text:${actual.length}!=${expected.length}@${offset}:${JSON.stringify(actual.slice(contextStart, offset + 24))}!=${JSON.stringify(expected.slice(contextStart, offset + 24))}`;
}

function failure(fixture, reason) {
  return { id: fixture.id, pass: false, reason };
}

async function popplerVersion() {
  const { stderr } = await run("pdftohtml", ["-v"]);
  return stderr.trim().split("\n")[0] ?? "unknown";
}
