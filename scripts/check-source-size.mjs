import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumLines = 600;
const files = await walk(resolve(root, "src"));
const oversized = [];
for (const file of files.filter((file) => extname(file) === ".ts")) {
  const lines = (await readFile(file, "utf8")).split("\n").length;
  if (lines > maximumLines) oversized.push(`${file.slice(root.length + 1)}: ${lines} lines`);
}
if (oversized.length > 0) {
  throw new Error(
    `source files exceed the ${maximumLines}-line maintainability limit:\n${oversized.join("\n")}`,
  );
}
console.log(`${files.length} source files satisfy the ${maximumLines}-line limit`);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}
