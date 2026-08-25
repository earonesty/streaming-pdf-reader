# Memory contract tests

Memory tests run readers in isolated subprocesses and measure RSS, JavaScript
heap, ArrayBuffer memory, source bytes read, and largest individual read. The
test corpus will be generated sparsely so source size can increase without
making Git fixtures or CI checkout size increase.

Run `pnpm memory:compare` for an informational, isolated-process comparison
against raw PDF.js and unpdf. The comparison materializes the complete input
for the PDF.js and unpdf data APIs, while `@boxpdf/reader` receives the same
logical PDF through its random-access source. It is deliberately not a CI gate:
third-party memory use can change independently, and large comparison sizes can
exceed constrained CI runners. Optional size arguments accept bytes, KiB, MiB,
or GiB, for example `pnpm memory:compare 10MiB 250MiB`.
