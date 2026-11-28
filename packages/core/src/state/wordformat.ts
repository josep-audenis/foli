/**
 * Word formatting on a schema v3 document (8.7b): paragraph styles, font family and size, text
 * color and highlight, alignment, line spacing, indentation, and lists as Word's numbering. The
 * generic commands (`setAlign`, `setTextColor`, `toggleList`…) call these on a v3 document;
 * the others are v3 only (they do not apply to schema v2).
 *
 * Run properties, alignment and line spacing are written as direct formatting only where the
 * paragraph's or run's styles do not already give the value (picking a heading's own size
 * leaves no direct size), as Word does; space before and after and indents are always written.
 * Built-in styles a document has not used yet (headings, List Paragraph, Hyperlink) are added
 * with Word's definitions when first applied.
 */

import type { Attrs, Mark, MarkType, Node } from "../model/index.js";
import type { Alignment } from "../schema.js";
import { NodeMarkupBatchStep, NodeMarkupStep } from "../transform/index.js";
import type {
  AbstractNumberingJSON,
  BorderJSON,
  NumberingInstanceJSON,
  NumberingLevelJSON,
  StyleJSON,
} from "../v3/document.js";
import type { ParagraphFormat, RunFormat } from "../v3/resolve.js";
import {
  checkParagraphProperties,
  PARAGRAPH_PROPERTY_KEYS,
  RUN_PROPERTY_MARKS,
  TAB_LEADERS,
} from "../v3/schema.js";
import { attempt } from "./attempt.js";
import { chainCommands } from "./dialogs.js";
import { idsOf } from "./ids.js";
import { marksAt, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from "./state.js";
import {
  isMarker,
  storyBody,
  type WordContext,
  type WordEnvelope,
  withEnvelope,
  wordContext,
} from "./word.js";

const json = (value: unknown) => JSON.stringify(value ?? null);

/** The paragraphs the selection touches, with their positions. */
function paragraphsIn(state: EditorState): { node: Node; pos: number }[] {
  const found: { node: Node; pos: number }[] = [];
  for (const { from, to } of state.selection.ranges)
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== "paragraph") return true;
      found.push({ node, pos });
      return false;
    });
  return found;
}

/**
 * Changes the attributes of every selected paragraph (`change` gives the new ones, or null to
 * leave it) in one step. Does not apply when nothing changes.
 */
function updateParagraphs(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  change: (node: Node) => Attrs | null,
  envelope?: WordEnvelope,
): boolean {
  const steps = paragraphsIn(state).flatMap(({ node, pos }) => {
    const next = change(node);
    return next && json(next) !== json(node.attrs)
      ? [new NodeMarkupStep(pos, node.type, next)]
      : [];
  });
  if (!steps.length) return false;
  return attempt(state, dispatch, (tr) => {
    tr.step(new NodeMarkupBatchStep(steps));
    if (envelope) withEnvelope(tr, envelope);
  });
}

/** The value all `values` share, or null (none, or mixed). */
function common<T>(values: readonly T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((v) => json(v) === json(first)) ? first : null;
}

// ---------- paragraph styles ----------

/** @internal */
export type HasEnvelope = Pick<WordContext, "envelope">;

/**
 * The id of the document's style of `type` named `name` (Word's names: "heading 1"), if any.
 * @internal
 */
export function styleNamed(
  context: HasEnvelope,
  name: string,
  type: StyleJSON["type"] = "paragraph",
): string | null {
  const lower = name.toLowerCase();
  return (
    context.envelope.styles.find((s) => s.type === type && s.name?.toLowerCase() === lower)?.id ??
    null
  );
}

/**
 * The id of the default style of `type` (Normal, Default Paragraph Font), if the document has one.
 * @internal
 */
export function defaultParagraphStyleOf(
  context: HasEnvelope,
  type: StyleJSON["type"] = "paragraph",
): string | null {
  let id: string | null = null;
  for (const s of context.envelope.styles) if (s.type === type && s.isDefault) id = s.id;
  return id;
}

/** The built-in style a style id names (`Heading2`: "heading 2"), for a document without it. */
const builtinName = (id: string) =>
  /^Heading[1-9]$/.test(id)
    ? `heading ${id.slice(7)}`
    : id === "ListParagraph"
      ? "List Paragraph"
      : null;

/**
 * Word's definition of built-in style `name` ("heading 1"–"heading 9", "List Paragraph",
 * "Hyperlink", "Placeholder Text"), as Word adds it to a document the first time it is used (the Word 2013–2019
 * template's values; not checked against newer Word).
 * @internal
 */
export function builtinStyle(context: HasEnvelope, name: string): StyleJSON | null {
  const normal = defaultParagraphStyleOf(context);
  const based = normal ? { basedOn: normal } : {};
  const heading = /^heading ([1-9])$/.exec(name)?.[1];
  if (heading) {
    const n = Number(heading);
    const color =
      n >= 8
        ? { value: "272727", themeColor: "text1", themeTint: "D8" }
        : {
            ...([3, 6, 7].includes(n)
              ? { value: "1F3763", themeShade: "7F" }
              : { value: "2F5496", themeShade: "BF" }),
            themeColor: "accent1",
          };
    const size = [32, 26, 24, 0, 0, 0, 0, 21, 21][n - 1];
    return {
      id: `Heading${n}`,
      type: "paragraph",
      name,
      ...based,
      ...(normal ? { next: normal } : {}),
      paragraph: {
        keepNext: true,
        keepLines: true,
        spacing: { before: n === 1 ? 240 : 40, after: 0 },
        outlineLevel: n - 1,
      },
      run: [
        {
          type: "font",
          attrs: {
            asciiTheme: "majorHAnsi",
            eastAsiaTheme: "majorEastAsia",
            hAnsiTheme: "majorHAnsi",
            csTheme: "majorBidi",
          },
        },
        ...([4, 7, 9].includes(n) ? [{ type: "italic", attrs: { complexScript: true } }] : []),
        { type: "color", attrs: color },
        ...(size ? [{ type: "fontSize", attrs: { value: size, complexScript: size } }] : []),
      ],
    };
  }
  const contents = /^toc ([1-9])$/.exec(name)?.[1];
  if (contents) {
    // Word indents each level by the default font's size (11 pt: 220 twips).
    const size = context.envelope.defaults.run?.find((m) => m.type === "fontSize")?.attrs?.value;
    const indent = (Number(contents) - 1) * (typeof size === "number" ? size * 10 : 220);
    return {
      id: `TOC${contents}`,
      type: "paragraph",
      name,
      ...based,
      ...(normal ? { next: normal } : {}),
      paragraph: { spacing: { after: 100 }, ...(indent ? { indent: { left: indent } } : {}) },
    };
  }
  // Word 16's, as its Insert Caption and Table of Figures write them (35.3).
  if (name === "caption")
    return {
      id: "Caption",
      type: "paragraph",
      name,
      ...based,
      ...(normal ? { next: normal } : {}),
      paragraph: { spacing: { after: 200, line: 240, lineRule: "auto" } },
      run: [
        { type: "italic", attrs: { complexScript: true } },
        { type: "color", attrs: { value: "0E2841", themeColor: "text2" } },
        { type: "fontSize", attrs: { value: 18, complexScript: 18 } },
      ],
    };
  if (name === "table of figures")
    return {
      id: "TableofFigures",
      type: "paragraph",
      name,
      ...based,
      ...(normal ? { next: normal } : {}),
      paragraph: { spacing: { after: 0 } },
    };
  if (name === "List Paragraph")
    return {
      id: "ListParagraph",
      type: "paragraph",
      name,
      ...based,
      paragraph: { indent: { left: 720 }, contextualSpacing: true },
    };
  if (name === "Table Grid") {
    // Word's: single borders all round and between cells, no space after paragraphs.
    const line = { style: "single", size: 4, space: 0, color: "auto" };
    const plain = styleNamed(context, "Normal Table", "table");
    return {
      id: "TableGrid",
      type: "table",
      name,
      ...(plain ? { basedOn: plain } : {}),
      paragraph: { spacing: { after: 0, line: 240, lineRule: "auto" } },
      table: {
        borders: {
          top: line,
          left: line,
          bottom: line,
          right: line,
          insideH: line,
          insideV: line,
        },
      },
    };
  }
  const note = /^(foot|end)note (text|reference)$/.exec(name);
  const textChar = /^(Foot|End)note Text Char$/.exec(name);
  if (note || textChar) {
    // Word's: 10 pt text without space after, and a superscript reference.
    const font = defaultParagraphStyleOf(context, "character");
    const fontBased = font ? { basedOn: font } : {};
    const size = { type: "fontSize", attrs: { value: 20, complexScript: 20 } };
    const stem =
      (note?.[1] ?? textChar?.[1] ?? "").toLowerCase() === "foot" ? "Footnote" : "Endnote";
    if (textChar)
      return {
        id: `${stem}TextChar`,
        type: "character",
        name,
        ...fontBased,
        link: `${stem}Text`,
        run: [size],
      };
    if (note?.[2] === "reference")
      return {
        id: `${stem}Reference`,
        type: "character",
        name,
        ...fontBased,
        run: [{ type: "verticalAlign", attrs: { value: "superscript" } }],
      };
    return {
      id: `${stem}Text`,
      type: "paragraph",
      name,
      ...based,
      link: `${stem}TextChar`,
      paragraph: { spacing: { after: 0, line: 240, lineRule: "auto" } },
      run: [size],
    };
  }
  if (name === "Placeholder Text") {
    const font = defaultParagraphStyleOf(context, "character");
    return {
      id: "PlaceholderText",
      type: "character",
      name,
      ...(font ? { basedOn: font } : {}),
      run: [{ type: "color", attrs: { value: "666666" } }],
    };
  }
  if (name === "Hyperlink") {
    const font = defaultParagraphStyleOf(context, "character");
    return {
      id: "Hyperlink",
      type: "character",
      name,
      ...(font ? { basedOn: font } : {}),
      run: [
        { type: "color", attrs: { value: "0563C1", themeColor: "hyperlink" } },
        { type: "underline", attrs: { style: "single" } },
      ],
    };
  }
  return null;
}

