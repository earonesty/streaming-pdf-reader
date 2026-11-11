import assert from "node:assert/strict";
import { test } from "node:test";
import { compareDocuments, inspectDocument } from "./semantic-oracle.mjs";

const findings = (expected, actual, format = "html") =>
  compareDocuments(inspectDocument(expected), inspectDocument(actual, format));
test("ignores styling, metadata and inline wrappers", () => {
  assert.deepEqual(
    findings(
      "<h1>Title</h1><p>Hello world</p>",
      "<html><head><title>Other</title><style>p{color:red}</style></head><body><h1>Title</h1><p><b>Hello</b> world</p></body></html>",
    ),
    [],
  );
});
test("counts repeated words and rejects substring matches", () => {
  assert.ok(findings("<p>cat cat</p>", "<p>cat catch</p>").some((f) => f.check === "tokens"));
});
test("detects reordered content even with identical vocabulary", () => {
  assert.ok(
    findings("<p>alpha beta gamma</p>", "<p>gamma beta alpha</p>").some(
      (f) => f.check === "readingOrder",
    ),
  );
});
test("detects wrong cell associations", () => {
  assert.ok(
    findings(
      "<table><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>",
      "<table><tr><td>A</td><td>2</td></tr><tr><td>B</td><td>1</td></tr></table>",
    ).some((f) => f.check === "tables"),
  );
});
test("detects heading level, nested list and link destination loss", () => {
  for (const [expected, actual, check] of [
    ["<h5>Deep</h5>", "<h4>Deep</h4>", "headings"],
    ["<ul><li>A<ul><li>B</li></ul></li></ul>", "<ul><li>A</li><li>B</li></ul>", "lists"],
    ['<a href="#note">1</a>', '<a href="#wrong">1</a>', "links"],
  ])
    assert.ok(findings(expected, actual).some((f) => f.check === check));
});
test("parses Markdown independently, including escaped pipes and fenced code", () => {
  assert.deepEqual(
    findings(
      '<h1>Title</h1><p><a href="https://example.com">Site</a></p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x|y</td></tr></tbody></table><pre><code>a\n  b</code></pre>',
      "# Title\n\n[Site](https://example.com)\n\n| A |\n| --- |\n| x\\|y |\n\n```\na\n  b\n```",
      "markdown",
    ),
    [],
  );
});
test("detects Markdown syntax that changes literal text into structure", () => {
  assert.ok(findings("<p># literal</p>", "# literal", "markdown").length);
});
test("detects employment details assigned to the wrong heading", () => {
  assert.ok(
    findings(
      "<h3>Engineer</h3><p>Company A</p><h3>Manager</h3><p>Company B</p>",
      "<h3>Engineer</h3><p>Company B</p><h3>Manager</h3><p>Company A</p>",
    ).some((f) => f.check === "records"),
  );
});

test("missing punctuation does not create a false order regression", () => {
  assert.ok(!findings("<p>A · B · C</p>", "<p>A B C</p>").some((f) => f.check === "readingOrder"));
});
test("inline token splits do not change record ownership", () => {
  assert.deepEqual(
    findings("<h1>Title</h1><p>someword.</p>", "<h1>Title</h1><p>some<strong>word</strong>.</p>"),
    [],
  );
});

const summary =
  "<h2>Totals</h2><dl><div><dt>Subtotal</dt><dd>$408.00</dd></div><div><dt>Shipping</dt><dd>$14.00</dd></div></dl>";
test("Markdown bold labels and delimiter colons equal HTML definition pairs", () => {
  for (const markdown of [
    "## Totals\n\n**Subtotal:** $408.00\n\n**Shipping:** $14.00",
    "## Totals\n\n**Subtotal**: $408.00\n\n**Shipping**: $14.00",
  ])
    assert.deepEqual(findings(summary, markdown, "markdown"), []);
});
test("definition pairs catch swapped, missing, duplicate and unmarked labels", () => {
  for (const markdown of [
    "**Subtotal:** $14.00\n\n**Shipping:** $408.00",
    "**Subtotal:** $408.00",
    "**Subtotal:** $408.00\n\n**Subtotal:** $408.00\n\n**Shipping:** $14.00",
    "Subtotal $408.00\n\nShipping $14.00",
  ])
    assert.ok(findings(summary, markdown, "markdown").some((f) => f.check === "definitions"));
});
test("colons in ordinary prose and label values remain significant", () => {
  assert.ok(
    findings("<p>Note: text</p>", "Note text", "markdown").some((f) => f.check === "tokens"),
  );
  assert.ok(
    findings("<dl><dt>Time</dt><dd>12:30</dd></dl>", "**Time:** 1230", "markdown").some(
      (f) => f.check === "definitions",
    ),
  );
});

