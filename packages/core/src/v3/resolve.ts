/**
 * How a schema v3 document looks: the effective paragraph and run formatting Word computes from
 * the document defaults, the styles and direct formatting (ECMA-376 Part 1, 17.7.2), and the
 * list markers numbering gives paragraphs (17.9). No DOM: the view turns these into CSS.
 */

import type { MarkJSON } from "../model/index.js";
import type {
  AbstractNumberingJSON,
  FoliDocumentV3,
  NumberingInstanceJSON,
  NumberingLevelJSON,
  ParagraphPropertiesJSON,
  StyleJSON,
  ThemeJSON,
} from "./document.js";

type Json = Record<string, unknown>;

/** Effective run formatting: what a run looks like after defaults, styles and direct marks. */
export interface RunFormat {
  bold: boolean;
  /** Bold for complex scripts (`w:bCs`). */
  boldCs: boolean;
  italic: boolean;
  italicCs: boolean;
  caps: boolean;
  smallCaps: boolean;
  strike: boolean;
  doubleStrike: boolean;
  hidden: boolean;
  /** Underline style (`single`, `double`…); null for none. */
  underline: string | null;
  underlineColor: string | null;
  /** Font names per script, theme fonts resolved; null where nothing names one. */
  font: { ascii: string | null; hAnsi: string | null; eastAsia: string | null; cs: string | null };
  /** Half-points (Word's default without any: 20, 10 pt). */
  size: number;
  sizeCs: number;
  /** `RRGGBB` (theme colors resolved); null for automatic. */
  color: string | null;
  highlight: string | null;
  /** Shading fill `RRGGBB`; null for none. */
  shading: string | null;
  verticalAlign: "baseline" | "superscript" | "subscript";
  /** Twips. */
  characterSpacing: number;
}

/** Effective paragraph properties: a paragraph's attributes after defaults, styles and numbering. */
export interface ParagraphFormat {
  /** The paragraph style that applies (the default paragraph style when none is named). */
  style: string | null;
  justification: string | null;
  /** Twips. Only one of `firstLine` and `hanging` is non-zero. */
  indent: { left: number; right: number; firstLine: number; hanging: number };
  spacing: {
    before: number;
    after: number;
    line: number | null;
    lineRule: "auto" | "exact" | "atLeast";
    beforeAutospacing: boolean;
    afterAutospacing: boolean;
  };
  keepNext: boolean;
  keepLines: boolean;
  widowControl: boolean;
  pageBreakBefore: boolean;
  contextualSpacing: boolean;
  outlineLevel: number | null;
  tabs: { position: number; kind: string; leader: string | null }[];
  borders: NonNullable<ParagraphPropertiesJSON["borders"]> | null;
  shading: ParagraphPropertiesJSON["shading"] | null;
  /** The numbering that applies (direct, or from the style): instance id and level. */
  numbering: { id: number; level: number } | null;
}

/** A paragraph's list marker. */
export interface ListMarker {
  /** As Word shows it ("1.", "1.1", "(a)", or a bullet's character as the file has it). */
  text: string;
  /** What follows the marker. */
  suffix: "tab" | "space" | "nothing";
  justification: string;
  /** The marker's formatting: the paragraph's, its mark's, then the level's run properties. */
  run: RunFormat;
  instance: number;
  level: number;
}

const TOGGLES = [
  "bold",
  "boldCs",
  "italic",
  "italicCs",
  "caps",
  "smallCaps",
  "strike",
  "doubleStrike",
  "hidden",
] as const;
type Toggle = (typeof TOGGLES)[number];

const DEFAULT_RUN: RunFormat = {
  bold: false,
  boldCs: false,
  italic: false,
  italicCs: false,
  caps: false,
  smallCaps: false,
  strike: false,
  doubleStrike: false,
  hidden: false,
  underline: null,
  underlineColor: null,
  font: { ascii: null, hAnsi: null, eastAsia: null, cs: null },
  size: 20,
  sizeCs: 20,
  color: null,
  highlight: null,
  shading: null,
  verticalAlign: "baseline",
  characterSpacing: 0,
};

/** While merging, the numbering level may be unknown (a style naming only the instance). */
type Merging = Omit<ParagraphFormat, "numbering"> & {
  numbering: { id: number; level: number | undefined } | null;
};

