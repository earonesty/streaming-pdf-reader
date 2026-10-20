import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

// Deterministic offline regression: tiny page tree after >32 MiB of decoded data.
const count = 163_053;
const padding = 40 * 1024 * 1024;
const objectNumbers = Array.from({ length: count }, (_, i) =>
  i < count - 2 ? 1000 + i : i === count - 2 ? 2 : 3,
);
const bodies = objectNumbers.map((_, i) =>
  i === 0
    ? `null\n%${"x".repeat(padding)}\n`
    : i === count - 2
      ? "<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n"
      : i === count - 1
        ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 5 0 R >>\n"
        : "null\n",
);
let offset = 0;
const header = objectNumbers
  .map((n, i) => {
    const pair = `${n} ${offset} `;
    offset += Buffer.byteLength(bodies[i]);
    return pair;
  })
  .join("");
const compressed = deflateSync(Buffer.from(header + bodies.join("")), { level: 9 });
const chunks = [Buffer.from("%PDF-1.7\n")];
const offsets = new Map();
let size = chunks[0].length;
function object(n, value) {
  offsets.set(n, size);
  const chunk = Buffer.concat([
    Buffer.from(`${n} 0 obj\n`),
    Buffer.isBuffer(value) ? value : Buffer.from(value),
    Buffer.from("\nendobj\n"),
  ]);
  chunks.push(chunk);
  size += chunk.length;
}
object(1, "<< /Type /Catalog /Pages 2 0 R >>");
const content = "BT /F1 12 Tf 10 50 Td (Bounded object stream) Tj ET";
object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
object(
  6,
  Buffer.concat([
    Buffer.from(
      `<< /Type /ObjStm /N ${count} /First ${header.length} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
    ),
    compressed,
    Buffer.from("\nendstream"),
  ]),
);
const xrefOffset = size;
const maxObject = Math.max(...objectNumbers.slice(-3), 1000 + count - 3);
const entries = Buffer.alloc((maxObject + 1) * 9);
function entry(n, type, a, b) {
  const p = n * 9;
  entries[p] = type;
  entries.writeUInt32BE(a, p + 1);
  entries.writeUInt32BE(b, p + 5);
}
entry(0, 0, 0, 65535);
for (const [n, position] of offsets) entry(n, 1, position, 0);
entry(7, 1, xrefOffset, 0);
for (const [i, n] of objectNumbers.entries()) entry(n, 2, 6, i);
const xref = deflateSync(entries);
object(
  7,
  Buffer.concat([
    Buffer.from(
      `<< /Type /XRef /Size ${maxObject + 1} /Root 1 0 R /W [1 4 4] /Filter /FlateDecode /Length ${xref.length} >>\nstream\n`,
    ),
    xref,
    Buffer.from("\nendstream"),
  ]),
);
chunks.push(Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`));
const file = new URL("../test/fixtures/large-object-stream.pdf", import.meta.url);
await writeFile(file, Buffer.concat(chunks));
console.log(
  JSON.stringify({
    file: file.pathname,
    entries: count,
    decodedBytes: header.length + offset,
    compressedBytes: compressed.length,
    headerBytes: header.length,
  }),
);
