import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "corpus/manifest.json"), "utf8"));
const destination = resolve(root, ".cache/pdfjs-corpus");
await mkdir(destination, { recursive: true });

const queue = [...manifest.fixtures];
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length > 0) {
    const fixture = queue.shift();
    if (!fixture) return;
    const target = resolve(destination, fixture.file);
    let bytes;
    try {
      bytes = await readFile(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const response = await fetch(fixture.source);
      if (!response.ok) throw new Error(`${fixture.id}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    const digest = createHash("md5").update(bytes).digest("hex");
    if (digest !== fixture.md5) {
      throw new Error(`${fixture.id}: expected MD5 ${fixture.md5}, received ${digest}`);
    }
    console.log(`verified ${fixture.id}`);
  }
});
await Promise.all(workers);
console.log(`verified ${manifest.fixtures.length} corpus fixtures`);
