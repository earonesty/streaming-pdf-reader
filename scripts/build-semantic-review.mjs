import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { marked } from "marked";
import { parse, serialize } from "parse5";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { writeHtmlDocument, writeMarkdownDocument } from "../packages/html-writer/dist/index.js";

const value = (flag) => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
    throw new Error(`${flag} requires a directory`);
  return resolve(process.argv[index + 1]);
};
const input = value("--input");
const output = value("--out");
const root = resolve(import.meta.dirname, "..");
const ideals = JSON.parse(
  await readFile(resolve(root, "fixtures/semantic/ideal/manifest.json"), "utf8"),
);
const contracts = JSON.parse(
  await readFile(resolve(root, "fixtures/semantic/review-contracts.json"), "utf8"),
);
const report = JSON.parse(await readFile(resolve(input, "report.json"), "utf8"));
await mkdir(resolve(output, "sources"), { recursive: true });
await cp(resolve(root, "fixtures/semantic/ideal/assets"), resolve(output, "assets"), {
  recursive: true,
});
const complete = JSON.parse(
  await readFile(resolve(root, "fixtures/semantic/expected/manifest.json"), "utf8"),
);
const cases = ideals.fixtures.map((fixture) => ({
  ...fixture,
  pdf: resolve(root, "fixtures/semantic/ideal", fixture.pdf),
  oracleId: fixture.id,
}));
for (const fixture of complete.fixtures)
  cases.push({
    ...fixture,
    pdf: resolve(root, "fixtures/semantic/expected", fixture.pdf),
    oracleId: fixture.id,
    complete: true,
  });
for (const fixture of contracts.fixtures) {
  const existing = cases.find(
    (candidate) => candidate.id === fixture.id.replace(/-regressions$/, ""),
  );
  if (existing) {
    existing.outputId = fixture.id;
    existing.contracts = fixture.checks;
  } else
    cases.push({
      ...fixture,
      pdf: resolve(root, "fixtures/semantic", fixture.pdf),
      contracts: fixture.checks,
    });
}
for (const name of [
  "column-plain",
  "column-asides",
  "page-furniture",
  "wrapped-notes",
  "separation-control",
]) {
  cases.push({
    id: name,
    pdf: resolve(root, `fixtures/semantic/boundaries/${name}.pdf`),
    bounded: true,
  });
}
async function renderBoundary(fixture, writer) {
  const source = await fileSource(fixture.pdf);
  const pdf = await openPdf(source);
  let result = "";
  try {
    await writer(
      pdf.pages(),
      (chunk) => {
        result += chunk;
      },
      { profile: "semantic", semanticLookaheadPages: 3 },
    );
    return result;
  } finally {
    pdf.close();
    await source.close();
  }
}
function cleanHtml(source) {
  const doc = parse(source);
  function clean(node) {
    if (node.attrs)
      node.attrs = node.attrs.filter(
        (attr) => attr.name !== "style" && attr.name !== "class" && !attr.name.startsWith("on"),
      );
    if (node.childNodes) {
      node.childNodes = node.childNodes.filter(
        (child) => !["script", "style", "head"].includes(child.tagName),
      );
      for (const child of node.childNodes) clean(child);
    }
  }
  clean(doc);
  return serialize(doc);
}
const data = [];
for (const fixture of cases) {
  const id = fixture.id;
  const outputId = fixture.outputId ?? id;
  const sourcePdf = resolve(output, "sources", `${id}.pdf`);
  await copyFile(fixture.pdf, sourcePdf);
  const pageName = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9]+\\.png$`);
  for (const name of await readdir(resolve(output, "sources")))
    if (pageName.test(name)) await rm(resolve(output, "sources", name));
  execFileSync(
    "pdftoppm",
    ["-scale-to", "1200", "-png", sourcePdf, resolve(output, "sources", id)],
    { stdio: "pipe" },
  );
  const pages = (await readdir(resolve(output, "sources")))
    .filter((name) => pageName.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `sources/${name}`);
  const markdown = fixture.bounded
    ? await renderBoundary(fixture, writeMarkdownDocument)
    : await readFile(resolve(input, `${outputId}.md`), "utf8");
  const item = {
    name: id,
    features: fixture.features,
    complete: fixture.complete,
    category: fixture.complete
      ? "Fixture"
      : fixture.bounded
        ? "Bounded fixture"
        : fixture.oracleId
          ? "Draft reference"
          : "Corpus checks",
    pdf: relative(output, sourcePdf),
    pages,
    html: cleanHtml(
      fixture.bounded
        ? await renderBoundary(fixture, writeHtmlDocument)
        : await readFile(resolve(input, `${outputId}.html`), "utf8"),
    ),
    markdown: cleanHtml(marked.parse(markdown)),
    markdownRaw: markdown,
    contracts: fixture.contracts,
    findings: report
      .filter((row) => [id, outputId].includes(row.id))
      .map(({ format, coverage, expectedTokens, actualTokens, findings, changes }) => ({
        format,
        coverage,
        expectedTokens,
        actualTokens,
        findings,
        changes,
      })),
  };
  if (fixture.oracleId) {
    const oracle = await readFile(resolve(input, `${fixture.oracleId}.oracle.md`), "utf8");
    item.ideal = cleanHtml(
      await readFile(resolve(input, `${fixture.oracleId}.oracle.html`), "utf8"),
    );
    item.oracleMarkdown = cleanHtml(marked.parse(oracle));
    item.oracleMarkdownRaw = oracle;
    item.coverage =
      "Draft whole-document reference — differences are advisory" +
      (fixture.contracts ? " + evidence-backed focused checks" : "");
  } else item.coverage = "Evidence-backed focused checks — no whole-document draft";
  if (fixture.bounded)
    item.coverage =
      "Generated bounded fixture — focused HTML and Markdown assertions in test/semantic-boundaries/flow.test.ts. No draft reference. Known flow defects are skipped by default; run pnpm reproduce:semantic-boundaries to execute them. Passing controls remain active; this preview does not run assertions.";
  if (fixture.complete)
    item.coverage =
      "Complete expected HTML and Markdown — authoritative fixture expectations. Features: " +
      fixture.features.join("; ");
  data.push(item);
}
// Start with the reviewed invoice so the Markdown comparison is immediately useful.
const first = data.findIndex((item) => item.name === "acme-studio-invoice");
if (first > 0) data.unshift(...data.splice(first, 1));
const template = await readFile(resolve(import.meta.dirname, "semantic-review.html"), "utf8");
await writeFile(
  resolve(output, "preview.html"),
  template.replace('"REVIEW_DATA"', () => JSON.stringify(data).replaceAll("<", "\\u003c")),
);
console.log(`Wrote ${data.length} full-document comparisons to ${resolve(output, "preview.html")}`);
