import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";

const baseline = JSON.parse(
  await readFile(new URL("../../scripts/oldsmar-output-baseline.json", import.meta.url), "utf8"),
);
let directory: string;

beforeAll(async () => {
  // Spaces exercise URL-to-path handling in the harness's dynamic runtime import.
  directory = await mkdtemp(join(tmpdir(), "object stream smoke "));
  await mkdir(join(directory, "scripts"));
  await mkdir(join(directory, "artifacts/object-stream-worker"), { recursive: true });
  for (const name of ["object-stream-workerd-smoke.mjs", "oldsmar-output-baseline.json"]) {
    await copyFile(
      new URL(`../../scripts/${name}`, import.meta.url),
      join(directory, "scripts", name),
    );
  }
  // The fake runtime ignores the bundle; no optional native build is required.
  await writeFile(join(directory, "artifacts/object-stream-worker/object-stream-worker.js"), "");
  await writeFile(join(directory, "fixture.pdf"), "");
  await writeFile(
    join(directory, "miniflare.mjs"),
    `export class Miniflare {
      async dispatchFetch() { return Response.json(JSON.parse(process.env.SMOKE_RESULT)); }
      async dispose() {}
    }`,
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function smoke(result: unknown, pages = "1,2,3,4,5,6,7,8,9,10") {
  return promisify(execFile)(
    process.execPath,
    [
      join(directory, "scripts/object-stream-workerd-smoke.mjs"),
      join(directory, "fixture.pdf"),
      pages,
    ],
    {
      env: {
        ...process.env,
        MINIFLARE_MODULE: join(directory, "miniflare.mjs"),
        SMOKE_RESULT: JSON.stringify(result),
      },
    },
  );
}

it("reports success only for matching page output, including a requested subset", async () => {
  const result = { count: baseline.count, pages: baseline.pages };
  const { stdout } = await smoke(result);
  expect(JSON.parse(stdout)).toEqual({ ...result, rangeRequests: 0 });
  const subset = { count: baseline.count, pages: [baseline.pages[1]] };
  expect(JSON.parse((await smoke(subset, "2")).stdout)).toEqual({ ...subset, rangeRequests: 0 });
});

it.each([
  ["empty pages", { count: baseline.count, pages: [] }],
  ["missing pages", { count: baseline.count, pages: baseline.pages.slice(1) }],
  ["wrong page count", { count: 1, pages: baseline.pages }],
  [
    "wrong spans",
    { count: baseline.count, pages: baseline.pages.map((p: object) => ({ ...p, spans: 0 })) },
  ],
  [
    "wrong hash",
    {
      count: baseline.count,
      pages: baseline.pages.map((p: object) => ({ ...p, textSha256: "changed" })),
    },
  ],
  ["reordered pages", { count: baseline.count, pages: [...baseline.pages].reverse() }],
])("rejects HTTP 200 with %s", async (_name, result) => {
  await expect(smoke(result)).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("differs from baseline"),
  });
});

it("rejects requested pages without baseline coverage", async () => {
  await expect(smoke({}, "11")).rejects.toMatchObject({ code: 1, stdout: "" });
});