const DEFAULT_PARAGRAPH: Merging = {
  style: null,
  justification: null,
  indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  spacing: {
    before: 0,
    after: 0,
    line: null,
    lineRule: "auto",
    beforeAutospacing: false,
    afterAutospacing: false,
  },
  keepNext: false,
  keepLines: false,
  widowControl: false,
  pageBreakBefore: false,
  contextualSpacing: false,
  outlineLevel: null,
  tabs: [],
  borders: null,
  shading: null,
  numbering: null,
};

const PLAIN_KEYS = new Set([
  "justification",
  "keepNext",
  "keepLines",
  "widowControl",
  "pageBreakBefore",
  "contextualSpacing",
  "outlineLevel",
  "shading",
]);

/** Paragraph properties merged in order, later winning, attribute by attribute as Word inherits them. */
function mergeParagraph(target: Merging, props: ParagraphPropertiesJSON | undefined): void {
  if (!props) return;
  const { indent, spacing, numbering, borders, tabs } = props;
  if (indent) {
    // A first-line indent and a hanging one are one value: setting one replaces the other.
    if (indent.firstLine !== undefined) target.indent.hanging = 0;
    Object.assign(target.indent, indent);
    // With both, Word applies the hanging indent.
    if (target.indent.hanging) target.indent.firstLine = 0;
  }
  if (spacing) Object.assign(target.spacing, spacing);
  if (numbering) {
    target.numbering = {
      id: numbering.id ?? target.numbering?.id ?? 0,
      level: numbering.level ?? target.numbering?.level,
    };
  }
  if (borders) target.borders = { ...target.borders, ...borders };
  if (tabs) {
    // Tab stops accumulate down the styles; a `clear` stop removes an inherited one.
    const stops = new Map(target.tabs.map((t) => [t.position, t]));
    for (const t of tabs) {
      if (t.kind === "clear") stops.delete(t.position);
      else stops.set(t.position, { position: t.position, kind: t.kind, leader: t.leader ?? null });
    }
    target.tabs = [...stops.values()].sort((a, b) => a.position - b.position);
  }
  for (const [key, value] of Object.entries(props)) {
    if (PLAIN_KEYS.has(key) && value !== undefined) (target as unknown as Json)[key] = value;
  }
}

function cloneParagraph(p: Merging): Merging {
  return {
    ...p,
    indent: { ...p.indent },
    spacing: { ...p.spacing },
    tabs: [...p.tabs],
    borders: p.borders ? { ...p.borders } : null,
    numbering: p.numbering ? { ...p.numbering } : null,
  };
}

function cloneRun(r: RunFormat): RunFormat {
  return { ...r, font: { ...r.font } };
}

/** The toggle properties marks turn on or off (only those they name). */
function togglesOf(marks: readonly MarkJSON[] | undefined): Partial<Record<Toggle, boolean>> {
  const out: Partial<Record<Toggle, boolean>> = {};
  for (const m of marks ?? []) {
    const a = (m.attrs ?? {}) as Json;
    const value = a.value === undefined ? true : (a.value as boolean | null);
    switch (m.type) {
      case "bold":
      case "italic": {
        if (value !== null) out[m.type] = value;
        const cs = a.complexScript as boolean | null | undefined;
        if (cs !== null && cs !== undefined) out[m.type === "bold" ? "boldCs" : "italicCs"] = cs;
        break;
      }
      case "caps":
      case "smallCaps":
      case "strike":
      case "doubleStrike":
      case "hidden":
        if (value !== null) out[m.type] = value;
        break;
      default:
    }
  }
  return out;
}

