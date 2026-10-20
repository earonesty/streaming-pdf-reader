# Bounded extraction from large compressed object streams

This change implements bounded object-stream extraction in `src/syntax/object-stream.ts`.
It does not increase the ordinary decoded-stream materialization limit.

## Reproduction and fixtures

The public Oldsmar council packet fails before page 1 in the old reader:

- URL: <https://myoldsmar.civicweb.net/document/256785/CITY%20COUNCIL%20-%2020%20Oct%202026.pdf?handle=5F2A941EAEFC46C2B1CB7A06310E459E>
- SHA256: `41223a5cb8b53f12bde9a56d4ebe4c249ee984418292c17af8bc11cfc55e61bc`.
- File: 153,251,311 bytes; 1,344 pages.
- Object stream 7951: 7,009,653 compressed bytes; 44,684,446 decoded bytes.
- `/N`: 163,053; `/First`: 2,459,850.

The old `#readCompressedObject` calls `decodeStream` on the entire container.
`inflateOnce` retains all chunks and then copies them into another contiguous
buffer. Object lookup also allocates a JS record for every header entry. The
32 MiB decoded-stream limit correctly stops this allocation, including with
small source/object/xref caches. Smaller page batches cannot fix root loading.

`test/fixtures/large-object-stream.pdf` is a checked-in, offline synthetic
regression: 163,053 entries and 45,259,330 decoded bytes, with a small page tree
near the end. Its text is `Bounded object stream`; compressed file size is
1,155,941 bytes. `node scripts/generate-large-object-stream.mjs` regenerates it.

The real 153 MB packet stays outside Git. To fetch and verify it without
materializing the download in JS memory:

```sh
node scripts/fetch-oldsmar-fixture.mjs
pnpm build
node --max-old-space-size=64 scripts/object-stream-memory-worker.mjs artifacts/oldsmar-2026-10-20.pdf 1,2,3,4,5,6,7,8,9,10
```

The fetcher enforces byte count and SHA256 before renaming the partial download.
The source URL may change; mismatched artifacts must not replace this fixture.

## Implementation

The decoder scans header pairs incrementally, retaining only the matching
indexed entry and the first identity-match fallback. For a sorted header with
a known next offset, it can copy the exact target interval in that same pass.
For unsorted offsets or a final entry whose end is unknown until EOF, a second
bounded pass finds the interval and copies the target. Neither path buffers the
header or allocates `/N` records. The scanner validates integer token length,
header size/count, safe nonnegative integers, complete pairs and body offsets.
`ValueParser` sees only the selected interval, so malformed syntax cannot read
into its neighbor.

All passes finish decoding to check integrity. A recognized zlib wrapper must
pass its checksum; it cannot be retried as raw DEFLATE to bypass corruption.
Raw-deflate fallback remains available for streams without a recognized zlib
wrapper. Failed attempts release their speculative target state.

Supported streaming forms are no filter, `FlateDecode`/`Fl`, and a one-element
filter array, with absent/default predictor settings. Other filter chains and
predictors retain the existing bounded decoder and its explicit failures.

Output chunks are at most 64 KiB. Only the selected object's bytes are retained,
under `maxObjectBytes`; there is no full decoded-stream or header-entry cache.
Replay costs CPU. DEFLATE byte offsets cannot be treated as seek
positions without retaining decoder state. Further caching/checkpoint work
must have an explicit budget and equivalent integrity tests.

## Aggregate work limit

`maxObjectStreamDecodedBytes` defaults to **at least 128 MiB per object lookup**, shared
across both passes, filter retries, and xref-recovery retries. If a caller raises
`maxDecodedStreamBytes`, the default aggregate allowance is at least twice that
limit, preserving the prior full-buffer acceptance range. It is a work
budget, not a buffer allocation request. Decoded output from failed attempts
counts too. Exceeding it raises `PdfError(RESOURCE_LIMIT)` and does not trigger
xref recovery. The implementation can observe the final offending output chunk
before rejecting it; stats include that work.

Reader stats expose cumulative `objectStreamDecodedBytes` and
`peakObjectStreamBufferBytes`. The latter measures target plus output-chunk
buffers only. It excludes the compressed container, source/object/xref caches,
inflater state, parsed objects, fonts, page output and runtime overhead.

