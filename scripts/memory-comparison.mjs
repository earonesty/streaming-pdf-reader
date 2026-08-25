import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const worker = resolve(import.meta.dirname, "memory-comparison-worker.mjs");
const sizes = process.argv.slice(2).map(parseSize);
if (sizes.length === 0) sizes.push(10 * 1024 * 1024, 100 * 1024 * 1024);

const results = [];
for (const size of sizes) {
  for (const engine of ["reader", "pdfjs", "unpdf"]) {
    const { stdout } = await run(process.execPath, ["--expose-gc", worker, engine, String(size)], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    results.push(JSON.parse(stdout));
  }
}

console.log("| Input | Engine | Peak RSS | Peak ArrayBuffers | Source data read |");
console.log("|---:|---|---:|---:|---:|");
for (const result of results) {
  console.log(
    `| ${formatBytes(result.virtualSize)} | ${result.engine} | ${formatBytes(result.peakRss)} | ${formatBytes(result.peakArrayBuffers)} | ${result.sourceBytesRead === null ? "entire input" : formatBytes(result.sourceBytesRead)} |`,
  );
}

function parseSize(value) {
  const match = /^(\d+)(KiB|MiB|GiB)?$/i.exec(value);
  if (!match) throw new Error(`invalid size: ${value}`);
  const units = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
  return Number(match[1]) * (units[match[2]?.toLowerCase()] ?? 1);
}

function formatBytes(value) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  return `${(value / 1024).toFixed(2)} KiB`;
}