/**
 * The id of the document's style named `name`, adding Word's built-in definition when the
 * document does not have it yet (with the envelope that has it; unchanged if it was there).
 * @internal
 */
export function ensureStyle(
  context: HasEnvelope,
  name: string,
  type: StyleJSON["type"] = "paragraph",
): { id: string; envelope: WordEnvelope } | null {
  const { envelope } = context;
  const found = styleNamed(context, name, type);
  if (found) return { id: found, envelope };
  const style = builtinStyle(context, name);
  if (!style) return null;
  const ids = new Set(envelope.styles.map((s) => s.id));
  let id = style.id;
  for (let i = 1; ids.has(id); i++) id = `${style.id}${i}`;
  return { id, envelope: { ...envelope, styles: [...envelope.styles, { ...style, id }] } };
}

/**
 * The paragraph styles a style picker offers: the document's, its default first, then Word's
 * Heading 1 to 3 where the document does not have them yet (added when picked).
 */
export function paragraphStyles(state: EditorState): { id: string; name: string }[] {
  const context = wordContext(state);
  if (!context) return [];
  const seen = new Set<string>();
  const styles = context.envelope.styles.filter(
    (s) => s.type === "paragraph" && !seen.has(s.id) && seen.add(s.id),
  );
  const first = defaultParagraphStyleOf(context);
  const builtins = ["Heading1", "Heading2", "Heading3"].filter(
    (id) => !seen.has(id) && !styleNamed(context, builtinName(id) as string),
  );
  return [
    ...styles
      .map((s) => ({ id: s.id, name: s.name ?? s.id }))
      .sort((a, b) => Number(b.id === first) - Number(a.id === first)),
    ...builtins.map((id) => ({ id, name: builtinName(id) as string })),
  ];
}

/** The style all selected paragraphs are in (the default one when they name none), or null. */
export function paragraphStyleAt(state: EditorState): string | null {
  const context = wordContext(state);
  if (!context) return null;
  return common(
    paragraphsIn(state).map(
      ({ node }) => context.resolver.paragraph(node.attrs).paragraph.style ?? null,
    ),
  );
}

/**
 * Puts the selected paragraphs in paragraph style `id` (the default style: no style named).
 * Their direct formatting stays. A built-in style the document does not have yet (`Heading1`–
 * `Heading9`, `ListParagraph`) is added with Word's definition; any other must exist.
 */
export function setParagraphStyle(id: string): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    if (context.envelope.styles.some((s) => s.id === id && s.type === "paragraph"))
      return applyStyle(state, dispatch, context, { id, envelope: context.envelope });
    const name = builtinName(id);
    return !!name && setStyleNamed(name)(state, dispatch);
  };
}

/**
 * Puts the selected paragraphs in the paragraph style named `name` ("heading 2"), adding Word's
 * definition of a built-in one the document does not have yet.
 * @internal
 */
export function setStyleNamed(name: string): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const target = context && ensureStyle(context, name);
    return !!target && applyStyle(state, dispatch, context, target);
  };
}

function applyStyle(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  context: WordContext,
  target: { id: string; envelope: WordEnvelope },
): boolean {
  const style = target.id === defaultParagraphStyleOf(context) ? null : target.id;
  return updateParagraphs(
    state,
    dispatch,
    (node) => ({ ...node.attrs, style }),
    target.envelope === context.envelope ? undefined : target.envelope,
  );
}

// ---------- run properties ----------

/** The inline nodes of the selection a run property applies to (markers have no text to format). */
function runsIn(state: EditorState, type: MarkType) {
  const context = wordContext(state);
  const found: { node: Node; pos: number; parent: Node }[] = [];
  for (const { from, to } of state.selection.ranges)
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
      if (!isMarker(context, node)) found.push({ node, pos, parent });
      return false;
    });
  return found;
}

/** What text with `marks` in `paragraph` shows, without its own mark of `type` (`own`: with). */
function runFormat(
  context: WordContext,
  paragraph: Node,
  marks: readonly Mark[],
  type?: MarkType,
): RunFormat {
  const { run } = context.resolver.paragraph(paragraph.attrs);
  return context.resolver.run(
    run,
    marks.filter((m) => m.type !== type).map((m) => m.toJSON()),
  );
}

/**
 * Sets a run property on the selected text (at a caret, for the text typed next): `build` gives
 * the mark of `name` for text that has `existing` and shows `inherited` without it, or null
 * for none.
 */
function setRunMark(
  name: string,
  build: (existing: Mark | undefined, inherited: RunFormat, type: MarkType) => Mark | null,
): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const type = state.schema.marks[name];
    if (!context || !type) return false;
    const { selection } = state;
    if (selection.empty && selection instanceof TextSelection) {
      const { $from } = selection;
      if (!$from.parent.type.allowsMarkType(type)) return false;
      const marks = state.storedMarks ?? marksAt($from);
      const existing = type.isInSet(marks);
      const mark = build(existing, runFormat(context, $from.parent, marks, type), type);
      const rest = type.removeFromSet(marks);
      dispatch?.(state.tr.setStoredMarks(mark ? mark.addToSet(rest) : rest));
      return true;
    }
    const runs = runsIn(state, type);
    if (!runs.length) return false;
    return attempt(state, dispatch, (tr) => {
      for (const { node, pos, parent } of runs) {
        const from = Math.max(selection.from, pos);
        const to = Math.min(selection.to, pos + node.nodeSize);
        const existing = type.isInSet(node.marks);
        const mark = build(existing, runFormat(context, parent, node.marks, type), type);
        if (mark ? existing?.eq(mark) : !existing) continue;
        tr.removeMark(from, to, type);
        if (mark) tr.addMark(from, to, mark);
      }
    });
  };
}

/** What the selected text (or the text typed at a caret) shows of `read`, if all the same. */
function runValueAt<T>(state: EditorState, read: (run: RunFormat) => T): T | null {
  const context = wordContext(state);
  if (!context) return null;
  const { selection } = state;
  const runs = selection.empty
    ? []
    : runsIn(state, state.schema.marks.font as MarkType).filter((r) => r.node.isText);
  // A caret, or no text selected (empty paragraphs, a picture): what text typed there shows.
  if (!runs.length) {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    return read(runFormat(context, selection.$from.parent, marks));
  }
  return common(runs.map((r) => read(runFormat(context, r.parent, r.node.marks))));
}

/** The font name Latin text shows. */
const latinFont = (run: RunFormat) => run.font.ascii ?? run.font.hAnsi;

/**
 * The font family of the selected text (or of the text typed next); null puts back the styles'
 * font. Sets the font Latin text uses (`w:ascii`, `w:hAnsi`), as Word's font box does; East
 * Asian and complex-script fonts stay.
 */
export function setFontFamily(name: string | null): Command {
  const font = name?.trim() || null;
  return setRunMark("font", (existing, inherited, type) => {
    const attrs: Record<string, unknown> = {
      ...(existing?.attrs ?? {}),
      asciiTheme: null,
      hAnsiTheme: null,
    };
    const same = font !== null && latinFont(inherited) === font;
    attrs.ascii = attrs.hAnsi = font === null || same ? null : font;
    return Object.values(attrs).some((v) => v !== null) ? type.create(attrs) : null;
  });
}

/** The font family the selected text shows, if all the same. */
export function fontFamilyAt(state: EditorState): string | null {
  return runValueAt(state, latinFont);
}

/**
 * The font size in points (half points stored, `w:sz` and `w:szCs`) of the selected text, or of
 * the text typed next; null puts back the styles' size. Sizes from 1 to 1638 pt, in half points.
 */
export function setFontSize(points: number | null): Command {
  const half = points === null ? null : Math.round(points * 2);
  return (state, dispatch) => {
    if (half !== null && !(half >= 2 && half <= 3276)) return false;
    return setRunMark("fontSize", (_existing, inherited, type) =>
      half === null || (inherited.size === half && inherited.sizeCs === half)
        ? null
        : type.create({
            value: inherited.size === half ? null : half,
            complexScript: inherited.sizeCs === half ? null : half,
          }),
    )(state, dispatch);
  };
}

/** The font size in points the selected text shows, if all the same. */
export function fontSizeAt(state: EditorState): number | null {
  return runValueAt(state, (run) => run.size / 2);
}

/** `#rrggbb` as Word's `RRGGBB`. */
const word = (hex: string) => hex.slice(1).toUpperCase();

/** Word's highlight colors (`w:highlight`) as `#rrggbb`. */
export const HIGHLIGHT_HEX: Readonly<Record<string, string>> = {
  black: "#000000",
  blue: "#0000ff",
  cyan: "#00ffff",
  green: "#00ff00",
  magenta: "#ff00ff",
  red: "#ff0000",
  yellow: "#ffff00",
  white: "#ffffff",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
};

/**
 * Text color on a v3 document (`#rrggbb`); null is Word's "Automatic": no direct color, or an
 * explicit `auto` where a style colors the text.
 * @internal
 */
export function setWordTextColor(color: string | null): Command {
  return setRunMark("color", (_existing, inherited, type) => {
    if (color === null) return inherited.color === null ? null : type.create({ value: "auto" });
    return inherited.color === word(color) ? null : type.create({ value: word(color) });
  });
}