test("table header roles cannot disappear while cell text stays identical", () => {
  const expected =
    '<table><tr><th scope="col">Item</th><th scope="col">Total</th></tr><tr><th scope="row">Design</th><td>$900</td></tr></table>';
  const plain =
    "<table><tr><td>Item</td><td>Total</td></tr><tr><td>Design</td><td>$900</td></tr></table>";
  assert.ok(findings(expected, plain).some((f) => f.check === "tableHeaders"));
  assert.ok(
    findings(expected, expected.replace('scope="row"', 'scope="col"')).some(
      (f) => f.check === "tableHeaders",
    ),
  );
  assert.deepEqual(
    findings(expected, "| Item | Total |\n| --- | --- |\n| **Design** | $900 |", "markdown"),
    [],
  );
  assert.ok(
    findings(expected, "| Item | Total |\n| --- | --- |\n| Design | $900 |", "markdown").some(
      (f) => f.check === "tableHeaders",
    ),
  );
});
test("bold ordinary values are not mistaken for row headers", () => {
  const expected =
    "<table><tr><th>Item</th><th>Total</th></tr><tr><td>Design</td><td>$900</td></tr></table>";
  assert.deepEqual(
    findings(expected, "| Item | Total |\n| --- | --- |\n| Design | **$900** |", "markdown"),
    [],
  );
});
test("invoice label target matches current Markdown labels independently of tables", async () => {
  const { readFile } = await import("node:fs/promises");
  const target = inspectDocument(
    await readFile(
      new URL("../fixtures/semantic/ideal/acme-studio-invoice.html", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(target.headings, ["h1:Acme Studio"]);
  assert.deepEqual(
    target.definitions,
    inspectDocument(
      "**STATUS:** Paid\n\n**NOTES:** Two fraction column should be wider and wrap later than the first column.",
      "markdown",
    ).definitions,
  );
});

test("production contracts reject disconnected or swapped row associations", async () => {
  const { checkReviewContracts } = await import("./review-contracts.mjs");
  const checks = [{ kind: "rowContains", cells: ["Owner A", "$10"] }];
  assert.deepEqual(
    checkReviewContracts("<table><tr><td>Owner A</td><td>$10</td></tr></table>", "html", checks),
    [],
  );
  assert.equal(
    checkReviewContracts(
      "<table><tr><td>Owner A</td><td>$20</td></tr><tr><td>Owner B</td><td>$10</td></tr></table>",
      "html",
      checks,
    ).length,
    1,
  );
});
test("caption contract requires associated media, not a distant image", async () => {
  const { checkReviewContracts } = await import("./review-contracts.mjs");
  const checks = [{ kind: "mediaCaption", caption: "Figure 1:", media: "img" }];
  assert.deepEqual(
    checkReviewContracts("![](figure.png)\n\n*Figure 1: Example*", "markdown", checks),
    [],
  );
  assert.equal(
    checkReviewContracts(
      "![](figure.png)\n\nUnrelated prose\n\n*Figure 1: Example*",
      "markdown",
      checks,
    ).length,
    1,
  );
});

test("oracle Markdown preserves labels, links and row headers independently", async () => {
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  const html =
    '<h1>Invoice</h1><dl><dt>Status</dt><dd>Paid</dd></dl><p><a href="https://example.com">Details</a></p><table><tr><th scope="col">Item</th><th scope="col">Amount</th></tr><tr><th scope="row">Design</th><td>$900</td></tr></table>';
  const markdown = oracleMarkdown(html);
  assert.ok(markdown.includes("**Status:** Paid"));
  assert.ok(markdown.includes("**Design**"));
  assert.deepEqual(findings(html, markdown, "markdown"), []);
});
test("oracle Markdown retains spanning cells as HTML instead of flattening them", async () => {
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  const html = '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">Shared</td></tr></table>';
  assert.deepEqual(findings(html, oracleMarkdown(html), "markdown"), []);
});

test("column flow requires contiguous prose in one paragraph outside a table", async () => {
  const { checkReviewContracts } = await import("./review-contracts.mjs");
  const checks = [{ kind: "flowParagraph", values: ["captions can suggest better captions"] }];
  assert.deepEqual(
    checkReviewContracts("captions can suggest better captions", "markdown", checks),
    [],
  );
  for (const html of [
    "<p>captions can</p><p>suggest better captions</p>",
    "<p>captions can unrelated column suggest better captions</p>",
    "<table><tr><td><p>captions can suggest better captions</p></td></tr></table>",
  ])
    assert.equal(checkReviewContracts(html, "html", checks).length, 1);
});

test("reviewed research code keeps line numbers, indentation and inline comments", async () => {
  const { readFile } = await import("node:fs/promises");
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  const target = await readFile(
    new URL("../fixtures/semantic/ideal/research-paper.html", import.meta.url),
    "utf8",
  );
  const expected = inspectDocument(target).code;
  assert.equal(expected.length, 3);
  assert.equal(expected[0].split("\n").length, 6);
  assert.ok(expected[0].includes("2   if (!primes[i])\n3     continue;"));
  assert.equal(expected[1].split("\n").length, 13);
  assert.ok(expected[1].split("\n").every((line) => line.includes("//")));
  assert.ok(expected[2].includes("// (*) side exit if call failed"));
  assert.ok(expected[2].includes("// restore ecx"));
  assert.ok(expected[2].includes("// jump to ret statement"));
  assert.deepEqual(inspectDocument(oracleMarkdown(target), "markdown").code, expected);
});

test("research oracle preserves Figure 2 as source media with its caption", async () => {
  const { readFile } = await import("node:fs/promises");
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  const { checkReviewContracts } = await import("./review-contracts.mjs");
  const html = await readFile(
    new URL("../fixtures/semantic/ideal/research-paper.html", import.meta.url),
    "utf8",
  );
  const checks = [{ kind: "mediaCaption", caption: "Figure 2.", media: "img" }];
  assert.deepEqual(checkReviewContracts(html, "html", checks), []);
  assert.deepEqual(checkReviewContracts(oracleMarkdown(html), "markdown", checks), []);
  const image = await readFile(
    new URL("../fixtures/semantic/ideal/assets/research-figure-2.png", import.meta.url),
  );
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.ok(!html.includes('aria-label="State-machine labels"'));
});

test("research target has no orphan code-comment duplicates and preserves Figure 2 emphasis", async () => {
  const { readFile } = await import("node:fs/promises");
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  const { marked } = await import("marked");
  const html = await readFile(
    new URL("../fixtures/semantic/ideal/research-paper.html", import.meta.url),
    "utf8",
  );
  assert.equal((html.match(/load primes from the trace activation record/g) ?? []).length, 2);
  assert.ok(!html.replace(/<pre>[\s\S]*?<\/pre>/g, "").includes("// load primes"));
  assert.ok(!html.includes("<p>//"));
  const markdown = oracleMarkdown(html);
  assert.equal((markdown.match(/load primes from the trace activation record/g) ?? []).length, 2);
  assert.match(marked.parse(markdown), /<hr>\s*<p><strong>Figure 2\.<\/strong> <em>State machine/);
});

test("draft targets and unverified checks cannot fail the gate", async () => {
  const { classifyFindings, reviewFails, reviewStatus } = await import("./review-policy.mjs");
  const finding = { check: "tokens", index: 0 };
  for (const [coverage, checks] of [
    ["draft-document", [{ verification: { basis: "source-reviewed", evidence: "page 1" } }]],
    ["focused-contracts", []],
    ["focused-contracts", [{ verification: { basis: "source-reviewed" } }]],
  ]) {
    const row = { coverage, findings: classifyFindings(coverage, [finding], checks) };
    assert.equal(reviewFails([row]), false);
    assert.equal(reviewStatus(row), "REVIEW");
  }
  const row = {
    coverage: "focused-contracts",
    findings: classifyFindings(
      "focused-contracts",
      [finding],
      [{ verification: { basis: "source-reviewed", evidence: "page 1" } }],
    ),
  };
  assert.equal(reviewFails([row]), true);
  assert.equal(reviewStatus(row), "FAIL");
});
test("keeps inline words joined but block boundaries separate in contracts", async () => {
  const { checkReviewContracts } = await import("./review-contracts.mjs");
  assert.deepEqual(
    checkReviewContracts(
      "<table><tr><td>Any per<strong>son</strong> engaging</td></tr></table>",
      "html",
      [{ kind: "rowContains", cells: ["Any person engaging"] }],
    ),
    [],
  );
  assert.equal(
    checkReviewContracts("<div><p>Case Status</p><p>Unrelated text</p><p>Open</p></div>", "html", [
      { kind: "labelValue", label: "Case Status", value: "Open" },
    ]).length,
    1,
  );
  assert.deepEqual(
    checkReviewContracts("<dl><div><dt>Case Status</dt><dd>Open</dd></div></dl>", "html", [
      { kind: "labelValue", label: "Case Status", value: "Open" },
    ]),
    [],
  );
  assert.equal(checkReviewContracts("<p>\u0085</p>", "html", [{ kind: "noControls" }]).length, 1);
});
test("detects detached table captions and preserves definition value spaces", () => {
  assert.ok(
    findings(
      "<table><caption>Totals</caption><tr><td>5</td></tr></table>",
      "<p>Totals</p><table><tr><td>5</td></tr></table>",
    ).some((f) => f.check === "tableCaptions"),
  );
  assert.deepEqual(
    inspectDocument("**Label:** <em>Alpha</em> <em>Beta</em>", "markdown").definitions,
    [JSON.stringify(["Label", "Alpha Beta"])],
  );
});
test("oracle Markdown preserves irregular tables and unsupported header roles as HTML", async () => {
  const { oracleMarkdown } = await import("./oracle-markdown.mjs");
  for (const html of [
    '<table><tr><th>A</th><th>B</th></tr><tr><th scope="rowgroup">Group</th><td>one</td></tr></table>',
    "<table><tr><th>A</th></tr><tr><td>one</td><td>two</td></tr></table>",
    '<table><tr><th>A</th><th>B</th></tr><tr><td>one</td><th scope="row">two</th></tr></table>',
    '<table><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">one</td><td>two</td></tr><tr><td>three</td></tr></table>',
  ]) {
    const markdown = oracleMarkdown(html);
    assert.ok(markdown.includes("<table>"));
    assert.deepEqual(inspectDocument(markdown, "markdown").tables, inspectDocument(html).tables);
    assert.deepEqual(
      inspectDocument(markdown, "markdown").tableHeaders,
      inspectDocument(html).tableHeaders,
    );
  }
});
