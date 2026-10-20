# Proposal: bounded extraction from large compressed object streams

Status: implementation proposal; this change does not alter the reader or raise limits.

## Problem and reproduction

A small indirect PDF object can live inside an `/ObjStm` whose complete decoded
body is much larger than the reader's memory budget. Random-access input and
page-at-a-time extraction do not bound the current object-stream lookup.

The public Oldsmar council packet provides a concrete reproduction:

- URL: <https://myoldsmar.civicweb.net/document/256785/CITY%20COUNCIL%20-%2020%20Oct%202026.pdf?handle=5F2A941EAEFC46C2B1CB7A06310E459E>
- SHA256: `41223a5cb8b53f12bde9a56d4ebe4c249ee984418292c17af8bc11cfc55e61bc`
- File: 153,251,311 bytes; 1,344 pages.
- Object stream 7951: 7,009,653 compressed bytes; 44,684,446 decoded bytes.
- `/N`: 163,053; `/First`: 2,459,850.
- Reading the page-tree root fails before page 1 with the default 33,554,432-byte
  decoded-stream limit, including with an 8 MiB source cache and 8 MiB object/xref
  cache budgets.

These measurements come from the retained production artifact and local
reproduction with reader 0.2.6. Inspection of upstream main at
`a2fe737` (reader 0.2.7) confirms the same relevant allocation path remains.
A prior local experiment allowing a 64 MiB decoded stream read ten pages in
32.06 seconds and peaked at 268,156 KiB process RSS. That measurement includes
Node and the extraction workload; it is not a measurement of stream bytes alone
or a Cloudflare isolate memory measurement. It does not validate a limit increase
for a 128 MiB Worker.

The public URL can change. A fixture fetcher should verify the hash and retain
this exact artifact outside Git; do not commit a 153 MB PDF or credentials.
Synthetic fixtures must provide the default offline CI coverage.

## Current allocation boundary

The relevant code is `src/syntax/document.ts`:

1. `PdfObjectReader.#readCompressedObject` obtains the container through the
   existing object cache, then calls `decodeStream(container)`.
2. `src/syntax/filters.ts`'s `inflateOnce` retains every output chunk. It then
   allocates a second contiguous `Uint8Array` and copies the chunks into it.
3. `#readCompressedObject` parses all `/N` header pairs into an array of JS
   `{ object, offset }` records, selects one entry, and parses that value from
   the full decoded stream.

At the copy boundary, both the chunk collection and contiguous decoded output
are live. Index records add allocation proportional to `/N`. Byte-store and
object-cache limits do not cover these temporary allocations. Reducing pages
per batch cannot change a failure during page-tree-root resolution.

## Proposed implementation

### Separate materialization from traversal

Keep `decodeStream` and its existing decoded-materialization limit for callers
that require a complete buffer. Add an internal chunk-consumer decoder for
object-stream lookup. For the first implementation, support a single
`FlateDecode` (including the `Fl` alias) with absent/default predictor settings.
Inspect the actual filter/parameter representation through the same resolution
rules as `decodeStream`; a one-element Filter array must work too.

Unsupported filter chains and predictors keep the existing bounded path and
explicit limit errors. They must not silently ignore a filter or receive an
unbounded fallback. Streaming support for other chains can be added separately.

Use fixed-size input pushes and output chunks. Do not append discarded chunks
to pako's default result collection. A byte-range consumer can discard output
before and after the requested interval while counting all traversed bytes.
Decoder state and callback buffers must be released on success and failure.

### Scan the header with constant workspace

The header consists of `/N` pairs of object numbers and relative body offsets.
Implement an incremental integer/whitespace/comment scanner across chunk
boundaries. Do not turn the header into a string, buffer `/First` bytes, or
allocate an array of all entries.

One complete header scan can retain only:

- The pair at the xref entry's index, for the existing preferred lookup.
- The first pair matching the requested object number, for the existing
  index-mismatch fallback.
- Token position, pair count, and bounded numeric-token state.

If the indexed pair matches the object number, select it; otherwise use the
first matching pair, preserving current selection behavior. A second header
scan can find the smallest body offset strictly greater than the selected
start. This supports headers whose offsets are not sorted without retaining
all pairs. For the final object, determine its end from the validated decoded
length. Adjacent, ordinary headers may use a one-pass optimization only after
its equivalence is tested.

Require safe integers for `/N`, `/First`, object numbers, offsets, indexes,
lengths, and their arithmetic. Reject negative/out-of-range values, partial
pairs, and header tokens extending into the body. Bound numeric-token length
before concatenating text. Explicitly test zero-length, duplicate and
out-of-order offsets and choose a documented rejection or compatibility rule.
Do not use advertised sizes as unchecked allocation requests.

### Materialize only the requested object

Replay the decoder from the beginning and copy only the selected object's byte
interval into a bounded buffer. Give `ValueParser` exactly that interval so a
malformed value cannot consume its neighbor's bytes. Check target size before
growing buffers, and bound geometric-growth/copy peaks, not only final length.
The existing parser nesting and object-cache budgets remain in force.

