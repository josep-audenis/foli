import { describe, expect, it } from "vitest";
import type { MarkJSON } from "../model/index.js";
import type {
  AbstractNumberingJSON,
  FoliDocumentV3,
  NumberingLevelJSON,
  StyleJSON,
} from "./document.js";
import { formatNumber, Resolver } from "./resolve.js";

type Envelope = Pick<FoliDocumentV3, "defaults" | "styles" | "numbering" | "theme">;

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
  defaults: {},
  styles: [],
  numbering: { abstracts: [], instances: [] },
  ...over,
});
const mark = (type: string, attrs?: Record<string, unknown>): MarkJSON =>
  attrs ? { type, attrs } : { type };
const lvl = (level: number, rest: Partial<NumberingLevelJSON> = {}): NumberingLevelJSON => ({
  level,
  format: "decimal",
  text: `%${level + 1}.`,
  ...rest,
});
const markersOf = (env: Envelope, paragraphs: Record<string, unknown>[]) =>
  new Resolver(env).markers(paragraphs).map((m) => m?.text ?? null);

describe("formatNumber", () => {
  it("writes Word's number formats", () => {
    expect(formatNumber(4, "decimal")).toBe("4");
    expect(formatNumber(4, undefined)).toBe("4");
    expect(formatNumber(4, "decimalZero")).toBe("04");
    expect(formatNumber(12, "decimalZero")).toBe("12");
    expect(formatNumber(1994, "upperRoman")).toBe("MCMXCIV");
    expect(formatNumber(49, "lowerRoman")).toBe("xlix");
    expect(formatNumber(4000, "upperRoman")).toBe("4000");
    expect(formatNumber(1, "lowerLetter")).toBe("a");
    expect(formatNumber(26, "upperLetter")).toBe("Z");
    expect(formatNumber(27, "lowerLetter")).toBe("aa");
    expect(formatNumber(53, "upperLetter")).toBe("AAA");
    expect(formatNumber(0, "lowerLetter")).toBe("0");
    expect(formatNumber(1, "ordinal")).toBe("1st");
    expect(formatNumber(2, "ordinal")).toBe("2nd");
    expect(formatNumber(3, "ordinal")).toBe("3rd");
    expect(formatNumber(11, "ordinal")).toBe("11th");
    expect(formatNumber(112, "ordinal")).toBe("112th");
    expect(formatNumber(21, "ordinal")).toBe("21st");
    expect(formatNumber(3, "none")).toBe("");
    expect(formatNumber(3, "chineseCounting")).toBe("3");
  });
});

