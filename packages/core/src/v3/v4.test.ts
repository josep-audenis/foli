import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { parseContent, parseDocument, type StyleJSON } from "./document.js";
import { Resolver, tableConditions } from "./resolve.js";

/** Schema v4 (ADR-0006): tables, pictures and the envelope's resources. */

const p = (text?: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const cell = (content: NodeJSON[] = [p("x")], attrs?: Record<string, unknown>): NodeJSON => ({
  type: "tableCell",
  ...(attrs ? { attrs } : {}),
  content,
});
const row = (...cells: NodeJSON[]): NodeJSON => ({ type: "tableRow", content: cells });
const table = (rows: NodeJSON[], attrs?: Record<string, unknown>): NodeJSON => ({
  type: "table",
  ...(attrs ? { attrs } : {}),
  content: rows,
});
const doc = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const envelope = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  section: {},
  defaults: {},
  styles: [],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: doc(p()),
  ...overrides,
});

describe("tables in the model", () => {
  it("holds rows of cells with Word's properties, and round-trips them", () => {
    const json = doc(
      table(
        [
          {
            type: "tableRow",
            attrs: {
              header: true,
              cantSplit: true,
              height: { value: 400, rule: "atLeast" },
              revision: { insertion: { id: 3, author: "A" } },
              exceptions: { shading: { pattern: "clear", fill: "EEEEEE" } },
            },
            content: [cell([p("a")], { gridSpan: 2, vMerge: "restart", verticalAlign: "center" })],
          },
          row(
            cell([p("b")], { vMerge: "continue" }),
            cell([table([row(cell())]), p("after the nested table")]),
          ),
        ],
        {
          style: "TableGrid",
          width: { value: 5000, type: "pct" },
          layout: "fixed",
          look: { firstRow: true, noVBand: true },
          borders: { insideH: { style: "single", size: 4 } },
          grid: [2000, 3000],
        },
      ),
      p("after"),
    );
    const parsed = parseContent(json);
    expect(parsed.toJSON()).toEqual(parseContent(parsed.toJSON()).toJSON());
    const first = parsed.child(0);
    expect(first.type.name).toBe("table");
    expect(first.attrs.grid).toEqual([2000, 3000]);
    expect(first.child(0).attrs.header).toBe(true);
    expect(first.child(0).child(0).attrs.gridSpan).toBe(2);
    expect(first.child(1).child(1).child(0).type.name).toBe("table");
  });

  it("rejects what Word cannot hold", () => {
    const bad: [NodeJSON, RegExp][] = [
      // A cell ends with a paragraph.
      [doc(table([row(cell([p("x"), table([row(cell())])]))]), p()), /content/],
      [doc(table([row(cell([]))]), p()), /content/],
      [doc(table([])), /content/],
      // Two tables in a row would merge in Word; the body does not end with one.
      [doc(table([row(cell())]), table([row(cell())]), p()), /cannot follow a table/],
      [doc(p(), table([row(cell())])), /cannot end the document/],
      [doc(table([row(cell([table([row(cell())]), table([row(cell())]), p()]))]), p()), /follow/],
      // A paragraph in a cell ends no section and holds no page or column break.
      [doc(table([row(cell([p("x", { section: {} })]))]), p()), /cannot end a section/],
      [
        doc(table([row(cell([{ type: "paragraph", content: [{ type: "pageBreak" }] }]))]), p()),
        /pageBreak cannot be in a table/,
      ],
      [
        doc(
          table([
            row(
              cell([
                table([row(cell([{ type: "paragraph", content: [{ type: "columnBreak" }] }]))]),
                p(),
              ]),
            ),
          ]),
          p(),
        ),
        /content\[0\]\.content\[0\]\.content\[0\]\.content\[0\]\.content\[0\]\.content\[0\]\.content\[0\]/,
      ],
      // Properties are checked.
      [doc(table([row(cell([p()], { gridSpan: 0 }))]), p()), /gridSpan/],
      [doc(table([row(cell([p()], { vMerge: "down" }))]), p()), /vMerge/],
      [doc(table([row(cell())], { width: { value: 1, type: "inch" } }), p()), /width/],
      [doc(table([row(cell())], { grid: [-1] }), p()), /grid/],
      // Rows and cells only where they belong.
      [doc(row(cell())), /content/],
      [
        doc({ type: "paragraph", content: [{ type: "tableCell", content: [p()] }] }),
        /content|inline/,
      ],
    ];
    for (const [json, message] of bad) {
      expect(() => parseContent(json), JSON.stringify(json)).toThrow(message);
    }
  });

  it("allows a table followed by opaque content, and a body that ends with it (as v3 did)", () => {
    const opaque = { type: "opaqueBlock", attrs: { xml: "<w:sdt/>" } };
    expect(() => parseContent(doc(table([row(cell())]), opaque))).not.toThrow();
  });
});

