import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPdf } from "../dist/index.js";
import { fileSource } from "../dist/node.js";
import { writeHtmlDocument, writeMarkdownDocument } from "../packages/html-writer/dist/index.js";
import { compareComplete } from "./complete-fixtures.mjs";
import { oracleMarkdown } from "./oracle-markdown.mjs";
import { checkReviewContracts } from "./review-contracts.mjs";
import { classifyFindings, reviewFails, reviewStatus } from "./review-policy.mjs";
import { compareDocuments, inspectDocument } from "./semantic-oracle.mjs";

const oracleRoot = resolve(import.meta.dirname, "../fixtures/semantic/ideal");
const manifest = JSON.parse(await readFile(resolve(oracleRoot, "manifest.json"), "utf8"));
const outputIndex = process.argv.indexOf("--out");
if (
  outputIndex >= 0 &&
  (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith("--"))
)
  throw new Error("--out requires a directory");
const outputRoot = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : undefined;
if (outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  await cp(resolve(oracleRoot, "assets"), resolve(outputRoot, "assets"), { recursive: true });
}
const compareIndex = process.argv.indexOf("--compare");
if (
  compareIndex >= 0 &&
  (!process.argv[compareIndex + 1] || process.argv[compareIndex + 1].startsWith("--"))
)
  throw new Error("--compare requires a prior report.json");
const previous =
  compareIndex >= 0
    ? JSON.parse(await readFile(resolve(process.argv[compareIndex + 1]), "utf8"))
    : undefined;
if (previous && (!Array.isArray(previous) || previous.some((row) => !row.document)))
  throw new Error(
    "Prior report lacks document snapshots; generate it with the current report tool first.",
  );
const report = [];
const contractsRoot = resolve(oracleRoot, "..");
const contracts = JSON.parse(
  await readFile(resolve(contractsRoot, "review-contracts.json"), "utf8"),
);
const completeRoot = resolve(contractsRoot, "expected");
const complete = JSON.parse(await readFile(resolve(completeRoot, "manifest.json"), "utf8"));
for (const fixture of [
  ...manifest.fixtures,
  ...contracts.fixtures,
  ...complete.fixtures.map((f) => ({ ...f, complete: true })),
]) {
  const fixtureRoot = fixture.complete ? completeRoot : fixture.checks ? contractsRoot : oracleRoot;
  const idealHtml = fixture.html
    ? await readFile(resolve(fixtureRoot, fixture.html), "utf8")
    : undefined;
  const ideal = idealHtml ? inspectDocument(idealHtml) : undefined;
  if (outputRoot && idealHtml) {
    await writeFile(resolve(outputRoot, `${fixture.id}.oracle.html`), idealHtml);
    await writeFile(
      resolve(outputRoot, `${fixture.id}.oracle.md`),
      fixture.complete
        ? await readFile(resolve(fixtureRoot, fixture.markdown), "utf8")
        : oracleMarkdown(idealHtml),
    );
  }
  for (const format of ["html", "markdown"]) {
    const source = await fileSource(resolve(fixtureRoot, fixture.pdf));
    let pdf;
    let output = "";
    try {
      pdf = await openPdf(source);
      const writer = format === "html" ? writeHtmlDocument : writeMarkdownDocument;
      await writer(
        pdf.pages(),
        (chunk) => {
          output += chunk;
        },
        { profile: "semantic", ...(fixture.checks ? { imageOptions: "embedded" } : {}) },
      );
      const actual = inspectDocument(output, format);
      const coverage = fixture.complete
        ? "complete-fixture"
        : fixture.checks
          ? "focused-contracts"
          : "draft-document";
      const findings = fixture.complete
        ? compareComplete(
            format === "html"
              ? idealHtml
              : await readFile(resolve(fixtureRoot, fixture.markdown), "utf8"),
            output,
            format,
          )
        : fixture.checks
          ? checkReviewContracts(output, format, fixture.checks)
          : compareDocuments(ideal, actual);
      const before = previous?.find((row) => row.id === fixture.id && row.format === format);
      report.push({
        id: fixture.id,
        format,
        coverage,
        expectedTokens: ideal?.tokens.length,
        actualTokens: actual.tokens.length,
        findings: fixture.complete
          ? findings
          : classifyFindings(coverage, findings, fixture.checks),
        document: actual,
        ...(previous
          ? {
              changes: before
                ? compareDocuments(before.document, actual)
                : [{ check: "new-document" }],
            }
          : {}),
      });
      if (outputRoot)
        await writeFile(
          resolve(outputRoot, `${fixture.id}.${format === "html" ? "html" : "md"}`),
          output,
        );
    } finally {
      pdf?.close();
      await source.close();
    }
  }
}
const json = JSON.stringify(report, null, 2);
if (outputRoot) await writeFile(resolve(outputRoot, "report.json"), `${json}\n`);
if (process.argv.includes("--json")) console.log(json);
else
  for (const row of report)
    console.log(
      `${row.id.padEnd(23)} ${row.format.padEnd(8)} ${reviewStatus(row)} ${row.findings.map((finding) => finding.check).join(", ")}${row.changes ? ` | changes: ${row.changes.map((change) => change.check).join(", ") || "none"}` : ""}`,
    );
if (process.argv.includes("--gate") && reviewFails(report)) process.exitCode = 1;