describe("Resolver: paragraphs", () => {
  const styles: StyleJSON[] = [
    {
      id: "Normal",
      type: "paragraph",
      isDefault: true,
      paragraph: { spacing: { after: 160 } },
      run: [mark("fontSize", { value: 22, complexScript: null })],
    },
    {
      id: "Body",
      type: "paragraph",
      basedOn: "Normal",
      paragraph: {
        indent: { firstLine: 720 },
        tabs: [
          { position: 1440, kind: "left" },
          { position: 2880, kind: "right", leader: "dot" },
        ],
      },
    },
    {
      id: "Quote",
      type: "paragraph",
      basedOn: "Body",
      paragraph: { indent: { hanging: 360, left: 720 }, tabs: [{ position: 1440, kind: "clear" }] },
    },
    { id: "Loop1", type: "paragraph", basedOn: "Loop2", paragraph: { justification: "center" } },
    { id: "Loop2", type: "paragraph", basedOn: "Loop1", paragraph: { justification: "right" } },
    { id: "Strong", type: "character", run: [mark("bold")] },
  ];
  const resolver = new Resolver(
    envelope({ styles, defaults: { paragraph: { spacing: { line: 259, lineRule: "auto" } } } }),
  );

  it("applies the defaults, then the default paragraph style when none is named", () => {
    const { paragraph, run } = resolver.paragraph({});
    expect(paragraph.style).toBe("Normal");
    expect(paragraph.spacing).toMatchObject({ after: 160, line: 259, before: 0 });
    expect(run.size).toBe(22);
    expect(run.sizeCs).toBe(20);
  });

  it("inherits down the basedOn chain, attribute by attribute", () => {
    const { paragraph } = resolver.paragraph({ style: "Quote" });
    expect(paragraph.style).toBe("Quote");
    expect(paragraph.spacing.after).toBe(160);
    // The hanging indent replaces the inherited first-line one.
    expect(paragraph.indent).toEqual({ left: 720, right: 0, firstLine: 0, hanging: 360 });
    // A cleared stop removes the inherited one; the rest stay.
    expect(paragraph.tabs).toEqual([{ position: 2880, kind: "right", leader: "dot" }]);
  });

  it("lets direct formatting win, and a first-line indent replace a hanging one", () => {
    const { paragraph } = resolver.paragraph({
      style: "Quote",
      indent: { firstLine: 100 },
      justification: "both",
    });
    expect(paragraph.indent).toEqual({ left: 720, right: 0, firstLine: 100, hanging: 0 });
    expect(paragraph.justification).toBe("both");
  });

  it("applies the hanging indent when both are given", () => {
    expect(
      resolver.paragraph({ indent: { firstLine: 100, hanging: 200 } }).paragraph.indent,
    ).toMatchObject({
      firstLine: 0,
      hanging: 200,
    });
  });

  it("survives cycles and missing styles", () => {
    expect(resolver.paragraph({ style: "Loop1" }).paragraph.justification).toBe("center");
    const missing = resolver.paragraph({ style: "Nope" }).paragraph;
    expect(missing.style).toBe("Nope");
    expect(missing.spacing.after).toBe(0);
  });

  it("does not let callers change memoized results", () => {
    const first = resolver.paragraph({ style: "Body" });
    first.paragraph.tabs.push({ position: 1, kind: "left", leader: null });
    first.paragraph.indent.left = 99;
    first.run.bold = true;
    const again = resolver.paragraph({ style: "Body" });
    expect(again.paragraph.tabs).toHaveLength(2);
    expect(again.paragraph.indent.left).toBe(0);
    expect(again.run.bold).toBe(false);
  });
});