/**
 * Highlight on a v3 document (`#rrggbb`): one of Word's highlight colors as a highlight, any
 * other as shading; null removes the highlight (an explicit `none` where a style highlights)
 * and a plain shading fill, the kind a color outside Word's highlights gives. Patterned shading
 * stays, and picking a highlight keeps any shading (Word's highlight and shading are apart).
 * @internal
 */
export function setWordHighlight(color: string | null): Command {
  return (state, dispatch) => {
    const named = color
      ? Object.keys(HIGHLIGHT_HEX).find((k) => HIGHLIGHT_HEX[k] === color.toLowerCase())
      : undefined;
    if (color === null || named) {
      const highlight = setRunMark("highlight", (_existing, inherited, type) => {
        if (named) return inherited.highlight === named ? null : type.create({ value: named });
        return inherited.highlight === null ? null : type.create({ value: "none" });
      });
      if (named) return highlight(state, dispatch);
      const fill = setRunMark("shading", (existing) =>
        existing?.attrs.pattern === "clear" && existing.attrs.color === "auto"
          ? null
          : (existing ?? null),
      );
      return chain(state, dispatch, [highlight, fill]);
    }
    return chain(state, dispatch, [
      removeMark("highlight"),
      setRunMark("shading", (_existing, _inherited, type) =>
        type.create({ pattern: "clear", color: "auto", fill: word(color) }),
      ),
    ]);
  };
}

/** Removes the direct marks of `name` from the selection (at a caret, from the stored marks). */
function removeMark(name: string): Command {
  return setRunMark(name, () => null);
}

/** Runs `commands` one after another as one transaction; applies when any of them does. */
function chain(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  commands: readonly Command[],
): boolean {
  return chainCommands(commands)(state, dispatch);
}

/**
 * The text color the selection shows (`#rrggbb`; null: automatic, or mixed).
 * @internal
 */
export function wordTextColorAt(state: EditorState): string | null {
  return runValueAt(state, (run) => (run.color ? `#${run.color.toLowerCase()}` : null));
}

/**
 * The highlight (or shading) the selection shows (`#rrggbb`), or null.
 * @internal
 */
export function wordHighlightAt(state: EditorState): string | null {
  return runValueAt(state, (run) =>
    run.highlight
      ? (HIGHLIGHT_HEX[run.highlight] ?? null)
      : run.shading
        ? `#${run.shading.toLowerCase()}`
        : null,
  );
}

// ---------- paragraph properties ----------

const TO_WORD: Record<Alignment, string> = {
  start: "left",
  center: "center",
  end: "right",
  justify: "both",
};

/** A Word justification as the editor's alignment (null for one it has no button for). */
function alignmentOf(justification: string | null): Alignment | null {
  if (justification === null || justification === "left" || justification === "start")
    return "start";
  if (justification === "center") return "center";
  if (justification === "right" || justification === "end") return "end";
  if (justification === "both" || justification === "distribute") return "justify";
  return null;
}

/**
 * The paragraph's attributes with property `key` set to `value` directly, or left to the style
 * when the style already gives it (`same` compares what the paragraph would show).
 */
function direct(
  context: WordContext,
  attrs: Attrs,
  key: string,
  value: unknown,
  shows: (paragraph: ParagraphFormat) => boolean,
): Attrs {
  const without = { ...attrs, [key]: null };
  const inherited = context.resolver.paragraph(without).paragraph;
  return shows(inherited) ? without : { ...attrs, [key]: value };
}

/**
 * Aligns the selected paragraphs (`setAlign` on a v3 document).
 * @internal
 */
export function setWordAlign(align: Alignment): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    return updateParagraphs(state, dispatch, (node) =>
      direct(
        context,
        node.attrs,
        "justification",
        TO_WORD[align],
        (p) => alignmentOf(p.justification) === align,
      ),
    );
  };
}

/**
 * The alignment all selected paragraphs show (`alignAt` on a v3 document).
 * @internal
 */
export function wordAlignAt(state: EditorState): Alignment | null {
  const context = wordContext(state);
  if (!context) return null;
  return common(
    paragraphsIn(state).map(({ node }) =>
      alignmentOf(context.resolver.paragraph(node.attrs).paragraph.justification),
    ),
  );
}

/** Word's line spacing rules: a multiple of single (`auto`), exactly or at least some points. */
export type LineRule = "auto" | "exact" | "atLeast";

/**
 * Line spacing of the selected paragraphs: with `rule` `"auto"` (the default) `value` is a
 * multiple of single spacing (1, 1.15, 1.5, 2…, up to 132); with `"exact"` or `"atLeast"` it is
 * in points (up to 1584), Word's Exactly and At least. null puts back the styles' spacing.
 * Space before and after stays.
 */
export function setLineSpacing(value: number | null, rule: LineRule = "auto"): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const max = rule === "auto" ? 132 : 1584;
    if (!context || (value !== null && !(value > 0 && value <= max))) return false;
    const line = value === null ? null : Math.round(value * (rule === "auto" ? 240 : 20));
    return updateParagraphs(state, dispatch, (node) => {
      const own = { ...((node.attrs.spacing as Record<string, unknown> | null) ?? {}) };
      delete own.line;
      delete own.lineRule;
      const base = { ...node.attrs, spacing: Object.keys(own).length ? own : null };
      const inherited = context.resolver.paragraph(base).paragraph.spacing;
      if (line === null || (inherited.line === line && inherited.lineRule === rule)) return base;
      return { ...node.attrs, spacing: { ...own, line, lineRule: rule } };
    });
  };
}

/** The line spacing all selected paragraphs show, as a multiple (null: exact or mixed). */
export function lineSpacingAt(state: EditorState): number | null {
  const context = wordContext(state);
  if (!context) return null;
  return common(
    paragraphsIn(state).map(({ node }) => {
      const { line, lineRule } = context.resolver.paragraph(node.attrs).paragraph.spacing;
      if (line === null) return 1;
      return lineRule === "auto" || lineRule === null ? Math.round((line / 240) * 100) / 100 : null;
    }),
  );
}

/**
 * Space before and after the selected paragraphs, in points (only the parts given; null puts
 * back the style's). Always written directly; a side given turns its auto spacing off (Word
 * ignores the value with it on).
 */
export function setParagraphSpacing(space: {
  before?: number | null;
  after?: number | null;
}): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    const values = Object.values(space);
    if (values.some((v) => v !== null && !(v >= 0 && v <= 1584))) return false;
    return updateParagraphs(state, dispatch, (node) => {
      const own: Record<string, unknown> = {
        ...((node.attrs.spacing as Record<string, unknown> | null) ?? {}),
      };
      const set: string[] = [];
      for (const key of ["before", "after"] as const) {
        const value = space[key];
        if (value === undefined) continue;
        if (value === null) delete own[key];
        else {
          own[key] = Math.round(value * 20);
          delete own[`${key}Autospacing`];
          set.push(key);
        }
      }
      const shown = context.resolver.paragraph({ ...node.attrs, spacing: own }).paragraph.spacing;
      for (const key of set)
        if (shown[`${key}Autospacing` as "beforeAutospacing"]) own[`${key}Autospacing`] = false;
      return { ...node.attrs, spacing: Object.keys(own).length ? own : null };
    });
  };
}

/** Word's indent step (half an inch), in twips. */
const STEP = 720;

/**
 * Increase or decrease indent (`dir` 1 or -1) of the selected paragraphs: a numbered paragraph
 * moves a list level; any other moves its left indent to the next half-inch stop (not below 0).
 */
export function changeIndent(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    return updateParagraphs(state, dispatch, (node) => {
      const { paragraph } = context.resolver.paragraph(node.attrs);
      if (paragraph.numbering) {
        const { id } = paragraph.numbering;
        const level = paragraph.numbering.level + dir;
        if (level < 0) return withoutNumbering(context, node);
        const definition = levelOf(context, id, level);
        // A level its list does not define would lose the number.
        if (!definition) return null;
        // Numbered headings: the level's own style (Heading 2), which numbers it there.
        const style = definition.style;
        if (style && context.envelope.styles.some((s) => s.id === style))
          return { ...node.attrs, style, numbering: node.attrs.numbering ? { id, level } : null };
        return { ...node.attrs, numbering: { id, level } };
      }
      const left = paragraph.indent.left;
      const next =
        dir > 0 ? (Math.floor(left / STEP) + 1) * STEP : (Math.ceil(left / STEP) - 1) * STEP;
      if (next < 0 || next > 31_680) return null;
      const own = (node.attrs.indent as Record<string, unknown> | null) ?? {};
      return { ...node.attrs, indent: { ...own, left: next } };
    });
  };
}

/** Whether the selection has a paragraph whose indent can decrease (numbered, or indented). */
export function canOutdent(state: EditorState): boolean {
  const context = wordContext(state);
  if (!context) return false;
  return paragraphsIn(state).some(({ node }) => {
    const { paragraph } = context.resolver.paragraph(node.attrs);
    return paragraph.numbering !== null || paragraph.indent.left > 0;
  });
}

/** The largest indent Word takes (22 inches), in points. */
const MAX_INDENT = 1584;

/**
 * The indents of the selected paragraphs in points, as Word's Paragraph dialog sets them (only
 * the parts given; null puts back the style's): `left` and `right` (negative into the margin),
 * and the special indent, `firstLine` or `hanging` (setting one replaces the other; a first
 * line of 0 is Word's None). Always written directly, as `changeIndent` writes the left one.
 */
