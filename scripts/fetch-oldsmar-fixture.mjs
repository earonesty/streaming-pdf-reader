import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const url =
  "https://myoldsmar.civicweb.net/document/256785/CITY%20COUNCIL%20-%2020%20Oct%202026.pdf?handle=5F2A941EAEFC46C2B1CB7A06310E459E";
const expected = "41223a5cb8b53f12bde9a56d4ebe4c249ee984418292c17af8bc11cfc55e61bc";
const destination = resolve(process.argv[2] ?? "artifacts/oldsmar-2026-10-20.pdf");
const temporary = `${destination}.${process.pid}.partial`;
await mkdir(dirname(destination), { recursive: true });
const digest = createHash("sha256");
let size = 0;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body)
    throw new Error(`fixture download failed HTTP ${response.status}`);
  await pipeline(
    response.body,
    new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > 153_251_311) {
          callback(new Error("fixture exceeds expected size"));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      },
    }),
    createWriteStream(temporary, { flags: "wx" }),
  );
  if (size !== 153_251_311 || digest.digest("hex") !== expected)
    throw new Error("Oldsmar fixture changed; size/SHA256 do not match the regression artifact");
  await rename(temporary, destination);
  console.log(JSON.stringify({ destination, size, sha256: expected }));
} finally {
  await rm(temporary, { force: true });
}