describe("Resolver: runs", () => {
  const theme = {
    fonts: {
      major: { latin: "Major Sans" },
      minor: { latin: "Minor Serif", eastAsia: "Minor EA", cs: "Minor CS" },
    },
    colors: { dk1: "000000", accent1: "4472C4", dk2: "44546A" },
  };
  const styles: StyleJSON[] = [
    { id: "Normal", type: "paragraph", isDefault: true },
    {
      id: "Heading1",
      type: "paragraph",
      basedOn: "Normal",
      run: [mark("bold"), mark("color", { value: "2F5496" })],
    },
    {
      id: "Heading2",
      type: "paragraph",
      basedOn: "Heading1",
      run: [mark("bold", { value: false, complexScript: null })],
    },
    { id: "Strong", type: "character", run: [mark("bold")] },
    { id: "Stronger", type: "character", basedOn: "Strong", run: [mark("italic")] },
  ];
  const resolver = new Resolver(
    envelope({
      styles,
      theme,
      defaults: {
        run: [
          mark("font", {
            asciiTheme: "minorHAnsi",
            hAnsiTheme: "minorHAnsi",
            eastAsiaTheme: "minorEastAsia",
            csTheme: "minorBidi",
          }),
        ],
      },
    }),
  );
  const run = (style: string | undefined, marks: MarkJSON[]) =>
    resolver.run(resolver.paragraph(style ? { style } : {}).run, marks);

  it("uses Word's defaults when nothing is said", () => {
    const plain = new Resolver(envelope()).run(new Resolver(envelope()).paragraph({}).run, []);
    expect(plain).toMatchObject({
      size: 20,
      bold: false,
      font: { ascii: null },
      color: null,
      verticalAlign: "baseline",
    });
  });

  it("resolves theme fonts per script", () => {
    expect(run(undefined, []).font).toEqual({
      ascii: "Minor Serif",
      hAnsi: "Minor Serif",
      eastAsia: "Minor EA",
      cs: "Minor CS",
    });
    expect(
      run(undefined, [
        mark("font", { asciiTheme: "majorAscii", hAnsiTheme: null, ascii: null, hAnsi: "Direct" }),
      ]).font,
    ).toMatchObject({
      ascii: "Major Sans",
      hAnsi: "Direct",
      // Scripts a mark does not name keep what they had.
      eastAsia: "Minor EA",
    });
  });

  it("flips toggles between the paragraph and character styles; direct values are absolute", () => {
    expect(run("Heading1", []).bold).toBe(true);
    // A bold character style on a bold heading: plain.
    expect(run("Heading1", [mark("characterStyle", { id: "Strong" })]).bold).toBe(false);
    expect(run(undefined, [mark("characterStyle", { id: "Strong" })]).bold).toBe(true);
    // Within a chain a style overrides what it is based on (no flip): Stronger is bold and italic.
    expect(run(undefined, [mark("characterStyle", { id: "Stronger" })])).toMatchObject({
      bold: true,
      italic: true,
    });
    expect(run("Heading2", []).bold).toBe(false);
    // Direct formatting sets.
    expect(run("Heading1", [mark("bold")]).bold).toBe(true);
    expect(run("Heading1", [mark("characterStyle", { id: "Strong" }), mark("bold")]).bold).toBe(
      true,
    );
    expect(run("Heading1", [mark("bold", { value: false, complexScript: null })]).bold).toBe(false);
  });

  it("keeps complex-script bold apart", () => {
    const cs = run(undefined, [mark("bold", { value: null, complexScript: true })]);
    expect(cs).toMatchObject({ bold: false, boldCs: true });
    expect(run(undefined, [mark("bold")])).toMatchObject({ bold: true, boldCs: false });
    // Complex-script bold alone leaves bold as the style has it.
    expect(run("Heading1", [mark("bold", { value: null, complexScript: true })]).bold).toBe(true);
  });

  it("resolves colors, theme colors first", () => {
    expect(run("Heading1", []).color).toBe("2F5496");
    expect(run(undefined, [mark("color", { value: "ff0000", themeColor: null })]).color).toBe(
      "FF0000",
    );
    expect(run(undefined, [mark("color", { value: "FF0000", themeColor: "accent1" })]).color).toBe(
      "4472C4",
    );
    expect(run(undefined, [mark("color", { value: "FF0000", themeColor: "text2" })]).color).toBe(
      "44546A",
    );
    expect(run("Heading1", [mark("color", { value: "auto" })]).color).toBeNull();
  });

  it("reads the other run properties", () => {
    const r = run(undefined, [
      mark("underline", { style: "double", color: "00FF00" }),
      mark("fontSize", { value: 28, complexScript: 30 }),
      mark("highlight", { value: "yellow" }),
      mark("shading", { pattern: "clear", color: "auto", fill: "d9d9d9" }),
      mark("verticalAlign", { value: "superscript" }),
      mark("characterSpacing", { value: -20 }),
      mark("caps"),
      mark("hidden", { value: true }),
    ]);
    expect(r).toMatchObject({
      underline: "double",
      underlineColor: "00FF00",
      size: 28,
      sizeCs: 30,
      highlight: "yellow",
      shading: "D9D9D9",
      verticalAlign: "superscript",
      characterSpacing: -20,
      caps: true,
      hidden: true,
    });
    expect(
      run(undefined, [mark("underline", { style: "none", color: null })]).underline,
    ).toBeNull();
    expect(run(undefined, [mark("highlight", { value: "none" })]).highlight).toBeNull();
  });
});