export function setIndent(indent: {
  left?: number | null;
  right?: number | null;
  firstLine?: number | null;
  hanging?: number | null;
}): Command {
  return (state, dispatch) => {
    if (!wordContext(state)) return false;
    for (const [key, value] of Object.entries(indent)) {
      if (value === null || value === undefined) continue;
      const min = key === "left" || key === "right" ? -MAX_INDENT : 0;
      if (!(value >= min && value <= MAX_INDENT)) return false;
    }
    return updateParagraphs(state, dispatch, (node) => {
      const own: Record<string, unknown> = {
        ...((node.attrs.indent as Record<string, unknown> | null) ?? {}),
      };
      for (const key of ["left", "right", "firstLine", "hanging"] as const) {
        const value = indent[key];
        if (value === undefined) continue;
        if (value === null) delete own[key];
        else {
          own[key] = Math.round(value * 20);
          // One special indent: the other one goes (Word applies a hanging one over both).
          if (key === "firstLine") delete own.hanging;
          if (key === "hanging") delete own.firstLine;
        }
      }
      return { ...node.attrs, indent: Object.keys(own).length ? own : null };
    });
  };
}

/** The paragraph switches of Word's Line and Page Breaks tab, and No space between… */
export interface ParagraphFlags {
  keepNext?: boolean | null;
  keepLines?: boolean | null;
  widowControl?: boolean | null;
  pageBreakBefore?: boolean | null;
  contextualSpacing?: boolean | null;
  /** Word's Suppress line numbers (schema 9). */
  suppressLineNumbers?: boolean | null;
}

const FLAGS = [
  "keepNext",
  "keepLines",
  "widowControl",
  "pageBreakBefore",
  "contextualSpacing",
  "suppressLineNumbers",
] as const;

/**
 * Turns the given switches of the selected paragraphs on or off (null puts back the style's):
 * keep with next, keep lines together, widow/orphan control, page break before, and no space
 * between paragraphs of the same style (`contextualSpacing`). Written directly only where the
 * style does not already give the value.
 */
export function setParagraphFlags(flags: ParagraphFlags): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    return updateParagraphs(state, dispatch, (node) => {
      let attrs = node.attrs;
      for (const key of FLAGS) {
        const value = flags[key];
        if (value === undefined) continue;
        attrs =
          value === null
            ? { ...attrs, [key]: null }
            : direct(context, attrs, key, value, (p) => p[key] === value);
      }
      return attrs;
    });
  };
}

/**
 * The outline level of the selected paragraphs: 0 to 8 (Word's Level 1 to Level 9, as
 * `w:outlineLvl`), or null for Body Text. Written directly only where the style gives another.
 */
export function setOutlineLevel(level: number | null): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context || (level !== null && !(Number.isInteger(level) && level >= 0 && level <= 8)))
      return false;
    const body = (shown: number | null) => shown === null || shown === 9;
    return updateParagraphs(state, dispatch, (node) =>
      direct(context, node.attrs, "outlineLevel", level ?? 9, (p) =>
        level === null ? body(p.outlineLevel) : p.outlineLevel === level,
      ),
    );
  };
}

/** A tab stop as Word's Tabs dialog sets it: its position in points, alignment and leader. */
export interface TabStop {
  position: number;
  alignment: "left" | "center" | "right" | "decimal" | "bar";
  /** The characters that fill the space before the stop (default none). */
  leader?: "none" | "dot" | "hyphen" | "underscore" | "heavy" | "middleDot";
}

const TAB_ALIGNMENTS: readonly string[] = ["left", "center", "right", "decimal", "bar"];

/**
 * Word's Tabs dialog on the selected paragraphs, each from the stops it shows (its style's and
 * its own): `clear` removes the stops at these positions in points (`"all"`: every one, Clear
 * All), then `set` adds or replaces stops. Written as Word writes them: the paragraph's own stops
 * are those its style does not give, and a `clear` stop for each of the style's it no longer has.
 * Positions set from -1584 to 1584 pt (any stop the paragraphs have can be cleared). Does not apply
 * when a paragraph would get more than 64 stops.
 */
export function setTabStops(change: {
  set?: readonly TabStop[];
  clear?: readonly number[] | "all";
}): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const set = change.set ?? [];
    // Word takes stops into the left margin too.
    const valid = (pt: number) => pt >= -1584 && pt <= 1584;
    if (
      !context ||
      set.some(
        (s) =>
          !valid(s.position) ||
          !TAB_ALIGNMENTS.includes(s.alignment) ||
          (s.leader !== undefined && !TAB_LEADERS.includes(s.leader)),
      ) ||
      (Array.isArray(change.clear) && !change.clear.every(Number.isFinite))
    )
      return false;
    const twips = (pt: number) => Math.round(pt * 20);
    const none = (leader: string | null | undefined) =>
      leader === "none" ? null : (leader ?? null);
    let tooMany = false;
    const next = (node: Node): Attrs | null => {
      const shown = context.resolver.paragraph(node.attrs).paragraph.tabs;
      const inherited = context.resolver.paragraph({ ...node.attrs, tabs: null }).paragraph.tabs;
      const stops = new Map(
        change.clear === "all" ? [] : shown.map((t) => [t.position, t] as const),
      );
      if (Array.isArray(change.clear)) for (const pt of change.clear) stops.delete(twips(pt));
      for (const s of set) {
        const position = twips(s.position);
        const leader = s.leader && s.leader !== "none" ? s.leader : null;
        stops.set(position, { position, kind: s.alignment, leader });
      }
      if (stops.size > 64) {
        tooMany = true;
        return null;
      }
      const own: { position: number; kind: string; leader?: string }[] = [];
      for (const t of stops.values()) {
        const from = inherited.find((i) => i.position === t.position);
        if (from && from.kind === t.kind && none(from.leader) === none(t.leader)) continue;
        own.push(
          t.leader
            ? { position: t.position, kind: t.kind, leader: t.leader }
            : { position: t.position, kind: t.kind },
        );
      }
      for (const t of inherited)
        if (!stops.has(t.position)) own.push({ position: t.position, kind: "clear" });
      own.sort((a, b) => a.position - b.position);
      return { ...node.attrs, tabs: own.length ? own : null };
    };
    // All the paragraphs or none: a dry run first finds one that would get too many stops.
    if (!updateParagraphs(state, undefined, next) || tooMany) return false;
    return updateParagraphs(state, dispatch, next);
  };
}

/** What `paragraphFormatAt` gives: `ParagraphFormat` with what the paragraphs differ in left out. */
export type ParagraphFormatAt = Partial<Omit<ParagraphFormat, "indent" | "spacing">> & {
  indent: Partial<ParagraphFormat["indent"]>;
  spacing: Partial<ParagraphFormat["spacing"]>;
};

/** The properties all `formats` share, a part each where `nested` (the others left out). */
function shared<T extends object>(formats: readonly T[], nested: readonly string[] = []) {
  const out: Record<string, unknown> = {};
  const [first] = formats;
  if (!first) return out;
  for (const key of Object.keys(first) as (keyof T & string)[]) {
    const values = formats.map((f) => f[key]);
    if (nested.includes(key)) out[key] = shared(values as object[]);
    else {
      const value = common(values);
      if (value !== null || values.every((v) => v === null)) out[key] = value;
    }
  }
  return out;
}

/** One way of writing what Word shows alike: left, single spacing, Body Text. */
const SAME_JUSTIFICATION: Record<string, string> = { start: "left", end: "right" };
function normalized(format: ParagraphFormat): ParagraphFormat {
  const { spacing, justification, outlineLevel } = format;
  return {
    ...format,
    justification:
      justification === null ? "left" : (SAME_JUSTIFICATION[justification] ?? justification),
    outlineLevel: outlineLevel === 9 ? null : outlineLevel,
    spacing: { ...spacing, line: spacing.line ?? (spacing.lineRule === "auto" ? 240 : null) },
  };
}

/**
 * What every selected paragraph shows of Word's paragraph properties, as the Paragraph dialog
 * reads them: a property the paragraphs differ in is left out (Word's blank box); `indent` and
 * `spacing` part by part. Values Word shows alike come one way: `justification` `"left"` for
 * none, `outlineLevel` null for Body Text (9 too), `spacing.line` 240 for single. Null outside
 * a Word document.
 */
export function paragraphFormatAt(state: EditorState): ParagraphFormatAt | null {
  const context = wordContext(state);
  const paragraphs = paragraphsIn(state);
  if (!context || !paragraphs.length) return null;
  return shared(
    paragraphs.map(({ node }) => normalized(context.resolver.paragraph(node.attrs).paragraph)),
    ["indent", "spacing"],
  ) as ParagraphFormatAt;
}

// ---------- lists ----------

export type ListKind = "bulletList" | "orderedList";

/** The kind of list a paragraph is in (from its numbering level's format), or null. */
function kindOf(context: WordContext, attrs: Attrs): ListKind | null {
  const format = context.resolver.numberFormat(attrs);
  if (format === null || format === "none") return null;
  return format === "bullet" ? "bulletList" : "orderedList";
}

/**
 * The kind of list all selected paragraphs are in, or null (none, or mixed).
 * @internal
 */
export function wordListKindAt(state: EditorState): ListKind | null {
  const context = wordContext(state);
  if (!context) return null;
  const kinds = paragraphsIn(state).map(({ node }) => kindOf(context, node.attrs));
  return kinds.length ? common(kinds) : null;
}

/** The paragraph's attributes without numbering (an explicit "none" where its style numbers it). */
function withoutNumbering(context: WordContext, node: Node): Attrs {
  const base = { ...node.attrs, numbering: null };
  const styled = context.resolver.paragraph(base).paragraph.numbering !== null;
  const listStyle = styleNamed(context, "List Paragraph");
  const style = listStyle !== null && node.attrs.style === listStyle ? null : node.attrs.style;
  return { ...base, style, numbering: styled ? { id: 0 } : null };
}