## Memory accounting and Worker acceptance

The Oldsmar checks use `maxObjectBytes = 16 MiB` and fixed **8 MiB each** for
source, object and xref caches, with the existing 32 MiB generic decoded-stream
limit. A conservative live raw-buffer envelope includes:

| Allocation | Configured envelope |
| --- | ---: |
| Direct-object read staging | 16 MiB |
| Compressed container copy | 16 MiB |
| Source, object and xref caches combined | 24 MiB |
| Selected object | 16 MiB |
| Two output chunks at a callback boundary | 128 KiB |

That envelope is **72.125 MiB before inflater, scanner, parsed values, fonts,
page output and runtime overhead**. The container can also be present in the
object cache; counting both is conservative. This is not a total JS-heap bound:
parser expansion and rendering allocations need independent measurement.
The remaining 55.875 MiB of a 128 MiB limit cannot be assumed available entirely
to the reader. Arbitrary PDFs are not certified to fit a 128 MiB isolate by this
change. An oversized selected object still fails its configured limit.

The synthetic isolated-process test gates incremental Node RSS growth and
tracked temporary bytes. Node process RSS includes runtime/allocator overhead
and is not a Worker-isolate measurement. The real-artifact acceptance check
runs the normal ten-page continuation in workerd with these exact settings and
compares output. This checks the complete execution rather than a count-only
probe; it does not expose a measured isolate high-water mark or certify all
PDFs to fit Cloudflare's 128 MiB production envelope. Repeat distant page
samples and continuations before downstream rollout.

The optional smoke harness is reproducible without adding a native runtime to
the reader's dependencies. Install Miniflare into a separate scratch directory,
then supply its module path:

```sh
npm install --prefix /tmp/boxpdf-worker-test miniflare@4.20260409.0
pnpm exec tsup --config scripts/object-stream-workerd.config.ts
MINIFLARE_MODULE=/tmp/boxpdf-worker-test/node_modules/miniflare/dist/src/index.js node scripts/object-stream-workerd-smoke.mjs artifacts/oldsmar-2026-10-20.pdf
```

The harness checks the total page count and every requested page's number,
span count and text SHA256 against `scripts/oldsmar-output-baseline.json` before
reporting success. The baseline records the first ten pages from the pre-change
reader at `a2fe737` with a 64 MiB decoded-stream limit. Empty, missing, reordered
or changed output fails the check; requested pages outside that baseline fail
explicitly and require independently verified baseline coverage first.

The harness serves positional reads through a host service binding. It does not
contact production, read credentials, or put the full PDF into the isolate.

## Validation evidence

Against upstream main `a2fe737`, a local pre-change reader with a temporary
64 MiB materialization limit reads the first ten real pages in 37.73 seconds,
peaking at 242,220 KiB process RSS. The final bounded implementation reads those
same ten pages in **20.37 seconds**, peaking at **157,876 KiB RSS**, with matching
text hashes and span counts on every page. Peak tracked target/output buffers
are **65,627 bytes**. The first version replayed every lookup and took 45.29
seconds; the sorted-header fast path halves decoded work without retaining a
stream/header cache.

The local workerd ten-page smoke returns 1,344 total pages and exactly matching
hashes/span counts in **21.12 seconds**, with 410 host range reads and the same
65,627-byte tracked buffer peak. A single-page check alone initially succeeded
while the slower ten-page version failed with a transport connection-loss
error; the completed ten-page check applies to the final fast path. These are
local execution measurements, not a measured isolate high-water mark, full
1,344-page text equivalence, or production recovery.

Tests cover the large fixture, exact target bounds, unsorted offsets, identity
fallback, cross-chunk headers/comments, raw/unfiltered/alias forms, corruption,
truncation, malformed metadata, aggregate work and selected-object limits, and
bounded fallback behavior. The memory worker records range reads, counters,
text hashes, wall time and process memory for reproducible follow-up checks.

DirtSignal adoption remains separate: retain its existing compatibility patches,
run range-reader/ingestion regressions, and verify Oldsmar's normal scheduler
path through source exhaustion and persistence. This upstream change does not
modify production dependencies or claim production recovery.