describe("Resolver: list markers", () => {
  const legal: AbstractNumberingJSON = {
    id: 1,
    levels: [
      lvl(0, { start: 1 }),
      lvl(1, { start: 1, text: "%1.%2" }),
      lvl(2, { start: 1, format: "lowerLetter", text: "(%3)" }),
      lvl(3, { start: 1, format: "lowerRoman", text: "(%4)", restart: 1 }),
    ],
  };
  const numbering = (
    abstracts: AbstractNumberingJSON[],
    instances: FoliDocumentV3["numbering"]["instances"],
  ) => ({
    abstracts,
    instances,
  });
  const at = (id: number, level: number) => ({ numbering: { id, level } });

  it("counts levels and restarts deeper ones after a higher level", () => {
    const env = envelope({ numbering: numbering([legal], [{ id: 5, abstract: 1 }]) });
    expect(
      markersOf(env, [
        at(5, 0),
        at(5, 1),
        at(5, 2),
        at(5, 2),
        at(5, 1),
        at(5, 2),
        {},
        at(5, 0),
        at(5, 1),
      ]),
    ).toEqual(["1.", "1.1", "(a)", "(b)", "1.2", "(a)", null, "2.", "2.1"]);
  });

  it("restarts a level only after the level its `restart` names", () => {
    const env = envelope({ numbering: numbering([legal], [{ id: 5, abstract: 1 }]) });
    // Level 4 restarts after level 1 only: a level-2 paragraph between does not restart it.
    expect(
      markersOf(env, [at(5, 0), at(5, 3), at(5, 3), at(5, 1), at(5, 3), at(5, 0), at(5, 3)]),
    ).toEqual(["1.", "(i)", "(ii)", "1.1", "(iii)", "2.", "(i)"]);
    const never = {
      ...legal,
      levels: legal.levels.map((l) => (l.level === 3 ? { ...l, restart: 0 } : l)),
    };
    expect(
      markersOf(envelope({ numbering: numbering([never], [{ id: 5, abstract: 1 }]) }), [
        at(5, 0),
        at(5, 3),
        at(5, 0),
        at(5, 3),
      ]),
    ).toEqual(["1.", "(i)", "2.", "(ii)"]);
  });

  it("shows an unused higher level at its start", () => {
    const env = envelope({ numbering: numbering([legal], [{ id: 5, abstract: 1 }]) });
    expect(markersOf(env, [at(5, 1)])).toEqual(["1.1"]);
    const fromThree = { ...legal, levels: [lvl(0, { start: 3 }), ...legal.levels.slice(1)] };
    expect(
      markersOf(envelope({ numbering: numbering([fromThree], [{ id: 5, abstract: 1 }]) }), [
        at(5, 1),
      ]),
    ).toEqual(["3.1"]);
  });

  it("inherits the level and the instance separately down the style chain", () => {
    const styles: StyleJSON[] = [
      { id: "Parent", type: "paragraph", paragraph: { numbering: { id: 5, level: 1 } } },
      { id: "Child", type: "paragraph", basedOn: "Parent", paragraph: { numbering: { id: 6 } } },
    ];
    const env = envelope({
      styles,
      numbering: numbering(
        [legal],
        [
          { id: 5, abstract: 1 },
          { id: 6, abstract: 1 },
        ],
      ),
    });
    expect(new Resolver(env).paragraph({ style: "Child" }).paragraph.numbering).toEqual({
      id: 6,
      level: 1,
    });
  });

  it("continues across instances of one definition; a start override restarts once", () => {
    const env = envelope({
      numbering: numbering(
        [legal],
        [
          { id: 5, abstract: 1 },
          { id: 6, abstract: 1 },
          { id: 7, abstract: 1, overrides: [{ level: 0, start: 1 }] },
        ],
      ),
    });
    expect(markersOf(env, [at(5, 0), at(6, 0), at(7, 0), at(7, 0), at(5, 0)])).toEqual([
      "1.",
      "2.",
      "1.",
      "2.",
      "3.",
    ]);
  });

  it("uses an override's level definition", () => {
    const env = envelope({
      numbering: numbering(
        [legal],
        [
          {
            id: 5,
            abstract: 1,
            overrides: [
              { level: 0, definition: lvl(0, { start: 4, format: "upperRoman", text: "Art. %1" }) },
            ],
          },
        ],
      ),
    });
    expect(markersOf(env, [at(5, 0), at(5, 0), at(5, 1)])).toEqual(["Art. IV", "Art. V", "V.1"]);
  });

  it("writes every level as a number in a legal level", () => {
    const abstract: AbstractNumberingJSON = {
      id: 1,
      levels: [
        lvl(0, { format: "upperRoman", start: 1 }),
        lvl(1, { start: 1, text: "%1.%2", legal: true }),
      ],
    };
    const env = envelope({ numbering: numbering([abstract], [{ id: 5, abstract: 1 }]) });
    expect(markersOf(env, [at(5, 0), at(5, 0), at(5, 1)])).toEqual(["I.", "II.", "2.1"]);
  });

  it("numbers styles: the level that names the style, the style's indents over the level's", () => {
    const abstract: AbstractNumberingJSON = {
      id: 1,
      levels: [
        lvl(0, { start: 1, style: "H1", paragraph: { indent: { left: 432, hanging: 432 } } }),
        lvl(1, {
          start: 1,
          style: "H2",
          text: "%1.%2",
          paragraph: { indent: { left: 576, hanging: 576 } },
        }),
      ],
    };
    const styles: StyleJSON[] = [
      { id: "H1", type: "paragraph", paragraph: { numbering: { id: 5 } } },
      { id: "H2", type: "paragraph", basedOn: "H1", paragraph: { indent: { left: 0 } } },
    ];
    const env = envelope({ styles, numbering: numbering([abstract], [{ id: 5, abstract: 1 }]) });
    expect(
      markersOf(env, [{ style: "H1" }, { style: "H2" }, { style: "H2" }, { style: "H1" }]),
    ).toEqual(["1.", "1.1", "1.2", "2."]);
    const resolver = new Resolver(env);
    expect(resolver.paragraph({ style: "H1" }).paragraph.indent).toMatchObject({
      left: 432,
      hanging: 432,
    });
    // H2's own left indent wins over its level's; the level's hanging stays.
    expect(resolver.paragraph({ style: "H2" }).paragraph.indent).toMatchObject({
      left: 0,
      hanging: 576,
    });
    expect(resolver.paragraph({ style: "H2" }).paragraph.numbering).toEqual({ id: 5, level: 1 });
    // Direct numbering: the level's indents win over the style's, direct ones over both.
    expect(
      resolver.paragraph({ style: "H2", numbering: { id: 5, level: 1 } }).paragraph.indent,
    ).toMatchObject({ left: 576 });
    expect(
      resolver.paragraph({ style: "H2", numbering: { id: 5, level: 1 }, indent: { left: 7 } })
        .paragraph.indent,
    ).toMatchObject({
      left: 7,
    });
    // numId 0 takes numbering away.
    expect(markersOf(env, [{ style: "H1", numbering: { id: 0 } }])).toEqual([null]);
  });

  it("follows a numbering style's link, and ignores missing definitions", () => {
    const real: AbstractNumberingJSON = {
      id: 1,
      styleLink: "Outline",
      levels: [lvl(0, { start: 3 })],
    };
    const linked: AbstractNumberingJSON = { id: 2, numStyleLink: "Outline", levels: [] };
    const styles: StyleJSON[] = [
      { id: "Outline", type: "numbering", paragraph: { numbering: { id: 9 } } },
    ];
    const env = envelope({
      styles,
      numbering: numbering(
        [real, linked],
        [
          { id: 9, abstract: 1 },
          { id: 10, abstract: 2 },
          { id: 11, abstract: 99 },
        ],
      ),
    });
    expect(markersOf(env, [at(10, 0), at(9, 0), at(11, 0), at(12, 0), at(10, 7)])).toEqual([
      "3.",
      "4.",
      null,
      null,
      null,
    ]);
  });

  it("gives bullets as written, and no text for format none", () => {
    const abstract: AbstractNumberingJSON = {
      id: 1,
      levels: [
        lvl(0, { format: "bullet", text: "", suffix: "space", justification: "right" }),
        lvl(1, { format: "none", text: "%2." }),
      ],
    };
    const env = envelope({ numbering: numbering([abstract], [{ id: 5, abstract: 1 }]) });
    const [bullet, none] = new Resolver(env).markers([at(5, 0), at(5, 1)]);
    expect(bullet).toMatchObject({
      text: "",
      suffix: "space",
      justification: "right",
      instance: 5,
      level: 0,
    });
    expect(none).toMatchObject({ text: "", suffix: "tab", justification: "left" });
  });

  it("formats the marker: the paragraph's run, its mark's, then the level's", () => {
    const abstract: AbstractNumberingJSON = {
      id: 1,
      levels: [lvl(0, { run: [mark("font", { ascii: "Symbol", hAnsi: "Symbol" })] })],
    };
    const styles: StyleJSON[] = [
      {
        id: "Normal",
        type: "paragraph",
        isDefault: true,
        run: [mark("fontSize", { value: 24, complexScript: null })],
      },
    ];
    const env = envelope({ styles, numbering: numbering([abstract], [{ id: 5, abstract: 1 }]) });
    const [m] = new Resolver(env).markers([
      { ...at(5, 0), markFormat: [mark("bold"), mark("font", { ascii: "Arial" })] },
    ]);
    expect(m?.run).toMatchObject({
      size: 24,
      bold: true,
      font: { ascii: "Symbol", hAnsi: "Symbol" },
    });
  });
});