/**
 * Word's levels for a new list: bullets (Symbol, Courier New, Wingdings) or numbers.
 * @internal
 */
export function levels(kind: ListKind): NumberingLevelJSON[] {
  const bullets = [
    ["", "Symbol"],
    ["o", "Courier New"],
    ["", "Wingdings"],
  ] as const;
  const numbers = ["decimal", "lowerLetter", "lowerRoman"] as const;
  return Array.from({ length: 9 }, (_, level) => {
    const paragraph = { indent: { left: STEP * (level + 1), hanging: 360 } };
    if (kind === "bulletList") {
      const [text, font] = bullets[level % 3] as readonly [string, string];
      return {
        level,
        start: 1,
        format: "bullet",
        text,
        justification: "left" as const,
        paragraph,
        run: [{ type: "font", attrs: { ascii: font, hAnsi: font, hint: "default" } }],
      };
    }
    return {
      level,
      start: 1,
      format: numbers[level % 3] as string,
      text: `%${level + 1}.`,
      justification: level % 3 === 2 ? ("right" as const) : ("left" as const),
      paragraph:
        level % 3 === 2 ? { indent: { left: STEP * (level + 1), hanging: 180 } } : paragraph,
    };
  });
}

/** Not a numbering style's definition, nor one that numbers headings (levels linked to styles). */
const plain = (a: AbstractNumberingJSON) =>
  !a.styleLink && !a.numStyleLink && !a.levels.some((l) => l.style);

/** The definition numbering instance `id` uses. */
function abstractOf(context: WordContext, id: number): AbstractNumberingJSON | undefined {
  const { abstracts, instances } = context.envelope.numbering;
  return abstracts.find((a) => a.id === instances.find((n) => n.id === id)?.abstract);
}

/** Level `level` of numbering instance `id`'s definition, if it defines one. */
function levelOf(context: WordContext, id: number, level: number): NumberingLevelJSON | undefined {
  return abstractOf(context, id)?.levels.find((l) => l.level === level);
}

/** Whether numbering instance `id` is a plain list's (not numbered headings'). */
function plainList(context: WordContext, id: number): boolean {
  const abstract = abstractOf(context, id);
  return !!abstract && plain(abstract);
}

/**
 * The numbering instance a new list of `kind` uses: bullets share one (the document's own, or a
 * new definition); a numbered list starts at 1 in a new instance (of a definition of Foli's,
 * made once). Returns the instance id and the envelope with what it added (unchanged if none).
 */
function newList(
  envelope: WordEnvelope,
  kind: ListKind,
  fresh: (after: number) => number,
): { id: number; envelope: WordEnvelope } {
  const { abstracts, instances } = envelope.numbering;
  const format = (a: AbstractNumberingJSON) => a.levels.find((l) => l.level === 0)?.format;
  const found =
    kind === "bulletList"
      ? instances.find((n) => {
          const a = abstracts.find((x) => x.id === n.abstract);
          return a && plain(a) && format(a) === "bullet" && !n.overrides?.length;
        })
      : undefined;
  if (found) return { id: found.id, envelope };
  const nextId = (ids: number[]) => fresh(Math.max(0, ...ids));
  let abstract = abstracts.find(
    (a) => plain(a) && format(a) === (kind === "bulletList" ? "bullet" : "decimal"),
  );
  const added: AbstractNumberingJSON[] = [];
  if (!abstract) {
    abstract = {
      id: fresh(Math.max(-1, ...abstracts.map((a) => a.id))),
      multiLevelType: "hybridMultilevel",
      levels: levels(kind),
    };
    added.push(abstract);
  }
  const instance: NumberingInstanceJSON = {
    id: nextId(instances.map((n) => n.id)),
    abstract: abstract.id,
    // A numbered list starts again at 1 (instances of one definition otherwise go on counting).
    ...(kind === "orderedList" ? { overrides: [{ level: 0, start: 1 }] } : {}),
  };
  return {
    id: instance.id,
    envelope: {
      ...envelope,
      numbering: { abstracts: [...abstracts, ...added], instances: [...instances, instance] },
    },
  };
}

/**
 * The list buttons on a v3 document: when every selected paragraph is in a list of `kind`, takes
 * them out; otherwise numbers them as `kind` (a numbered paragraph keeps its level). A list of
 * that kind right before the selection goes on; otherwise a new one starts. Paragraphs in the
 * default style go to "List Paragraph" where the document has it, as in Word.
 * @internal
 */
export function toggleWordList(kind: ListKind): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context || !paragraphsIn(state).length) return false;
    if (wordListKindAt(state) === kind)
      return updateParagraphs(state, dispatch, (node) => withoutNumbering(context, node));
    return wrapInWordList(kind)(state, dispatch);
  };
}

/**
 * Numbers the selected paragraphs as a list of `kind` (`wrapInList` on a v3 document).
 * @internal
 */
export function wrapInWordList(kind: ListKind): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    const paragraphs = paragraphsIn(state);
    const first = paragraphs[0];
    if (!first) return false;
    // A list the paragraph before is in (its own numbering, not a numbered heading's) goes on.
    const before = first.pos > 0 ? state.doc.resolve(first.pos).nodeBefore : null;
    const previous = (before?.attrs.numbering as { id?: number } | null | undefined)?.id;
    // Paragraphs in the default style go to "List Paragraph" (added if the document lacks it).
    const plain = defaultParagraphStyleOf(context);
    const inPlain = (node: Node) => {
      const style = context.resolver.paragraph(node.attrs).paragraph.style;
      return style === plain || style === null;
    };
    const list = paragraphs.some(({ node }) => inPlain(node))
      ? ensureStyle(context, "List Paragraph")
      : null;
    const listStyle = list?.id ?? null;
    let envelope = list?.envelope ?? context.envelope;
    let id: number;
    if (
      previous &&
      before &&
      kindOf(context, before.attrs) === kind &&
      plainList(context, previous)
    )
      id = previous;
    else ({ id, envelope } = newList(envelope, kind, idsOf(state)));
    return updateParagraphs(
      state,
      dispatch,
      (node) => {
        const current = context.resolver.paragraph(node.attrs).paragraph;
        const level = current.numbering?.level ?? 0;
        const style = listStyle && inPlain(node) ? listStyle : node.attrs.style;
        return { ...node.attrs, style, numbering: { id, level } };
      },
      envelope === context.envelope ? undefined : envelope,
    );
  };
}

/** Whether the caret's paragraph is numbered, and the caret is at its start (or `anywhere`). */
function caretInList(state: EditorState, context: WordContext, atStart: boolean): Node | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph" || (atStart && $from.parentOffset > 0)) return null;
  return context.resolver.paragraph($from.parent.attrs).paragraph.numbering ? $from.parent : null;
}

/**
 * Tab on a v3 document: at the start of a numbered paragraph, one level deeper; over several
 * paragraphs, indents them (list levels, half-inch stops), as Word does. Elsewhere it does not
 * apply (Tab types a tab).
 * @internal
 */
export const sinkWordList: Command = (state, dispatch) => {
  const context = wordContext(state);
  if (!context) return false;
  if (paragraphsIn(state).length < 2 && !caretInList(state, context, true)) return false;
  return changeIndent(1)(state, dispatch);
};

/**
 * Shift+Tab in a list on a v3 document: one level up (out of the list at the top).
 * @internal
 */
export const liftWordList: Command = (state, dispatch) => {
  const context = wordContext(state);
  if (!context) return false;
  const numbered = paragraphsIn(state).some(
    ({ node }) => context.resolver.paragraph(node.attrs).paragraph.numbering,
  );
  return numbered && changeIndent(-1)(state, dispatch);
};

/**
 * Enter in an empty numbered paragraph on a v3 document: one level up, or at the top level ends
 * the list there, as in Word.
 * @internal
 */
export const endWordList: Command = (state, dispatch) => {
  const context = wordContext(state);
  const paragraph = context && caretInList(state, context, true);
  if (!context || !paragraph || paragraph.content.size) return false;
  return changeIndent(-1)(state, dispatch);
};

/**
 * Backspace at the start of a numbered paragraph on a v3 document: removes its number, keeping
 * the text where it was (the level's indent as the paragraph's own); the next Backspace joins.
 * @internal
 */
export const removeWordListNumber: Command = (state, dispatch) => {
  const context = wordContext(state);
  const paragraph = context && caretInList(state, context, true);
  if (!context || !paragraph) return false;
  return updateParagraphs(state, dispatch, (node) => {
    const { indent } = context.resolver.paragraph(node.attrs).paragraph;
    return {
      ...withoutNumbering(context, node),
      indent: { left: indent.left, right: indent.right, firstLine: 0 },
    };
  });
};

// ---------- links ----------

/**
 * Gives newly linked text Word's "Hyperlink" character style (blue, underlined), adding Word's
 * definition where the document does not have it yet.
 * @internal
 */
export function styleLink(tr: Transaction, state: EditorState, from: number, to: number): void {
  const context = wordContext(state);
  const type = state.schema.marks.characterStyle;
  const style = context && type && ensureStyle(context, "Hyperlink", "character");
  if (!context || !type || !style) return;
  tr.addMark(from, to, type.create({ id: style.id }));
  if (style.envelope !== context.envelope) withEnvelope(tr, style.envelope);
}

/**
 * Takes the "Hyperlink" character style off text whose link is removed.
 * @internal
 */