describe("pictures in the model", () => {
  const picture = (attrs: Record<string, unknown>) =>
    doc({
      type: "paragraph",
      content: [
        { type: "picture", attrs: { resource: "r1", width: 914400, height: 457200, ...attrs } },
      ],
    });

  it("holds inline and floating pictures, alt text optional", () => {
    expect(() => parseContent(picture({}))).not.toThrow();
    expect(() => parseContent(picture({ alt: "A chart", decorative: false }))).not.toThrow();
    const floating = parseContent(
      picture({
        float: {
          horizontal: { relativeTo: "column", offset: 3810000 },
          vertical: { relativeTo: "paragraph", align: "top" },
          wrap: "square",
          side: "bothSides",
          distance: { left: 114300, right: 114300 },
        },
      }),
    );
    expect(floating.child(0).child(0).attrs.float).toMatchObject({ wrap: "square" });
  });

  it("rejects pictures it cannot place", () => {
    expect(() => parseContent(picture({ resource: "" }))).toThrow(/resource/);
    expect(() => parseContent(picture({ width: -1 }))).toThrow(/width/);
    expect(() =>
      parseContent(
        picture({
          float: {
            horizontal: { relativeTo: "page" },
            vertical: { relativeTo: "page" },
            wrap: "around",
          },
        }),
      ),
    ).toThrow(/wrap/);
    expect(() => parseContent(picture({ float: { wrap: "square" } }))).toThrow(/horizontal/);
  });
});

describe("the envelope's resources", () => {
  it("are kept, and checked", () => {
    const resources = {
      r1: { contentType: "image/png", part: "word/media/image1.png", size: 1024 },
      r2: { contentType: "image/svg+xml", url: "https://example.test/a.svg" },
      r3: { contentType: "image/png", data: "data:image/png;base64,AAAA" },
      r4: { contentType: "image/jpeg", url: "media/photo.jpg" },
      r5: { contentType: "image/jpeg", url: "blob:https://example.test/1234" },
    };
    expect(parseDocument(envelope({ resources })).resources).toEqual(resources);
    expect(parseDocument(envelope())).not.toHaveProperty("resources");
    const bad: [unknown, RegExp][] = [
      [{ r: { contentType: "image/png" } }, /needs part, url or data/],
      [{ r: { contentType: "png", part: "x" } }, /image media type/],
      [{ r: { contentType: "text/html", part: "x" } }, /image media type/],
      [{ r: { contentType: "image/png", data: "https://x" } }, /data: URL/],
      [{ r: { contentType: "image/png", data: "data:text/html,<p>" } }, /data: URL of an image/],
      [{ r: { contentType: "image/png", url: "javascript:alert(1)" } }, /relative, http\(s\)/],
      [{ r: { contentType: "image/png", url: "file:///c:/x.png" } }, /relative, http\(s\)/],
      // As a browser reads them: leading spaces and controls dropped, tabs removed.
      [{ r: { contentType: "image/png", url: " javascript:alert(1)" } }, /relative, http\(s\)/],
      [{ r: { contentType: "image/png", url: "java\tscript:alert(1)" } }, /relative, http\(s\)/],
      [{ r: { contentType: "image/png", url: "\u0001javascript:x" } }, /relative, http\(s\)/],
      [{ r: { contentType: "image/png", url: "http://[" } }, /relative, http\(s\)/],
      [{ r: { contentType: "image/png", part: "x", extra: 1 } }, /unknown key extra/],
      [
        JSON.parse('{"__proto__": {"contentType": "image/png", "part": "x"}}'),
        /not a resource key/,
      ],
      [[], /must be an object/],
    ];
    for (const [value, message] of bad) {
      expect(() => parseDocument(envelope({ resources: value }))).toThrow(message);
    }
  });
});

