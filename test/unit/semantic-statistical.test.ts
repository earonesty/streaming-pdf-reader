import { describe, expect, it } from "vitest";
import type { TextSpan } from "../../src/index.js";
import type { Table, TextLine } from "../../src/structure/index.js";
import { inferSemanticBlocks } from "../../src/structure/semantic.js";

describe("language-independent semantic inference", () => {
  it("uses typography rather than section and profession vocabulary", () => {
    const lines = [
      line("Curriculum vitæ", 40, 700, 24, "Fixture-Bold"),
      line("Expérience professionnelle", 40, 650, 16, "Fixture-Bold"),
      line("Ingénieure principale", 40, 610, 12, "Fixture-Bold"),
      line("Société Exemple · Paris", 40, 594, 10),
      line("2021 — 2026", 420, 612, 10),
      line("Une description suffisamment longue du travail réalisé.", 40, 560, 11),
      line("Une autre ligne de corps pour établir la taille dominante.", 40, 544, 11),
    ];

    const blocks = inferSemanticBlocks(lines, []);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({
      type: "heading",
      level: 2,
      text: "Expérience professionnelle",
    });
    expect(blocks[2]).toMatchObject({
      type: "employment",
      role: "Ingénieure principale",
      organization: "Société Exemple · Paris",
      date: "2021 — 2026",
    });
  });

  it("recognizes emphasized numeric summaries without financial keywords", () => {
    const terms = [span("Zwischensumme", 40, 200, 11), span("Gesamt", 40, 180, 11, "Fixture-Bold")];
    const values = [span("€ 100,00", 180, 200, 11), span("€ 119,00", 180, 180, 11, "Fixture-Bold")];
    const table: Table = {
      type: "table",
      page: 1,
      bounds: { x: 40, y: 180, width: 210, height: 32 },
      columns: [40, 180],
      confidence: 1,
      reasons: [],
      cells: [
        cell(0, 0, terms[0] as TextSpan),
        cell(0, 1, values[0] as TextSpan),
        cell(1, 0, terms[1] as TextSpan),
        cell(1, 1, values[1] as TextSpan),
      ],
    };
    const lines = [
      textLine("Zwischensumme € 100,00", 200, [terms[0] as TextSpan, values[0] as TextSpan]),
      textLine("Gesamt € 119,00", 180, [terms[1] as TextSpan, values[1] as TextSpan]),
    ];

    expect(inferSemanticBlocks(lines, [table])[0]).toMatchObject({
      type: "definitionList",
      entries: [
        { term: "Zwischensumme", description: "€ 100,00" },
        { term: "Gesamt", description: "€ 119,00" },
      ],
    });
  });

  it("preserves every consecutive list marker", () => {
    const blocks = inferSemanticBlocks(
      [
        line("• Premier élément", 40, 200, 11),
        line("• Deuxième élément", 40, 180, 11),
        line("• Tercer elemento", 40, 160, 11),
      ],
      [],
    );

    expect(blocks[0]).toMatchObject({
      type: "list",
      items: [
        { text: "Premier élément" },
        { text: "Deuxième élément" },
        { text: "Tercer elemento" },
      ],
    });
  });

  it("treats a monospaced run inside proportional text as preformatted", () => {
    const blocks = inferSemanticBlocks(
      [
        line("Introduction", 40, 260, 16, "Fixture-Bold"),
        line("Proportional body text before the example.", 40, 240, 11),
        line("Another proportional line establishes document context.", 40, 225, 11),
        line("One more proportional line follows here.", 40, 210, 11),
        line("1 boucle {", 40, 180, 10, "Fixture-Mono"),
        line("2   valeur", 40, 168, 10, "Fixture-Mono"),
        line("3 }", 40, 156, 10, "Fixture-Mono"),
      ],
      [],
    );

    expect(blocks.find((block) => block.type === "preformatted")).toMatchObject({
      text: "1 boucle {\n2   valeur\n3 }",
    });
  });

  it("uses the shallowest heading level for modestly enlarged byline text", () => {
    const blocks = inferSemanticBlocks(
      [
        line("A Statistical Paper Title", 40, 300, 18, "Fixture-Bold"),
        line("Ana García*, Benoît Martin*, Chloé Dubois†", 40, 270, 12),
        line("The first body line establishes the document's dominant size.", 40, 240, 10),
        line("The second body line supplies more proportional body text.", 40, 225, 10),
        line("The third body line keeps the statistical signal stable.", 40, 210, 10),
      ],
      [],
    );

    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({
      type: "heading",
      level: 4,
      text: "Ana García*, Benoît Martin*, Chloé Dubois†",
    });
  });

  it("separates hanging-indent entries when text returns to the outer edge", () => {
    const blocks = inferSemanticBlocks(
      [
        line("Alpha entry begins here and wraps", 40, 200, 10),
        line("onto an indented continuation line.", 54, 188, 10),
        line("Beta entry begins at the outer edge", 40, 174, 10),
        line("and has its own indented continuation.", 54, 162, 10),
      ],
      [],
    );

    expect(blocks).toMatchObject([
      {
        type: "paragraph",
        text: "Alpha entry begins here and wraps onto an indented continuation line.",
      },
      {
        type: "paragraph",
        text: "Beta entry begins at the outer edge and has its own indented continuation.",
      },
    ]);
  });
});

function line(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily = "Fixture-Regular",
) {
  const value = span(text, x, y, fontSize, fontFamily);
  return textLine(text, y, [value]);
}

function textLine(text: string, y: number, spans: TextSpan[]): TextLine {
  return {
    type: "line",
    text,
    spans,
    bounds: { x: Math.min(...spans.map((item) => item.bounds.x)), y, width: 300, height: 12 },
    confidence: 1,
    reasons: [],
  };
}

function span(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily = "Fixture-Regular",
): TextSpan {
  return {
    text,
    bounds: { x, y, width: text.length * fontSize * 0.5, height: fontSize },
    direction: "ltr",
    fontSize,
    fontFamily,
    source: { page: 1 },
  };
}

function cell(row: number, column: number, value: TextSpan): Table["cells"][number] {
  return {
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    text: value.text,
    spans: [value],
    bounds: value.bounds,
    confidence: 1,
    reasons: [],
  };
}