export function unstyleLink(tr: Transaction, state: EditorState, from: number, to: number): void {
  const context = wordContext(state);
  const type = state.schema.marks.characterStyle;
  const style = context && styleNamed(context, "Hyperlink", "character");
  if (!style || !type) return;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (type.isInSet(node.marks)?.attrs.id === style)
      tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), type);
  });
}

// ---------- Word's Font group: scripts, clearing, case, growing ----------

/** Raised or lowered text. */
export type VerticalAlign = "superscript" | "subscript";

/**
 * Word's Superscript and Subscript buttons (Ctrl+Shift+=, Ctrl+=): the selected text (or the
 * text typed next) raised or lowered, or back on its baseline where it all already is.
 */
export function toggleVerticalAlign(value: VerticalAlign): Command {
  return (state, dispatch) => {
    const want = verticalAlignAt(state) === value ? "baseline" : value;
    return setRunMark("verticalAlign", (_existing, inherited, type) =>
      inherited.verticalAlign === want ? null : type.create({ value: want }),
    )(state, dispatch);
  };
}

/**
 * Raises or lowers the selected text (or the text typed next), or puts it back on its baseline:
 * Word's Font dialog's Superscript and Subscript boxes (not a toggle).
 */
export function setVerticalAlign(value: VerticalAlign | "baseline"): Command {
  return setRunMark("verticalAlign", (_existing, inherited, type) =>
    inherited.verticalAlign === value ? null : type.create({ value }),
  );
}

/** Whether the selected text (or the text typed next) is raised or lowered, if all the same. */
export function verticalAlignAt(state: EditorState): VerticalAlign | "baseline" | null {
  return runValueAt(state, (run) => run.verticalAlign);
}

/**
 * The space between the characters of the selected text (or of the text typed next), in points:
 * positive expands, negative condenses (Word's Font dialog, Advanced: -1584 to 1584, kept in
 * twips); null or the styles' value puts back the styles' spacing.
 */
export function setCharacterSpacing(points: number | null): Command {
  return (state, dispatch) => {
    if (points !== null && !(points >= -1584 && points <= 1584)) return false;
    const twips = points === null ? null : Math.round(points * 20);
    return setRunMark("characterSpacing", (_existing, inherited, type) =>
      twips === null || inherited.characterSpacing === twips ? null : type.create({ value: twips }),
    )(state, dispatch);
  };
}

/** The on/off effects of Word's Font dialog, and its Font style (bold, italic). */
export interface RunEffects {
  bold?: boolean | null;
  italic?: boolean | null;
  strike?: boolean | null;
  doubleStrike?: boolean | null;
  caps?: boolean | null;
  smallCaps?: boolean | null;
  hidden?: boolean | null;
}

/** Effects that cannot both be on: turning one on turns the other off. */
const EXCLUSIVE: Partial<Record<keyof RunEffects, keyof RunEffects>> = {
  strike: "doubleStrike",
  doubleStrike: "strike",
  caps: "smallCaps",
  smallCaps: "caps",
};

/**
 * Turns the given effects of the selected text (or the text typed next) on or off; null puts
 * back the styles'. Strikethrough and double strikethrough exclude each other, as all caps and
 * small caps do: turning one on turns the other off unless it is given too. A value the styles
 * already give leaves no direct mark; one they do not is written, off included
 * (`<w:caps w:val="0"/>` over a style's caps). Bold and italic set Latin text's (`w:b`, `w:i`),
 * complex scripts' staying. One transaction.
 */
export function setRunEffects(effects: RunEffects): Command {
  const want: RunEffects = {};
  for (const [key, value] of Object.entries(effects) as [keyof RunEffects, boolean | null][]) {
    if (value === undefined) continue;
    want[key] = value;
    const other = EXCLUSIVE[key];
    if (value === true && other && effects[other] === undefined) want[other] = false;
  }
  return (state, dispatch) =>
    chain(
      state,
      dispatch,
      (Object.entries(want) as [keyof RunEffects, boolean | null][]).map(([key, value]) =>
        setRunMark(key, (existing, inherited, type) => {
          // Bold's and italic's complex-script half (`w:bCs`, `w:iCs`) stays as it is.
          const cs = (existing?.attrs.complexScript as boolean | null | undefined) ?? null;
          const keep = cs === null ? {} : { complexScript: cs };
          if (value === null || inherited[key] === value)
            return cs === null ? null : type.create({ value: null, ...keep });
          return type.create({ value, ...keep });
        }),
      ),
    );
}

/**
 * What all the selected text (or the text typed next) shows of Word's run properties, as the
 * Font dialog reads them: a property the runs differ in is left out (Word's blank box). Null
 * outside a Word document.
 */
export function runFormatAt(state: EditorState): Partial<RunFormat> | null {
  const context = wordContext(state);
  if (!context) return null;
  const { selection } = state;
  const runs = selection.empty
    ? []
    : runsIn(state, state.schema.marks.font as MarkType).filter((r) => r.node.isText);
  // A caret, or no text selected (empty paragraphs, a picture): what text typed there shows.
  if (!runs.length) {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    return runFormat(context, selection.$from.parent, marks);
  }
  return shared(runs.map((r) => runFormat(context, r.parent, r.node.marks)));
}

/** The run marks clearing takes off: links, review and comment marks are not formatting. */
const CLEARED = [
  "bold",
  "italic",
  "underline",
  "strike",
  "doubleStrike",
  "caps",
  "smallCaps",
  "hidden",
  "font",
  "fontSize",
  "color",
  "highlight",
  "shading",
  "verticalAlign",
  "characterSpacing",
];

/**
 * Takes direct character formatting off the selected text (or the text typed next): Word's
 * Ctrl+Space. The text then shows its paragraph's and character style's formatting.
 * `{ all: true }` is Word's Clear All Formatting: the character style goes too and the
 * paragraphs get the default paragraph style; highlight stays, as in Word, and so does list
 * numbering.
 */
export function clearFormatting(options: { all?: boolean } = {}): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    const names = options.all
      ? [...CLEARED.filter((n) => n !== "highlight"), "characterStyle"]
      : CLEARED;
    const types = names.flatMap((n) => state.schema.marks[n] ?? []);
    const { selection } = state;
    if (selection.empty && selection instanceof TextSelection && !options.all) {
      const marks = state.storedMarks ?? marksAt(selection.$from);
      const rest = marks.filter((m) => !types.includes(m.type));
      if (rest.length === marks.length) return false;
      dispatch?.(state.tr.setStoredMarks(rest));
      return true;
    }
    return attempt(state, dispatch, (tr) => {
      for (const type of selection.empty ? [] : types)
        for (const { node, pos } of runsIn(state, type))
          if (type.isInSet(node.marks))
            tr.removeMark(
              Math.max(selection.from, pos),
              Math.min(selection.to, pos + node.nodeSize),
              type,
            );
      if (options.all)
        // No style named is the default paragraph style.
        for (const { node, pos } of selection.empty
          ? [{ node: selection.$from.parent, pos: selection.$from.before() }]
          : paragraphsIn(state))
          if (node.attrs.style != null)
            tr.setNodeMarkup(pos, node.type, { ...node.attrs, style: null });
      // After the steps, which clear stored marks.
      if (selection.empty)
        tr.setStoredMarks(
          (state.storedMarks ?? marksAt(selection.$from)).filter((m) => !types.includes(m.type)),
        );
    });
  };
}

/** Word's Change Case entries; `"cycle"` is Shift+F3's next one. */
export type TextCase = "sentence" | "lower" | "upper" | "title" | "toggle" | "cycle";

const LETTER = /\p{L}/u;
/** What joins a word to the next letter (`don't`, `it’s`): not a word's start. */
const IN_WORD = /[\p{L}\p{N}'’]/u;

/** A run of text the case applies to: where it is, its text and its marks. */
interface CaseRun {
  from: number;
  to: number;
  text: string;
  marks: readonly Mark[];
}

/**
 * For each character of `text` (a paragraph's selected text, `￼` where something else is
 * between runs), whether `kind` writes it upper case (title and sentence case look at what is
 * before it; the others at the character alone). `start`: the paragraph's text before is blank.
 */
function upperAt(text: string, kind: Exclude<TextCase, "cycle">, start: boolean): boolean[] {
  const chars = [...text];
  if (kind === "upper") return chars.map(() => true);
  if (kind === "lower") return chars.map(() => false);
  if (kind === "toggle") return chars.map((c) => c === c.toLocaleLowerCase());
  const out: boolean[] = [];
  let capital = kind === "title" || start;
  let stop = false;
  for (const c of chars) {
    if (kind === "title") {
      out.push(LETTER.test(c) && capital);
      capital = !IN_WORD.test(c);
      continue;
    }
    if (LETTER.test(c)) {
      out.push(capital);
      capital = stop = false;
    } else {
      out.push(false);
      if (/[.!?]/.test(c)) stop = true;
      else if (/\s/.test(c)) capital ||= stop;
      else stop = false;
    }
  }
  return out;
}

/** Shift+F3, as Word: lowercase → Capitalize Each Word → UPPERCASE → lowercase. */
function nextCase(paragraphs: readonly string[]): Exclude<TextCase, "cycle"> {
  const text = paragraphs.join("\n");
  if (text === text.toLocaleLowerCase()) return "title";
  const titled = paragraphs.every((p) => {
    const upper = upperAt(p, "title", true);
    return [...p].every((c, i) => c === (upper[i] ? c.toLocaleUpperCase() : c.toLocaleLowerCase()));
  });
  return titled && text !== text.toLocaleUpperCase() ? "upper" : "lower";
}

/** The word around a caret (null between words). */
function wordAt(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, "￼");
  let from = $from.parentOffset;
  let to = from;
  while (from > 0 && LETTER.test(text[from - 1] ?? "")) from--;
  while (to < text.length && LETTER.test(text[to] ?? "")) to++;
  return from === to ? null : { from: $from.start() + from, to: $from.start() + to };
}

