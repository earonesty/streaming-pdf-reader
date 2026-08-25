import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "boxpdf-package-smoke-"));

try {
  await run("pnpm", ["pack", "--pack-destination", temporaryDirectory], { cwd: root });
  await run("pnpm", ["pack", "--pack-destination", temporaryDirectory], {
    cwd: resolve(root, "packages/html-writer"),
  });
  const archives = (await readdir(temporaryDirectory))
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => resolve(temporaryDirectory, name));
  if (archives.length !== 2)
    throw new Error(`expected two package archives; found ${archives.length}`);

  await writeFile(
    resolve(temporaryDirectory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], {
    cwd: temporaryDirectory,
  });

  await writeFile(
    resolve(temporaryDirectory, "smoke.mjs"),
    `import { memorySource } from "@boxpdf/reader";
import { pageToHtml } from "@boxpdf/html-writer";
if (memorySource(new Uint8Array()).size !== 0) throw new Error("ESM reader export failed");
const html = await pageToHtml({ number: 1, width: 100, height: 100, rotate: 0, spans: [] });
if (!html.includes('data-page="1"')) throw new Error("ESM writer export failed");
`,
  );
  await writeFile(
    resolve(temporaryDirectory, "smoke.cjs"),
    `const { memorySource } = require("@boxpdf/reader");
const { pageToHtml } = require("@boxpdf/html-writer");
if (memorySource(new Uint8Array()).size !== 0) throw new Error("CJS reader export failed");
pageToHtml({ number: 1, width: 100, height: 100, rotate: 0, spans: [] }).then((html) => {
  if (!html.includes('data-page="1"')) throw new Error("CJS writer export failed");
});
`,
  );
  await writeFile(
    resolve(temporaryDirectory, "types.ts"),
    `import type { ExtractedPage } from "@boxpdf/reader";
import { pageToHtml } from "@boxpdf/html-writer";
const page: ExtractedPage = { number: 1, width: 100, height: 100, rotate: 0, spans: [] };
void pageToHtml(page);
`,
  );
  await writeFile(
    resolve(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true }, files: ["types.ts"] }, null, 2)}\n`,
  );

  await run(process.execPath, ["smoke.mjs"], { cwd: temporaryDirectory });
  await run(process.execPath, ["smoke.cjs"], { cwd: temporaryDirectory });
  await run(resolve(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
    cwd: temporaryDirectory,
  });

  const writerArchive = archives.find((archive) => archive.includes("html-writer"));
  if (!writerArchive) throw new Error("writer package archive was not produced");
  const { stdout: listing } = await run("tar", ["-tzf", writerArchive]);
  for (const required of [
    "package/LICENSE",
    "package/examples/file.ts",
    "package/examples/http.ts",
  ]) {
    if (!listing.split("\n").includes(required))
      throw new Error(`writer archive is missing ${required}`);
  }
  const writerManifest = JSON.parse(
    await readFile(
      resolve(temporaryDirectory, "node_modules/@boxpdf/html-writer/package.json"),
      "utf8",
    ),
  );
  if (writerManifest.peerDependencies?.["@boxpdf/reader"] !== "^0.1.0") {
    throw new Error("writer archive has an unexpected reader peer range");
  }
  console.log("packed ESM, CJS, types, examples, license, and peer dependency are valid");
} finally {
  await rm(temporaryDirectory, { recursive: true });
}
