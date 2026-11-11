import assert from "node:assert/strict";
import { test } from "node:test";
import { compareComplete } from "./complete-fixtures.mjs";

test("ignores presentation and attribute order", () => {
  assert.deepEqual(
    compareComplete(
      '<p><a href="/a" title="A">Hello</a></p>',
      '<main class="page"><p style="color:red"><a title="A" href="/a"><span>Hello</span></a></p></main>',
      "html",
    ),
    [],
  );
});
for (const [name, expected, actual] of [
  ["missing content", "<p>hello</p><p>footer</p>", "<p>hello</p>"],
  ["duplicate content", "<p>hello</p>", "<p>hello</p><p>hello</p>"],
  ["emphasis", "<p><strong>label</strong></p>", "<p>label</p>"],
  ["link destination", '<a href="/a">go</a>', '<a href="/b">go</a>'],
  [
    "table role",
    "<table><tr><th scope=col>A</th></tr></table>",
    "<table><tr><td>A</td></tr></table>",
  ],
  ["code whitespace", "<pre>a  b</pre>", "<pre>a b</pre>"],
])
  test(`rejects changed ${name}`, () =>
    assert.equal(compareComplete(expected, actual, "html").length, 1));
test("Markdown compares its complete parsed structure independently", () => {
  assert.deepEqual(compareComplete("**Label:** value", "__Label:__ value", "markdown"), []);
  assert.equal(compareComplete("**Label:** value", "Label: value", "markdown").length, 1);
});
test("preserves word spaces around inline elements and preformatted edges", () => {
  for (const [a, b, format] of [
    ["<p>Hello <strong>world</strong></p>", "<p>Hello<strong>world</strong></p>", "html"],
    ["**Note** text", "**Note**text", "markdown"],
    ["<pre>  code\n</pre>", "<pre>code</pre>", "html"],
  ])
    assert.equal(compareComplete(a, b, format).length, 1);
  assert.deepEqual(
    compareComplete(
      "<div>\n<p>Hello <strong>world</strong></p>\n</div>",
      "<div><p>Hello <strong>world</strong></p></div>",
      "html",
    ),
    [],
  );
});