/**
 * Word's Change Case: the selected text (or the word at the caret) in another case, its
 * formatting kept; tracked as a deletion and an insertion while tracking, as in Word. Each
 * paragraph is cased on its own (sentence case starts one where the paragraph starts); text of
 * tracked deletions is left as it is.
 */
export function changeCase(kind: TextCase): Command {
  return (state, dispatch) => {
    if (!wordContext(state)) return false;
    const { selection } = state;
    const word = selection.empty ? wordAt(state) : null;
    const ranges = word ? [word] : selection.empty ? [] : selection.ranges;
    const deletion = state.schema.marks.deletion;
    // The runs of each paragraph, in order, and each paragraph's text (gaps as U+FFFC).
    const paragraphs: { runs: CaseRun[]; text: string; start: boolean }[] = [];
    let last = null as Node | null;
    for (const range of ranges)
      state.doc.nodesBetween(range.from, range.to, (node, pos, parent) => {
        if (!node.isText) return !node.isInline;
        if (deletion?.isInSet(node.marks)) return false;
        const from = Math.max(range.from, pos);
        const to = Math.min(range.to, pos + node.nodeSize);
        const run = {
          from,
          to,
          text: (node.text ?? "").slice(from - pos, to - pos),
          marks: node.marks,
        };
        const paragraph = paragraphs.at(-1);
        if (paragraph && parent === last) {
          const before = paragraph.runs.at(-1) as CaseRun;
          paragraph.text += (before.to === from ? "" : "￼") + run.text;
          paragraph.runs.push(run);
        } else {
          const $from = state.doc.resolve(from);
          const start = /^\s*$/.test($from.parent.textBetween(0, $from.parentOffset));
          paragraphs.push({ runs: [run], text: run.text, start });
        }
        last = parent;
        return false;
      });
    if (!paragraphs.some((p) => LETTER.test(p.text))) return false;
    const target = kind === "cycle" ? nextCase(paragraphs.map((p) => p.text)) : kind;
    // Each run's new text, character by character (a case can change a character's length: ß).
    const changes: { run: CaseRun; text: string }[] = [];
    for (const paragraph of paragraphs) {
      const upper = upperAt(paragraph.text, target, paragraph.start);
      let at = 0;
      for (const [i, run] of paragraph.runs.entries()) {
        if (i > 0 && paragraph.runs[i - 1]?.to !== run.from) at++;
        const text = [...run.text]
          .map((c) => (upper[at++] ? c.toLocaleUpperCase() : c.toLocaleLowerCase()))
          .join("");
        if (text !== run.text) changes.push({ run, text });
      }
    }
    if (!changes.length) return false;
    return attempt(state, dispatch, (tr) => {
      for (const { run, text } of changes) {
        const from = tr.mapping.map(run.from);
        tr.delete(from, tr.mapping.map(run.to));
        tr.insert(from, state.schema.text(text, run.marks));
      }
      // A text selection keeps covering the text; others map as they do.
      if (selection instanceof TextSelection && !selection.empty)
        tr.setSelection(
          TextSelection.create(
            tr.doc,
            tr.mapping.map(selection.from, -1),
            tr.mapping.map(selection.to),
          ),
        );
    });
  };
}

/** Word's sizes for Grow Font and Shrink Font, in points. */
const STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/**
 * The next size up or down from `points`, as Word's Grow Font and Shrink Font step: by 1 under
 * 8 pt, Word's sizes to 72, by 10 above (1 to 1638 pt).
 */
export function nextFontSize(points: number, direction: 1 | -1): number {
  if (direction > 0) {
    if (points < 8) return Math.floor(points) + 1;
    if (points >= 72) return Math.min(1638, Math.floor(points / 10) * 10 + 10);
    return STEPS.find((s) => s > points) ?? 72;
  }
  if (points <= 8) return Math.max(1, Math.ceil(points) - 1);
  if (points > 80) return Math.ceil(points / 10) * 10 - 10;
  return [...STEPS].reverse().find((s) => s < points) ?? 8;
}

/**
 * Word's Grow Font and Shrink Font (Ctrl+Shift+> and <): each run of the selection (or the text
 * typed next) one of Word's sizes up or down from its own.
 */
export function stepFontSize(direction: 1 | -1): Command {
  return setRunMark("fontSize", (existing, inherited, type) => {
    // From the run's own size (`inherited` is without its mark).
    const own = (existing?.attrs.value as number | null | undefined) ?? inherited.size;
    const ownCs = (existing?.attrs.complexScript as number | null | undefined) ?? inherited.sizeCs;
    const half = nextFontSize(own / 2, direction) * 2;
    const halfCs = nextFontSize(ownCs / 2, direction) * 2;
    if (inherited.size === half && inherited.sizeCs === halfCs) return null;
    return type.create({
      value: inherited.size === half ? null : half,
      complexScript: inherited.sizeCs === halfCs ? null : halfCs,
    });
  });
}

/** Word's underline styles (`w:u`) the toolbar offers; a document's other ones are kept. */
export const UNDERLINE_STYLES = [
  "single",
  "words",
  "double",
  "thick",
  "dotted",
  "dash",
  "dotDash",
  "dotDotDash",
  "wave",
] as const;

/**
 * The selected text (or the text typed next) underlined in `style`; null removes it. `color`
 * (`#rrggbb`, null for automatic; left out: the text's own stays) is the underline's color, as
 * Word's Font dialog sets it.
 */
export function setUnderline(style: string | null, color?: string | null): Command {
  return setRunMark("underline", (existing, inherited, type) => {
    if (style === null) return inherited.underline === null ? null : type.create({ style: "none" });
    // Left out: the color the text shows now, its own or its style's.
    const want =
      color === undefined
        ? ((existing?.attrs.color as string | null) ?? inherited.underlineColor ?? null)
        : color && word(color);
    if (inherited.underline === style && want === (inherited.underlineColor ?? null)) return null;
    return type.create({ style, color: want });
  });
}

/** The underline style of the selected text (or the text typed next) if all the same: "none" for none. */
export function underlineAt(state: EditorState): string | null {
  return runValueAt(state, (run) => run.underline ?? "none");
}

// ---------- format painter ----------

/** What the format painter copied: run property marks and paragraph properties. */
interface CopiedFormat {
  run: readonly Mark[];
  paragraph: Attrs;
}

/** The format painter's state: what it copied, and whether the next selection gets it. */
interface PainterState {
  format: CopiedFormat | null;
  /** `once`: the next selection gets the format (Word's click); `sticky`: until stopped. */
  armed: "once" | "sticky" | null;
}

const painterKey = new PluginKey<PainterState>("formatPainter");
const RUN_MARKS = new Set<string>(RUN_PROPERTY_MARKS);

/** @internal The format painter's state field (built in). */
export function formatPainterPlugin(): Plugin<PainterState> {
  return new Plugin<PainterState>({
    key: painterKey,
    state: {
      init: () => ({ format: null, armed: null }),
      apply: (tr, value) => (tr.getMeta(painterKey) as PainterState | undefined) ?? value,
    },
    keymap: {
      // Escape puts an armed painter away (and goes on to whatever else it does otherwise).
      Escape: (state, dispatch) => stopFormatPainter(state, dispatch),
    },
  });
}

/** Whether the format painter has a format, and whether the next selection gets it. */
export function formatPainterState(state: EditorState): {
  copied: boolean;
  armed: "once" | "sticky" | null;
} {
  const value = painterKey.getState(state);
  return { copied: Boolean(value?.format), armed: value?.armed ?? null };
}

/**
 * Word's Format Painter, and Ctrl+Shift+C: copies the formatting where the selection starts (its
 * run's formatting and its paragraph's properties). `armed`: the next selection made with the
 * pointer gets it once (a click on Format Painter), or each one until `stopFormatPainter` (a
 * double-click); null only copies it (Ctrl+Shift+C).
 */
export function copyFormat(armed: "once" | "sticky" | null = null): Command {
  return (state, dispatch) => {
    if (!wordContext(state) || !painterKey.getState(state)) return false;
    const { $from, empty } = state.selection;
    let marks: readonly Mark[] = state.storedMarks ?? marksAt($from);
    if (!empty) {
      let first: readonly Mark[] | null = null;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
        if (first === null && node.isText) first = node.marks;
        return first === null;
      });
      if (first) marks = first;
    }
    const paragraph: Attrs = Object.fromEntries(
      // Not `ext`, the source's own `w:pPr` (its section, revision ids, unknown children).
      PARAGRAPH_PROPERTY_KEYS.flatMap((k) =>
        $from.parent.type.name === "paragraph" && k !== "ext"
          ? [[k, $from.parent.attrs[k] ?? null]]
          : [],
      ),
    );
    const format = { run: marks.filter((m) => RUN_MARKS.has(m.type.name)), paragraph };
    dispatch?.(state.tr.setMeta(painterKey, { format, armed }));
    return true;
  };
}

/** Puts an armed format painter away; false when none is armed. */
export const stopFormatPainter: Command = (state, dispatch) => {
  const value = painterKey.getState(state);
  if (!value?.armed) return false;
  dispatch?.(state.tr.setMeta(painterKey, { ...value, armed: null }));
  return true;
};

