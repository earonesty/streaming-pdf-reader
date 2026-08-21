# PDF.js parity implementation plan

## 98% extension

The active completion target is now at least 118 of the same 120 revision-pinned
fixtures (98.0% when expressed as the requested whole-percent milestone). The
denominator, scoring rules, memory bounds, coverage thresholds, quality gates,
and mandatory slice protocol below remain unchanged. The two encrypted fixtures
may remain explicitly unsupported; reaching the target therefore requires all
other fixtures to pass without regressing any prior pass.

Planned extension slices:

1. Font encodings: embedded Type 1 encoding programs, synthetic glyph names,
   named CMaps, and variable-width ToUnicode sources.
2. Text flow: mixed-direction line ordering and positioned text suppression.
3. Recovery and closure: malformed object recovery, remaining font mappings,
   the 118/120 target gate, full quality run, and remote CI.

## Objective and completion contract

`@boxpdf/reader` reaches v1 parity when all of these statements are true on the
same pushed commit:

1. At least 118 of the 120 fixtures in `corpus/manifest.json` pass
   `pnpm parity:target`.
2. `pnpm test:coverage` enforces at least 90% line coverage and 80% branch
   coverage over `src/**/*.ts`.
3. `pnpm quality` includes the parity target, coverage thresholds, memory gates,
   Biome, type checking, package validation, duplicate detection, and the
   600-line source-file limit.
4. No unsupported input silently returns partial success. Unsupported filters,
   encryption, malformed structures, and resource-limit failures produce typed,
   test-covered errors.
5. The working tree is clean, every slice is committed and pushed, and the
   corresponding remote GitHub Actions run passes.

The corpus is pinned to PDF.js commit
`0f26334f9d6f96119f6e5164fb65832fbbde7344`. Changing the denominator requires
an explicit corpus commit, a regenerated baseline, and a written rationale.

## Scoring

Each fixture contributes one point. The denominator cannot shrink while this
plan is active.

- `load`: both readers open the document and agree on page count, dimensions,
  and rotation for the selected page window.
- `text`: all `load` checks pass, normalized decoded characters match PDF.js,
  and the first positioned text origin matches within 0.25 points on unrotated
  pages.
- A fixture passes only when every selected page passes.
- At most five pages per fixture are checked. Explicit upstream page windows are
  honored.

Baseline established on 2026-08-21:

| Metric | Baseline | Required |
|---|---:|---:|
| Corpus parity | 68/120 (56.7%) | 118/120 (98%) |
| Line coverage | 85.06% | 90% |
| Branch coverage | 68.75% | 80% |
| Largest source module | 538 lines | no module over 600 lines |
| Duplicate-code ceiling | newly enforced at 5% | at most 5% |

## Mandatory slice protocol

Every implementation slice follows this sequence:

1. Record the failing fixture IDs and failure classes targeted by the slice.
2. Add focused unit fixtures/tests before or with the implementation.
3. Implement a bounded, reusable capability; split modules before they exceed
   600 lines and avoid parallel/copied parsing paths.
4. Run `pnpm check`, `pnpm test:coverage`, `pnpm parity:gate`,
   `pnpm test:memory`, and `pnpm package:check`.
5. Regenerate `corpus/baseline.json` only when the pass set grows and no prior
   passing fixture regresses.
6. Commit the coherent slice, push it, and wait for its GitHub Actions run.
7. Record the commit, remote run URL, parity, coverage, and notable remaining
   failures in the slice log below.

The final slice changes the non-regression parity gate into the 90% target gate
and activates Vitest coverage thresholds. A local pass without a successful
remote run does not complete a slice.

## Slice 0 — corpus and measurement foundation

Status: complete

- Generate a deterministic 120-fixture manifest from PDF.js `text` and `load`
  cases plus curated structural coverage.
- Fetch into an ignored cache and validate every MD5.
- Produce machine-readable parity reports and a checked-in non-regression
  baseline.
- Add baseline coverage reporting, duplicate detection, file-size limits, and
  this plan.
- Acceptance: 120 files verified, baseline reflects a valid PDF.js comparison,
  all existing quality checks pass.

## Slice 1 — cross-reference and recovery correctness

Status: complete

Target: at least 92/120 fixtures passing.

- Diagnose the 26 baseline xref-class failures individually.
- Support hybrid-reference files, multiple xref sections, free-entry shadowing,
  generation handling, `/Prev` and `/XRefStm` precedence, and bounded xref
  recovery when `startxref` or an object offset is damaged.
- Keep recovery random-access and capped by explicit scan/work limits.
- Split xref parsing/recovery out of `syntax/document.ts` before adding logic.
- Add surgical generated fixtures for every recovered failure class.

## Slice 2 — stream boundaries, filters, and object streams

Status: complete

Target: at least 100/120 fixtures passing.

- Resolve indirect stream lengths before fallback scanning.
- Handle permitted whitespace/junk and raw/zlib Flate variants safely.
- Add LZW decoding and PNG/TIFF predictors with decoded-size/work limits.
- Correct object-stream header/index edge cases.
- Preserve compressed and decoded byte ceilings under adversarial inputs.
- Split filters and stream decoding into focused modules.

## Slice 3 — text interpretation and nested content

Status: complete

Target: at least 108/120 fixtures passing.

- Classify the remaining text mismatches by encoding, operator semantics,
  positioning, and nested content.
- Complete common `ToUnicode` `bfchar`/`bfrange` forms, codespace widths,
  Differences encodings, Type 0/CID decoding, RTL/vertical direction, and
  UTF-16 handling.
- Interpret Form XObjects recursively with inherited resources and bounded
  cycle/depth controls.
- Correct text/line matrices, graphics-state restoration, spacing, and span
  advances sufficiently for the corpus position gate.
- Keep raw positioned spans as the evidence layer for structure inference.

## Slice 4 — coverage, API errors, and maintainability closure

Status: complete

Target: final completion contract.

- Add branch-focused tests for HTTP/file sources, range validation, limits,
  cache eviction, parser errors, filters, CMaps, and table formatting.
- Introduce exported typed errors with stable error codes.
- Refactor modules approaching 600 lines and remove detected duplication.
- Set Vitest thresholds to 90% lines and 80% branches.
- Add `parity:target`, coverage, and maintainability checks to `pnpm quality`
  and CI.
- Run the final package ESM/CJS smoke tests and `publint`.

## Slice log

| Slice | Commit | Parity | Lines | Branches | Remote CI | Notes |
|---|---|---:|---:|---:|---|---|
| 0 | `f3f4844` | 68/120 | 85.06% | 68.75% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32530052188) | Corpus foundation |
| 1 | `c02f161` | 92/120 | 86.41% | 70.46% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32530805070) | Predictors, bounded recovery, damaged lengths, CropBox |
| 2 | `8064977` | 101/120 | 87.52% | 69.68% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32531686908) | LZW/Flate, object streams, forms, bidi, ToUnicode |
| 3 | `3bf7705` | 108/120 | 87.51% | 69.98% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32532417461) | Font encodings, glyph names, TrueType cmaps |
| 4 | `6f09773` | 108/120 | 95.22% | 80.89% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32533327103) | Enforced final gates and typed errors |
| 5a | `c40647f` | 112/120 | 94.87% | 80.11% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32534287893) | Type 1 programs, glyph-name recovery, named UTF-16 CMaps |
| 5b | `8925c84` | 118/120 | 94.24% | 80.13% | [passed](https://github.com/earonesty/streaming-pdf-reader/actions/runs/32535983398) | Variable CMaps, bounded content concatenation, matrix-aware widths/clipping, RTL flow |