describe("schema v3 → v4", () => {
  it("changes the version only", () => {
    const v3 = envelope({ schemaVersion: 3, content: doc(p("kept")) });
    const migrated = parseDocument(v3);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated).toEqual({ ...parseDocument(envelope({ content: doc(p("kept")) })) });
  });

  it("refuses schema 4 content in a document that says schema 3", () => {
    const withTable = envelope({ schemaVersion: 3, content: doc(table([row(cell())]), p()) });
    expect(() => parseDocument(withTable)).toThrow(/table is a schema 4 node/);
    const inComment = envelope({
      schemaVersion: 3,
      comments: [
        {
          id: 0,
          author: "A",
          content: [
            {
              type: "paragraph",
              content: [{ type: "picture", attrs: { resource: "r", width: 1, height: 1 } }],
            },
          ],
        },
      ],
    });
    expect(() => parseDocument(inComment)).toThrow(/comments\[0\]\.content: picture/);
    expect(() => parseDocument(envelope({ schemaVersion: 3, resources: {} }))).toThrow(
      /resources: unknown key/,
    );
    const tableStyle = { id: "T", type: "table", conditions: [{ type: "firstRow" }] };
    expect(() => parseDocument(envelope({ schemaVersion: 3, styles: [tableStyle] }))).toThrow(
      /styles\[0\]: unknown key conditions/,
    );
  });
});

describe("deep nesting", () => {
  it("is refused with a path, not a stack overflow", () => {
    let content: NodeJSON = p("x");
    for (let i = 0; i < 2000; i++) content = table([row(cell([content]))]);
    // Each level a table, a row and a cell; the innermost cell is never reached.
    const nested = doc(table([row(cell([content, p()]))]), p());
    expect(() => parseContent(nested)).toThrow(/nested deeper than 300 levels/);
    expect(() => parseDocument(envelope({ content: nested }))).toThrow(/nested deeper/);
    let inline: unknown = { type: "text", text: "x" };
    for (let i = 0; i < 5000; i++) inline = { type: "paragraph", content: [inline] };
    expect(() => parseContent(doc(inline as NodeJSON))).toThrow(/nested deeper/);
    let ok: NodeJSON = p("x");
    for (let i = 0; i < 50; i++) ok = table([row(cell([ok, p()]))]);
    expect(() => parseContent(doc(ok, p()))).not.toThrow();
  });
});

