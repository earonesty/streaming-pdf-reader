import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "parse5";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { writeHtmlDocument } from "../packages/html-writer/dist/index.js";

const oracleRoot = resolve(import.meta.dirname, "../fixtures/semantic/ideal");
const manifest = JSON.parse(await readFile(resolve(oracleRoot, "manifest.json"), "utf8"));
const semanticTags = new Set([
  "header",
  "address",
  "section",
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "dl",
  "table",
  "figure",
  "figcaption",
  "pre",
  "footer",
]);

const report = [];
for (const fixture of manifest.fixtures) {
  const source = await fileSource(resolve(oracleRoot, fixture.pdf));
  const pdf = await openPdf(source);
  let actual = "";
  try {
    await writeHtmlDocument(
      pdf.pages(),
      (chunk) => {
        actual += chunk;
      },
      { profile: "semantic" },
    );
  } finally {
    pdf.close();
    await source.close();
  }

  const ideal = await readFile(resolve(oracleRoot, fixture.html), "utf8");
  const idealDocument = parse(ideal);
  const actualDocument = parse(actual);
  const idealText = normalize(textOf(idealDocument));
  const actualText = normalize(textOf(actualDocument));
  const idealWords = idealText.split(" ").filter(Boolean);
  const actualWords = new Set(actualText.split(" ").filter(Boolean));
  const vocabularyCoverage =
    idealWords.filter((word) => actualWords.has(word)).length / idealWords.length;
  const orderWords = idealWords.filter((word) => word.length > 4);
  let offset = 0;
  let orderedWords = 0;
  for (const word of orderWords) {
    const found = actualText.indexOf(word, offset);
    if (found < 0) continue;
    orderedWords += 1;
    offset = found + word.length;
  }

  const idealTags = tagCounts(idealDocument);
  const actualTags = tagCounts(actualDocument);
  report.push({
    id: fixture.id,
    idealWords: idealWords.length,
    actualWords: actualText.split(" ").filter(Boolean).length,
    vocabularyCoverage,
    readingOrderCoverage: orderWords.length === 0 ? 1 : orderedWords / orderWords.length,
    tags: Object.fromEntries(
      [...semanticTags]
        .map((tag) => [tag, { ideal: idealTags.get(tag) ?? 0, actual: actualTags.get(tag) ?? 0 }])
        .filter(([, counts]) => counts.ideal > 0 || counts.actual > 0),
    ),
  });
}

if (process.argv.includes("--json")) console.log(JSON.stringify(report, undefined, 2));
else printTable(report);

function textOf(node) {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textOf).join(" ");
}

function normalize(value) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

function tagCounts(node, counts = new Map()) {
  if (node.tagName) counts.set(node.tagName, (counts.get(node.tagName) ?? 0) + 1);
  for (const child of node.childNodes ?? []) tagCounts(child, counts);
  return counts;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printTable(rows) {
  console.log(
    "fixture                 words actual/ideal  vocabulary  reading order  missing roles",
  );
  for (const row of rows) {
    const missing = Object.entries(row.tags)
      .filter(([, counts]) => counts.actual < counts.ideal)
      .map(([tag, counts]) => `${tag}:${counts.actual}/${counts.ideal}`)
      .join(", ");
    console.log(
      `${row.id.padEnd(23)} ${String(row.actualWords).padStart(5)}/${String(row.idealWords).padEnd(5)} ${percent(row.vocabularyCoverage).padStart(10)} ${percent(row.readingOrderCoverage).padStart(14)}  ${missing}`,
    );
  }
}
