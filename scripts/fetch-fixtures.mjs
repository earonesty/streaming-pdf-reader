import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "fixtures/manifest.json"), "utf8"));

for (const fixture of manifest.fixtures) {
  const target = resolve(root, "fixtures", fixture.path);
  let bytes;

  try {
    bytes = await readFile(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const response = await fetch(fixture.source);
    if (!response.ok) {
      throw new Error(
        `failed to fetch ${fixture.source}: ${response.status} ${response.statusText}`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== fixture.sha256) {
    throw new Error(`${fixture.path}: expected ${fixture.sha256}, received ${actual}`);
  }
  console.log(`verified ${fixture.path}`);
}