describe("table styles", () => {
  const style: StyleJSON = {
    id: "Banded",
    type: "table",
    basedOn: "TableNormal",
    paragraph: { spacing: { after: 0 } },
    run: [{ type: "fontSize", attrs: { value: 18 } }],
    table: {
      borders: {
        top: { style: "single", size: 8 },
        bottom: { style: "single", size: 8 },
        insideH: { style: "single", size: 4 },
      },
      rowBandSize: 1,
    },
    cell: { shading: { pattern: "clear", fill: "FFFFFF" } },
    conditions: [
      { type: "band1Horz", cell: { shading: { pattern: "clear", fill: "DDDDDD" } } },
      {
        type: "firstRow",
        run: [{ type: "bold" }],
        paragraph: { justification: "center" },
        cell: {
          shading: { pattern: "clear", fill: "4472C4" },
          borders: { bottom: { style: "double", size: 6 } },
        },
      },
      { type: "nwCell", cell: { verticalAlign: "bottom" } },
    ],
  };
  const normalTable: StyleJSON = {
    id: "TableNormal",
    type: "table",
    isDefault: true,
    table: {
      cellMargins: { left: { value: 108, type: "dxa" }, right: { value: 108, type: "dxa" } },
    },
  };
  const styles: StyleJSON[] = [
    { id: "Normal", type: "paragraph", isDefault: true, paragraph: { spacing: { after: 160 } } },
    { id: "Heading1", type: "paragraph", run: [{ type: "fontSize", attrs: { value: 32 } }] },
    normalTable,
    style,
  ];

  it("are validated with their conditional formats", () => {
    expect(() => parseDocument(envelope({ styles }))).not.toThrow();
    const bad = [{ ...style, conditions: [{ type: "middle" }] }];
    expect(() => parseDocument(envelope({ styles: bad }))).toThrow(/conditions/);
    const wrongTable = [{ ...style, table: { layout: "stretch" } }];
    expect(() => parseDocument(envelope({ styles: wrongTable }))).toThrow(/layout/);
  });

  it("apply the parts of the style where the cell is, in Word's order", () => {
    const look = { firstRow: true, firstColumn: true, noVBand: true };
    const place = (row: number, cell: number) => ({ row, rows: 4, cell, cells: 3 });
    expect(tableConditions(look, place(0, 0))).toEqual([
      "wholeTable",
      "firstCol",
      "firstRow",
      "nwCell",
    ]);
    // Banding starts after the header row.
    expect(tableConditions(look, place(1, 1))).toEqual(["wholeTable", "band1Horz"]);
    expect(tableConditions(look, place(2, 1))).toEqual(["wholeTable", "band2Horz"]);
    // Bands of two rows: rows 1 and 2, then 3.
    expect(tableConditions(look, place(2, 1), 2)).toEqual(["wholeTable", "band1Horz"]);
    expect(tableConditions(look, place(3, 1), 2)).toEqual(["wholeTable", "band2Horz"]);
    expect(tableConditions({ lastRow: true, lastColumn: true }, place(3, 2))).toEqual([
      "wholeTable",
      "lastCol",
      "lastRow",
      "seCell",
    ]);
    // Without a first row or column, banding counts from the first.
    expect(tableConditions({}, place(1, 1))).toEqual(["wholeTable", "band2Vert", "band2Horz"]);
    expect(tableConditions({}, place(0, 0))).toEqual(["wholeTable", "band1Vert", "band1Horz"]);
  });

  it("give each cell its shading, borders, margins and alignment", () => {
    const resolver = new Resolver(parseDocument(envelope({ styles })));
    const attrs = { style: "Banded", look: { firstRow: true, noVBand: true } };
    const header = resolver.cell(attrs, {}, {}, { row: 0, rows: 3, cell: 0, cells: 2 });
    expect(header.style).toBe("Banded");
    expect(header.shading).toBe("4472C4");
    expect(header.borders.top).toEqual({ style: "single", size: 8 });
    expect(header.borders.bottom).toEqual({ style: "double", size: 6 });
    // From the style it is based on (the default table style).
    expect(header.margins).toEqual({ top: 0, bottom: 0, left: 108, right: 108 });
    // nwCell needs the first column on.
    expect(header.verticalAlign).toBe("top");
    const band = resolver.cell(attrs, {}, {}, { row: 1, rows: 3, cell: 1, cells: 2 });
    expect(band.shading).toBe("DDDDDD");
    expect(band.borders.top).toEqual({ style: "single", size: 4 });
    expect(band.borders.left).toBeUndefined();
    // The cell's own properties and the row's exceptions win over the style.
    const own = resolver.cell(
      { ...attrs, cellMargins: { left: { value: 50, type: "dxa" } } },
      { exceptions: { borders: { insideH: { style: "dotted" } } } },
      { shading: { pattern: "clear", fill: "ff0000" }, verticalAlign: "center" },
      { row: 2, rows: 3, cell: 0, cells: 2 },
    );
    expect(own.shading).toBe("FF0000");
    expect(own.verticalAlign).toBe("center");
    expect(own.margins.left).toBe(50);
    expect(own.borders.top).toEqual({ style: "dotted" });
    expect(own.borders.bottom).toEqual({ style: "single", size: 8 });
    // No style named: the default table style.
    expect(resolver.cell({}, {}, {}, { row: 0, rows: 1, cell: 0, cells: 1 }).style).toBe(
      "TableNormal",
    );
    // Results are the caller's: changing them changes neither the styles nor later results.
    const before = structuredClone(styles);
    const changed = resolver.cell(attrs, {}, {}, { row: 0, rows: 3, cell: 0, cells: 2 });
    (changed.borders.top as { size?: number }).size = 99;
    const props = resolver.table({ style: "Banded", borders: { left: { style: "single" } } });
    (props.borders?.insideH as { size?: number }).size = 99;
    (props.borders?.left as { style: string }).style = "dotted";
    expect(styles).toEqual(before);
    expect(resolver.cell(attrs, {}, {}, { row: 0, rows: 3, cell: 0, cells: 2 })).toEqual(header);
    expect(resolver.table({ style: "Banded", layout: "fixed" })).toMatchObject({
      style: "Banded",
      layout: "fixed",
      rowBandSize: 1,
      cellMargins: { left: { value: 108, type: "dxa" } },
    });
  });

  it("format the paragraphs in a cell between the defaults and their own style", () => {
    const resolver = new Resolver(parseDocument(envelope({ styles })));
    const attrs = { style: "Banded", look: { firstRow: true } };
    const header = resolver.cell(attrs, {}, {}, { row: 0, rows: 2, cell: 0, cells: 1 });
    const inHeader = resolver.paragraph({}, header);
    expect(inHeader.run.bold).toBe(true);
    expect(inHeader.paragraph.justification).toBe("center");
    // Normal's spacing comes after the table style's.
    expect(inHeader.paragraph.spacing.after).toBe(160);
    expect(inHeader.run.size).toBe(18);
    // A paragraph style's own size wins over the table style's.
    expect(resolver.paragraph({ style: "Heading1" }, header).run.size).toBe(32);
    const body = resolver.cell(attrs, {}, {}, { row: 1, rows: 2, cell: 0, cells: 1 });
    expect(resolver.paragraph({}, body).run.bold).toBe(false);
    // Outside a table, nothing of it.
    expect(resolver.paragraph({}).run.size).toBe(20);
  });
});
