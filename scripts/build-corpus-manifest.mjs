import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(root, "corpus/config.json"), "utf8"));
const manifestUrl = `https://raw.githubusercontent.com/${config.upstream.repository}/${config.upstream.commit}/test/test_manifest.json`;
const response = await fetch(manifestUrl);
if (!response.ok) throw new Error(`failed to fetch PDF.js manifest: HTTP ${response.status}`);
const manifestBytes = new Uint8Array(await response.arrayBuffer());
const digest = createHash("sha256").update(manifestBytes).digest("hex");
if (digest !== config.upstream.testManifestSha256) {
  throw new Error(
    `PDF.js manifest digest changed: expected ${config.upstream.testManifestSha256}, received ${digest}`,
  );
}
const upstream = JSON.parse(new TextDecoder().decode(manifestBytes));

const byFile = new Map();
for (const entry of upstream) {
  if (entry.link || !entry.file?.startsWith("pdfs/")) continue;
  const existing = byFile.get(entry.file) ?? [];
  existing.push(entry);
  byFile.set(entry.file, existing);
}

const selected = new Map();
for (const [file, entries] of byFile) {
  const text = entries.find((entry) => entry.type === "text");
  const load = entries.find((entry) => entry.type === "load");
  const primary = text ?? load;
  if (primary) selected.set(file, corpusEntry(file, primary, text ? "text" : "load", config));
}

for (const filename of config.curatedFiles) {
  if (selected.size >= config.targetFixtureCount) break;
  const file = `pdfs/${filename}`;
  if (selected.has(file)) continue;
  const entries = byFile.get(file);
  if (!entries?.[0]) throw new Error(`curated fixture is absent from pinned manifest: ${file}`);
  selected.set(file, corpusEntry(file, entries[0], "load", config));
}

if (selected.size !== config.targetFixtureCount) {
  throw new Error(
    `corpus selection produced ${selected.size} fixtures; expected ${config.targetFixtureCount}`,
  );
}

for (const fixture of config.customFixtures ?? []) {
  if (selected.has(fixture.file)) throw new Error(`duplicate custom fixture: ${fixture.file}`);
  selected.set(fixture.file, fixture);
}

const output = {
  schemaVersion: 1,
  generatedFrom: {
    repository: config.upstream.repository,
    commit: config.upstream.commit,
    manifestUrl,
    manifestSha256: digest,
  },
  scoring: {
    fixtureCount: selected.size,
    maximumPagesPerFixture: config.maximumPagesPerFixture,
    parityTarget: config.parityTarget,
  },
  fixtures: [...selected.values()].sort((left, right) => left.id.localeCompare(right.id)),
};
await writeFile(resolve(root, "corpus/manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote corpus/manifest.json with ${selected.size} fixtures`);

function corpusEntry(file, entry, mode, corpusConfig) {
  const filename = file.slice("pdfs/".length);
  return {
    id: filename
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase(),
    file: filename,
    mode,
    md5: entry.md5,
    source: `https://raw.githubusercontent.com/${corpusConfig.upstream.repository}/${corpusConfig.upstream.commit}/test/${file}`,
    firstPage: entry.firstPage ?? 1,
    lastPage: entry.lastPage ?? null,
    categories: categories(`${entry.id} ${filename}`),
  };
}

function categories(value) {
  const lower = value.toLowerCase();
  const result = [];
  const rules = [
    ["xref", /xref|object.?stream|linear/],
    ["font", /font|type3|truetype|cid|cmap|unicode|ligature|vertical|arabic/],
    ["annotation", /annotation/],
    ["form", /form|widget|xfa/],
    ["filter", /flate|ascii|ccitt|jbig|jpx|jpeg|predict|indexed/],
    ["structure", /structure|marked|page.?tree/],
    ["geometry", /rotat|matrix|bounding|vertical/],
    ["malformed", /invalid|missing|cycle|fuzz|bad/],
  ];
  for (const [category, pattern] of rules) if (pattern.test(lower)) result.push(category);
  return result.length > 0 ? result : ["general"];
}