/** Theme color names (`w:themeColor`) and the theme's color scheme entries they use. */
const THEME_COLORS: Record<string, string> = {
  text1: "dk1",
  background1: "lt1",
  text2: "dk2",
  background2: "lt2",
  dark1: "dk1",
  light1: "lt1",
  dark2: "dk2",
  light2: "lt2",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

/** Run properties other than toggles, applied in order (later wins). */
function mergeRun(
  target: RunFormat,
  marks: readonly MarkJSON[] | undefined,
  theme: ThemeJSON | undefined,
): void {
  for (const m of marks ?? []) {
    const a = (m.attrs ?? {}) as Json;
    switch (m.type) {
      case "underline": {
        const style = (a.style as string | undefined) ?? "single";
        target.underline = style === "none" ? null : style;
        target.underlineColor = (a.color as string | null | undefined) ?? null;
        break;
      }
      case "font":
        for (const script of ["ascii", "hAnsi", "eastAsia", "cs"] as const) {
          const themed = a[`${script}Theme`] as string | null | undefined;
          const name = themed ? themeFont(theme, themed) : (a[script] as string | null | undefined);
          if (name) target.font[script] = name;
        }
        break;
      case "fontSize":
        if (typeof a.value === "number") target.size = a.value;
        if (typeof a.complexScript === "number") target.sizeCs = a.complexScript;
        break;
      case "color": {
        // shortcut: theme tint and shade are not applied; apply them when a sample needs it.
        const themed = a.themeColor
          ? theme?.colors[THEME_COLORS[a.themeColor as string] ?? (a.themeColor as string)]
          : undefined;
        const value = (themed ?? a.value) as string | undefined;
        target.color = value === undefined || value === "auto" ? null : value.toUpperCase();
        break;
      }
      case "highlight":
        target.highlight = a.value === "none" ? null : (a.value as string);
        break;
      case "shading":
        target.shading =
          a.fill === "auto" || a.fill === undefined ? null : String(a.fill).toUpperCase();
        break;
      case "verticalAlign":
        target.verticalAlign = a.value as RunFormat["verticalAlign"];
        break;
      case "characterSpacing":
        target.characterSpacing = a.value as number;
        break;
      default:
    }
  }
}

/** Direct formatting: toggles set, everything else applied. */
function applyDirect(
  target: RunFormat,
  marks: readonly MarkJSON[] | undefined,
  theme: ThemeJSON | undefined,
): void {
  Object.assign(target, togglesOf(marks));
  mergeRun(target, marks, theme);
}

/**
 * A style chain's run formatting (root first). Within the chain a style overrides what it is
 * based on; the chain's toggles then flip the run's (ECMA-376 17.7.3), which is why a bold
 * character style on a bold heading shows plain text.
 */
function applyStyles(
  target: RunFormat,
  chain: readonly (readonly MarkJSON[])[],
  theme: ThemeJSON | undefined,
): void {
  const toggles: Partial<Record<Toggle, boolean>> = {};
  for (const marks of chain) {
    Object.assign(toggles, togglesOf(marks));
    mergeRun(target, marks, theme);
  }
  for (const key of TOGGLES) if (toggles[key]) target[key] = !target[key];
}

/** A theme font reference (`minorHAnsi`) as a font name. */
function themeFont(theme: ThemeJSON | undefined, ref: string): string | null {
  if (!theme) return null;
  const set = ref.startsWith("major") ? theme.fonts.major : theme.fonts.minor;
  const script = ref.slice(5);
  const name = script === "EastAsia" ? set.eastAsia : script === "Bidi" ? set.cs : set.latin;
  return name || null;
}

/** A counter in a number format (ST_NumberFormat); formats Foli does not know show as decimal. */
export function formatNumber(n: number, format: string | undefined): string {
  switch (format ?? "decimal") {
    case "none":
      return "";
    case "decimalZero":
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    case "upperRoman":
      return roman(n);
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperLetter":
      return letters(n);
    case "lowerLetter":
      return letters(n).toLowerCase();
    case "ordinal":
      return ordinal(n);
    default:
      return String(n);
  }
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = "";
  let rest = n;
  for (const [value, symbol] of ROMAN) {
    for (; rest >= value; rest -= value) out += symbol;
  }
  return out;
}

/** Word's letters: A…Z, then AA…ZZ, AAA… (the letter repeated). */
function letters(n: number): string {
  if (n <= 0) return String(n);
  return String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

type Envelope = Pick<FoliDocumentV3, "defaults" | "styles" | "numbering" | "theme">;

interface Level {
  instance: NumberingInstanceJSON;
  abstract: AbstractNumberingJSON;
  index: number;
  level: NumberingLevelJSON;
}

/**
 * Resolves a document's formatting from its envelope (defaults, styles, numbering, theme).
 * Style resolutions are memoized: build one per envelope and reuse it.
 */
export class Resolver {
  readonly #styles = new Map<string, StyleJSON>();
  readonly #defaultParagraphStyle: string | undefined;
  readonly #envelope: Envelope;
  readonly #paragraphStyles = new Map<
    string,
    { paragraph: Merging; run: RunFormat; chain: StyleJSON[] }
  >();
  readonly #characterStyles = new Map<string, MarkJSON[][]>();
  readonly #instances = new Map<number, NumberingInstanceJSON>();
  readonly #abstracts = new Map<number, AbstractNumberingJSON>();

  constructor(envelope: Envelope) {
    this.#envelope = envelope;
    // With duplicate ids, the first wins, as in Word.
    for (const s of envelope.styles) if (!this.#styles.has(s.id)) this.#styles.set(s.id, s);
    this.#defaultParagraphStyle = envelope.styles.find(
      (s) => s.type === "paragraph" && s.isDefault,
    )?.id;
    for (const n of envelope.numbering.instances)
      if (!this.#instances.has(n.id)) this.#instances.set(n.id, n);
    for (const a of envelope.numbering.abstracts)
      if (!this.#abstracts.has(a.id)) this.#abstracts.set(a.id, a);
  }

  /** A style and those it is based on, the root first (a cycle or a missing style ends it). */
  #chain(id: string | undefined, type: StyleJSON["type"]): StyleJSON[] {
    const out: StyleJSON[] = [];
    const seen = new Set<string>();
    for (let at = id; at !== undefined && !seen.has(at); ) {
      seen.add(at);
      const style = this.#styles.get(at);
      if (style?.type !== type) break;
      out.unshift(style);
      at = style.basedOn;
    }
    return out;
  }

  /** A paragraph style's formatting over the defaults, memoized. */
  #paragraphStyle(id: string | undefined) {
    const effective = id ?? this.#defaultParagraphStyle;
    const key = effective ?? "";
    const known = this.#paragraphStyles.get(key);
    if (known) return known;
    const { defaults } = this.#envelope;
    const paragraph = cloneParagraph(DEFAULT_PARAGRAPH);
    const run = cloneRun(DEFAULT_RUN);
    mergeParagraph(paragraph, defaults.paragraph);
    applyDirect(run, defaults.run, this.#envelope.theme);
    const chain = this.#chain(effective, "paragraph");
    for (const style of chain) mergeParagraph(paragraph, style.paragraph);
    applyStyles(
      run,
      chain.map((s) => s.run ?? []),
      this.#envelope.theme,
    );
    paragraph.style = chain.length ? (effective ?? null) : (id ?? null);
    const result = { paragraph, run, chain };
    this.#paragraphStyles.set(key, result);
    return result;
  }

  /**
   * A paragraph's effective properties, and the formatting of its text before a run's own marks
   * (`attrs`: the paragraph node's attributes).
   */
  paragraph(attrs: Json): { paragraph: ParagraphFormat; run: RunFormat; level: Level | undefined } {
    const props = attrs as ParagraphPropertiesJSON;
    const base = this.#paragraphStyle(props.style);
    let paragraph = cloneParagraph(base.paragraph);
    const directNumbering = props.numbering?.id !== undefined;
    if (props.numbering) mergeParagraph(paragraph, { numbering: props.numbering });
    const level = this.#levelOf(paragraph);
    if (level?.level.paragraph) {
      if (directNumbering) {
        // Numbering's indents come over the style's, under direct formatting.
        mergeParagraph(paragraph, level.level.paragraph);
      } else {
        // Numbering given by the style: the style's own indents win over the level's.
        const stacked = cloneParagraph(DEFAULT_PARAGRAPH);
        mergeParagraph(stacked, this.#envelope.defaults.paragraph);
        mergeParagraph(stacked, level.level.paragraph);
        for (const style of base.chain) mergeParagraph(stacked, style.paragraph);
        stacked.style = paragraph.style;
        stacked.numbering = paragraph.numbering;
        paragraph = stacked;
      }
    }
    const { style: _style, numbering: _numbering, ...direct } = props;
    mergeParagraph(paragraph, direct);
    const numbering = level ? { id: level.instance.id, level: level.index } : null;
    return { paragraph: { ...paragraph, numbering }, run: cloneRun(base.run), level };
  }

  /** A run's formatting: its paragraph's (`paragraphRun`), its character style, then its own marks. */
  run(paragraphRun: RunFormat, marks: readonly MarkJSON[]): RunFormat {
    const run = cloneRun(paragraphRun);
    const styleId = marks.find((m) => m.type === "characterStyle")?.attrs?.id as string | undefined;
    if (styleId) {
      let chain = this.#characterStyles.get(styleId);
      if (!chain) {
        chain = this.#chain(styleId, "character").map((s) => s.run ?? []);
        this.#characterStyles.set(styleId, chain);
      }
      applyStyles(run, chain, this.#envelope.theme);
    }
    applyDirect(run, marks, this.#envelope.theme);
    return run;
  }

  /**
   * The numbering level a paragraph is in. A style that names only the instance (numbered
   * headings) is in the level whose `style` is that style.
   */
  #levelOf(paragraph: Merging): Level | undefined {
    const id = paragraph.numbering?.id;
    const instance = id ? this.#instances.get(id) : undefined;
    const abstract = instance && this.#abstractOf(instance.abstract);
    if (!instance || !abstract) return undefined;
    const index =
      paragraph.numbering?.level ??
      abstract.levels.find((l) => l.style !== undefined && l.style === paragraph.style)?.level ??
      0;
    const level = this.#definition(instance, abstract, index);
    return level ? { instance, abstract, index, level } : undefined;
  }

  #definition(instance: NumberingInstanceJSON, abstract: AbstractNumberingJSON, index: number) {
    const override = instance.overrides?.find((o) => o.level === index)?.definition;
    return override ?? abstract.levels.find((l) => l.level === index);
  }

  /** An abstract definition, following a numbering style's link to the definition it uses. */
  #abstractOf(id: number): AbstractNumberingJSON | undefined {
    let abstract = this.#abstracts.get(id);
    for (let hops = 0; abstract?.numStyleLink && hops < 8; hops++) {
      const style = this.#styles.get(abstract.numStyleLink);
      const numId = style?.paragraph?.numbering?.id;
      const instance = numId ? this.#instances.get(numId) : undefined;
      const next = instance ? this.#abstracts.get(instance.abstract) : undefined;
      if (!next || next === abstract) break;
      abstract = next;
    }
    return abstract;
  }

  /**
   * The list markers of a document's paragraphs in order (`paragraphs`: each paragraph's
   * attributes). Counters are kept per abstract definition, so instances that share one continue
   * a list; an instance's start override restarts it where the instance is first used; a level
   * restarts after a paragraph of a level above it, or as its `restart` says.
   */
  markers(paragraphs: readonly Json[]): (ListMarker | null)[] {
    const counters = new Map<number, (number | undefined)[]>();
    const overridden = new Set<string>();
    return paragraphs.map((attrs) => {
      const { run, level: found } = this.paragraph(attrs);
      if (!found) return null;
      const { instance, abstract, index, level } = found;
      let levels = counters.get(abstract.id);
      if (!levels) {
        levels = [];
        counters.set(abstract.id, levels);
      }
      const startOf = (i: number) => {
        const override = instance.overrides?.find((o) => o.level === i)?.start;
        return override ?? this.#definition(instance, abstract, i)?.start ?? 0;
      };
      const key = `${instance.id}:${index}`;
      const override = instance.overrides?.find((o) => o.level === index)?.start;
      const current = levels[index];
      if (override !== undefined && !overridden.has(key)) {
        overridden.add(key);
        levels[index] = override;
      } else levels[index] = current === undefined ? startOf(index) : current + 1;
      for (let deeper = index + 1; deeper < 9; deeper++) {
        const restart = this.#definition(instance, abstract, deeper)?.restart;
        if (restart === undefined || (restart !== 0 && index < restart)) levels[deeper] = undefined;
      }
      const text = (level.text ?? "").replace(/%([1-9])/g, (_, d: string) => {
        const i = Number(d) - 1;
        const format = level.legal ? "decimal" : this.#definition(instance, abstract, i)?.format;
        return formatNumber(levels[i] ?? startOf(i), format);
      });
      const marker = cloneRun(run);
      applyDirect(marker, attrs.markFormat as MarkJSON[] | undefined, this.#envelope.theme);
      applyDirect(marker, level.run, this.#envelope.theme);
      return {
        text: level.format === "none" ? "" : text,
        suffix: level.suffix ?? "tab",
        justification: level.justification ?? "left",
        run: marker,
        instance: instance.id,
        level: index,
      };
    });
  }
}
