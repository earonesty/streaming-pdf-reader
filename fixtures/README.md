# Test fixtures

`manifest.json` is the source of truth for the checked-in PDF corpus. Every
fixture has a revision-pinned source URL, SHA-256 digest, license, and a short
list of parser features it exercises.

Run `pnpm fixtures:fetch` to download missing fixtures and verify every digest.
PDF binaries are tracked through Git LFS. The initial corpus comes from the
Apache-2.0-licensed PDF.js and qpdf repositories. Upstream revision and license
links are recorded in `fixtures/licenses/README.md`.

Keep the commit-blocking corpus small. Large, hostile, or generated memory-test
documents belong in a reproducible generator or external corpus manifest.
