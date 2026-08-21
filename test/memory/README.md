# Memory contract tests

Memory tests run readers in isolated subprocesses and measure RSS, JavaScript
heap, ArrayBuffer memory, source bytes read, and largest individual read. The
test corpus will be generated sparsely so source size can increase without
making Git fixtures or CI checkout size increase.