Finish decoding to validate stream integrity and the referenced offsets unless
a separately validated stream result is available. Finding the target is not
permission to accept a truncated stream or bad checksum. Filter retry attempts
must reset speculative parser/output state; resource-limit errors must not
become raw-deflate retries.

For a correctness-first implementation, replay costs CPU but keeps live
workspace independent of total decoded stream size and header entry count.
DEFLATE output offsets are not random-access input offsets: seeking to an
arbitrary compressed byte is invalid without the decoder's state/window.

### Bound memory and work separately

Proposed option semantics, subject to implementation measurements:

| Limit | Proposed behavior |
| --- | --- |
| `maxDecodedStreamBytes` | Preserve existing full-buffer materialization guard. |
| `maxObjectStreamWorkspaceBytes` | Bound scanner buffers, output windows and target-buffer allocation peaks together; initial candidate 8 MiB. |
| `maxObjectStreamDecodedBytes` | Bound logical output traversed per decoding pass; initial candidate 128 MiB, sufficient for this 44.7 MB stream. |
| `maxObjectStreamEntries` | Bound header scanning work; initial candidate 1,000,000, with further structural validation against `/First`. |

These are proposed defaults, not verified memory guarantees. The selected
object must fit both its workspace allocation allowance and `maxObjectBytes`;
otherwise fail with `PdfError(RESOURCE_LIMIT)` identifying the binding budget.
Previously accepted documents should retain a bounded compatibility path where
possible. Document any new opt-in/default limits that reduce accepted coverage.

Also impose a finite aggregate decoded-byte/pass budget per object lookup:
three bounded passes must not accidentally become unlimited retries. Expose
traversed bytes, replay count and peak temporary bytes in reader stats, alongside
the current source/cache measurements. Stats must describe their measurement
scope; the sum of buffer counters is not total JS heap or isolate RSS.

The initial path may continue materializing the compressed container under
`maxObjectBytes`; for Oldsmar that input is 7 MB. Account for it independently
from the temporary workspace and caches. Streaming compressed input directly
from `PdfSource` can be a follow-up, not an unsupported claim in the first PR.

### Make repeated lookup costs visible

A compact, byte-budgeted metadata/window cache is an optional optimization,
not a precondition for correctness. Charge its allocations to an explicit
budget and evict deterministically. Do not retain a decoded 44.7 MB object
stream or a JS object per header pair as an implicit optimization.

Benchmark page-tree resolution and representative page extraction with cold
and warm caches. If replay makes the ordinary ten-page Worker continuation
exceed its CPU/time budget, this approach alone is insufficient. Evaluate
bounded inflater checkpoints or a host-provided spill adapter separately;
neither a temporary filesystem nor writable external storage is available to
all reader consumers. Do not add an implicit network/storage dependency.

## Acceptance tests

1. Generate an offline PDF with a small page-tree root near the end of an
   object stream whose decoded body exceeds 32 MiB, with over 163,000 entries.
   With small fixed caches/workspace, `getPageCount` and page text succeed.
2. Compare extracted target values against full decoding on tractable fixtures:
   first/middle/last entries, header tokens split at every output boundary,
   comments/whitespace, Filter name/array/alias forms, xref-index mismatch and
   offset ordering. Test back-to-back lookups and eviction.
3. Reject malformed metadata, oversized targets, excessive logical expansion,
   token-length attacks, deep values, truncated input and bad checksums with
   deterministic errors and released temporary buffers. Verify unsupported
   filters/predictors retain their bounded behavior.
4. Extend isolated-process memory tests: grow total decoded body and `/N` while
   fixing selected object size and budgets. Peak temporary counters should be
   bounded; compare heap, ArrayBuffers and RSS with a generous runtime baseline.
   Measure the peak while decoding/copying, not only after `releasePage()`.
5. Run the real hash-verified Oldsmar packet through a range-backed source.
   Verify 1,344 pages and compare text for representative pages and then all
   pages against the current high-limit reader and an independent PDF oracle.
   Preserve page order, empty-page behavior and extraction errors.
6. Exercise real ten-page continuations in a 128 MiB Worker isolate with the
   application's fixed 8 MiB source/object/xref cache budgets. Record peak
   memory evidence available from the runtime, CPU, wall time, range reads,
   replay counts and output equivalence. Repeat across continuations to detect
   retained buffers. Node RSS alone cannot establish this acceptance gate.
7. Run the repository's quick, oracle, memory, typecheck, maintainability,
   packaging and release checks for the implementation change.

## Delivery and downstream adoption

Implement chunk decoding/scanning as focused syntax modules to preserve the
600-line source-file limit. Add synthetic tests and instrumentation before
wiring the lookup. Benchmark the real artifact before choosing defaults.
Publish a reader release only after correctness and memory gates pass.

DirtSignal can then adopt the release while retaining its existing compatibility
patches, run its range-reader and ingestion regressions, and verify Oldsmar's
normal scheduled continuation through complete persistence. This proposal does
not change production dependencies, weaken validation, skip the packet, or
claim that Oldsmar is recovered.
