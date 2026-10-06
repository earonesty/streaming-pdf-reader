import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { memorySource, openPdf } from "../dist/index.js";

const kind = process.argv[2];
if (kind !== "cidchar" && kind !== "cidrange" && kind !== "small")
  throw new Error("expected CID record kind or small-map mode");
const decodedBytes = kind === "small" ? 0 : 32 * 1024 * 1024;
const pageReads = kind === "small" ? 2_000 : 1;
const pdf = buildPdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  stream(Buffer.from("BT /F1 12 Tf 100 100 Td <0001> Tj ET")),
  "<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding 6 0 R /ToUnicode 7 0 R /DescendantFonts [8 0 R] >>",
  compressedEncoding(),
  stream(Buffer.from("1 beginbfchar <0001> <0041> endbfchar")),
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /DW 500 /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>",
]);
// Release fixture-construction buffers before measuring the complete reader path.
globalThis.gc();
const baseline = process.memoryUsage();
let peakArrayBuffers = baseline.arrayBuffers;
const start = performance.now();
const reader = await openPdf(memorySource(pdf));
try {
  let text = "";
  for (let index = 0; index < pageReads; index += 1) {
    const page = await reader.getPage(0);
    text = page.spans.map((span) => span.text).join("");
    peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
    if (text !== "A") throw new Error("unexpected extracted text");
  }
  process.stdout.write(
    `${JSON.stringify({
      decodedBytes,
      text,
      elapsedMs: performance.now() - start,
      peakRssGrowth: peakRss() - baseline.rss,
      pageReads,
      peakArrayBufferGrowth: peakArrayBuffers - baseline.arrayBuffers,
    })}\n`,
  );
} finally {
  reader.close();
}

/** Generate near-limit repeated valid records without a large intermediate JS string. */
function compressedEncoding() {
  if (kind === "small") return stream(Buffer.from("1 begincidchar <0001> 7 endcidchar"));
  const prefix = Buffer.from(`2000000 begin${kind} `);
  const suffix = Buffer.from(` end${kind}`);
  const record = kind === "cidchar" ? "<0001> 7 " : "<0001> <0002> 7 ";
  const bytes = Buffer.alloc(decodedBytes, " ");
  prefix.copy(bytes);
  const end = decodedBytes - suffix.length;
  const recordsEnd =
    prefix.length + Math.floor((end - prefix.length) / record.length) * record.length;
  bytes.fill(record, prefix.length, recordsEnd);
  suffix.copy(bytes, end);
  return stream(deflateSync(bytes), " /Filter /FlateDecode");
}

/** Wrap bytes as a PDF stream object. */
function stream(bytes, dictionary = "") {
  return Buffer.concat([
    Buffer.from(`<< /Length ${bytes.length}${dictionary} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream"),
  ]);
}

/** Assemble a small PDF with byte-accurate xref offsets. */
function buildPdf(objects) {
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const body = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.isBuffer(object) ? object : Buffer.from(object),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(body);
    length += body.length;
  }
  const xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}`;
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

/** Linux VmHWM resets on exec; getrusage can retain the launching process's peak. */
function peakRss() {
  if (process.platform === "linux") {
    const status = readFileSync("/proc/self/status", "utf8");
    const kilobytes = /^VmHWM:\s+(\d+) kB$/m.exec(status)?.[1];
    if (!kilobytes) throw new Error("missing process peak RSS");
    return Number(kilobytes) * 1024;
  }
  return process.resourceUsage().maxRSS * 1024;
}