/**
 * Gives the selection (or the word at a caret) the copied formatting: Ctrl+Shift+V, and what the
 * view runs after a pointer selection while the painter is armed. The run formatting replaces the
 * text's own; paragraphs the selection covers whole get the paragraph properties too, as Word's
 * painter gives them to a selection that holds the paragraph mark. One undo step; tracked while
 * tracking. False when nothing was copied.
 */
export const pasteFormat: Command = (state, dispatch) => {
  const value = painterKey.getState(state);
  const format = value?.format;
  if (!format || !wordContext(state)) return false;
  const { selection } = state;
  const word = selection.empty ? wordAt(state) : null;
  const target = word ? TextSelection.create(state.doc, word.from, word.to) : selection;
  // A click on no word still puts a once-armed painter away, as in Word.
  if (target.empty) {
    if (value.armed !== "once") return false;
    dispatch?.(state.tr.setMeta(painterKey, { ...value, armed: null }));
    return true;
  }
  const at = state.apply(state.tr.setSelection(target));
  const tr = state.tr;
  const types = RUN_PROPERTY_MARKS.flatMap((n) => state.schema.marks[n] ?? []);
  for (const type of types)
    for (const { node, pos } of runsIn(at, type)) {
      const from = Math.max(target.from, pos);
      const to = Math.min(target.to, pos + node.nodeSize);
      const existing = type.isInSet(node.marks);
      const mark = format.run.find((m) => m.type === type);
      // Unchanged runs stay untouched: no empty undo step, no tracked change of nothing.
      if (mark ? existing?.eq(mark) : !existing) continue;
      if (existing) tr.removeMark(from, to, type);
      if (mark) tr.addMark(from, to, mark);
    }
  // Paragraph properties only to a selection the user made (a click paints the word alone).
  for (const { node, pos } of word ? [] : paragraphsIn(at)) {
    const whole = target.from <= pos + 1 && target.to >= pos + node.nodeSize - 1;
    if (!whole) continue;
    const attrs = { ...node.attrs, ...format.paragraph };
    if (json(attrs) !== json(node.attrs)) tr.setNodeMarkup(pos, node.type, attrs);
  }
  if (value.armed === "once") tr.setMeta(painterKey, { ...value, armed: null });
  if (!tr.docChanged && !value.armed) return false;
  dispatch?.(tr);
  return true;
};

// ---------- formatting marks ----------

/**
 * A switch of what shows, kept in the body's state (a story asks its body's): formatting marks,
 * the ruler. Nothing of it is in the document, and switching it is no undo step.
 */
function viewSwitch(name: string) {
  const key = new PluginKey<boolean>(name);
  const plugin = (): Plugin<boolean> =>
    new Plugin<boolean>({
      key,
      state: {
        init: () => false,
        apply: (tr, value) => (tr.getMeta(key) as boolean | undefined) ?? value,
      },
    });
  const shown = (state: EditorState): boolean =>
    key.getState(storyBody(state)?.state ?? state) === true;
  const set =
    (on: boolean | null): Command =>
    (state, dispatch) => {
      const body = storyBody(state);
      if (body) return dispatch ? body.run(set(on)) : body.can(set(on));
      const value = key.getState(state);
      if (value === undefined) return false;
      dispatch?.(state.tr.setMeta(key, on ?? !value));
      return true;
    };
  return { plugin, shown, set };
}

const marks = viewSwitch("formattingMarks");
const ruler = viewSwitch("ruler");

/** @internal Whether formatting marks show (built in; a story asks its body's). */
export const formattingMarksPlugin = marks.plugin;

/** Whether the view shows formatting marks: Word's Show/Hide ¶ (the body's setting, in a story). */
export const formattingMarksShown = marks.shown;

/** @internal Whether the ruler shows (built in; a story asks its body's). */
export const rulerPlugin = ruler.plugin;

/**
 * Whether the app shows Word's rulers: the View tab's Ruler (`toggleRuler`). The editor only
 * keeps the switch; `FoliEditor`'s `ruler` (or the app's own `FoliRuler`) draws them.
 */
export const rulerShown = ruler.shown;

/** Word's View tab's Ruler: the rulers show, or stop (`rulerShown`). */
export const toggleRuler: Command = ruler.set(null);

/** Shows (true) or hides the rulers (`rulerShown`). */
export const setRulerShown = (on: boolean): Command => ruler.set(on);

/**
 * Word's Show/Hide ¶ (Ctrl+Shift+8 with `wordKeymap()`): the view draws paragraph marks, spaces,
 * tabs and breaks over the text, or stops. Nothing of them is in the document.
 */
export const toggleFormattingMarks: Command = marks.set(null);

// ---------- paragraph borders and shading (32.4) ----------

/** A paragraph's borders (`w:pBdr`): its sides, the one between paragraphs alike, a bar. */
export type ParagraphBorders = Partial<
  Record<"top" | "bottom" | "left" | "right" | "between" | "bar", BorderJSON>
>;

/** Home ▸ Borders' entries (Word's): one side, none, all, outside, inside. */
export type BorderPreset =
  | "bottom"
  | "top"
  | "left"
  | "right"
  | "none"
  | "all"
  | "outside"
  | "inside";

const PRESET_SIDES: Record<BorderPreset, readonly (keyof ParagraphBorders)[]> = {
  bottom: ["bottom"],
  top: ["top"],
  left: ["left"],
  right: ["right"],
  none: [],
  all: ["top", "bottom", "left", "right", "between"],
  outside: ["top", "bottom", "left", "right"],
  inside: ["between"],
};

/** Word's default border: a half-point single line, a point from the text (four at the sides). */
const DEFAULT_LINE: BorderJSON = { style: "single", size: 4, space: 1, color: "auto" };
const lineFor = (side: string, line: BorderJSON): BorderJSON =>
  line === DEFAULT_LINE && (side === "left" || side === "right") ? { ...line, space: 4 } : line;

const drawn = (border: BorderJSON | undefined) =>
  !!border && border.style !== "none" && border.style !== "nil";

/**
 * Whether every selected paragraph shows a border on each of `preset`'s sides (its own, or its
 * style's): what Home ▸ Borders checks, and what turns the entry off.
 */
export function paragraphsHaveBorder(state: EditorState, preset: BorderPreset): boolean {
  const context = wordContext(state);
  const sides = PRESET_SIDES[preset];
  const paragraphs = paragraphsIn(state);
  if (!context || !sides.length || !paragraphs.length) return false;
  return paragraphs.every(({ node }) => {
    const shown = context.resolver.paragraph(node.attrs).paragraph.borders ?? {};
    return sides.every((side) => drawn(shown[side]));
  });
}

/**
 * Home ▸ Borders on the selected paragraphs, as Word's menu: a side, All, Outside or Inside (the
 * border between paragraphs) turns its sides on (with `line`, by default Word's half-point
 * single line), or off when every paragraph shows them already; None removes them. A side the
 * paragraph's style draws is turned off as Word does, with a `nil` border of its own. One undo
 * step; tracked as paragraph formatting.
 */
export function setParagraphBorder(preset: BorderPreset, line: BorderJSON = DEFAULT_LINE): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context) return false;
    if (line !== DEFAULT_LINE && checkParagraphProperties({ borders: { top: line } })) return false;
    const sides = preset === "none" ? PRESET_SIDES.all : PRESET_SIDES[preset];
    const off = preset === "none" || paragraphsHaveBorder(state, preset);
    return updateParagraphs(state, dispatch, (node) => {
      const own = (node.attrs.borders as ParagraphBorders | null) ?? {};
      // What the style alone draws: those sides need a `nil` of the paragraph's own to go.
      const styled = context.resolver.paragraph({ ...node.attrs, borders: null }).paragraph.borders;
      const next: ParagraphBorders = { ...own };
      for (const side of sides) {
        if (!off) next[side] = lineFor(side, line);
        else if (drawn(styled?.[side])) next[side] = { style: "nil" };
        else delete next[side];
      }
      return { ...node.attrs, borders: Object.keys(next).length ? next : null };
    });
  };
}

/**
 * Sets the selected paragraphs' borders to `borders` (the Borders and Shading dialog), null
 * removing them. One undo step; tracked as paragraph formatting.
 */
export function setParagraphBorders(borders: ParagraphBorders | null): Command {
  return (state, dispatch) => {
    if (!wordContext(state)) return false;
    const value = borders && Object.keys(borders).length ? borders : null;
    if (value && checkParagraphProperties({ borders: value })) return false;
    return updateParagraphs(state, dispatch, (node) => ({ ...node.attrs, borders: value }));
  };
}

/** A paragraph's shading (`w:shd`): Word's pattern (`clear`, `solid`, `pct10`…), its color, the fill. */
export interface ParagraphShading {
  pattern: string;
  color?: string;
  fill?: string;
}

/**
 * Sets the selected paragraphs' shading, null removing it. One undo step; tracked as paragraph
 * formatting.
 */
export function setParagraphShading(shading: ParagraphShading | null): Command {
  return (state, dispatch) => {
    if (!wordContext(state)) return false;
    if (shading && checkParagraphProperties({ shading })) return false;
    return updateParagraphs(state, dispatch, (node) => ({ ...node.attrs, shading }));
  };
}

/**
 * The selected paragraphs' own borders and shading when they share them (null: none or mixed;
 * a style's are not included).
 */
export function paragraphBordersAt(
  state: EditorState,
): { borders: ParagraphBorders | null; shading: ParagraphShading | null } | null {
  const paragraphs = paragraphsIn(state);
  if (!wordContext(state) || !paragraphs.length) return null;
  return {
    borders: common(paragraphs.map(({ node }) => node.attrs.borders as ParagraphBorders | null)),
    shading: common(paragraphs.map(({ node }) => node.attrs.shading as ParagraphShading | null)),
  };
}
