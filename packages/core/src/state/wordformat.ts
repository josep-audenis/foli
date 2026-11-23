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
  NumberingInstanceJSON,
  NumberingLevelJSON,
  StyleJSON,
} from "../v3/document.js";
import type { RunFormat } from "../v3/resolve.js";
import { attempt } from "./attempt.js";
import { idsOf } from "./ids.js";
import { marksAt, TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import {
  isMarker,
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
  if (selection.empty) {
    const marks = state.storedMarks ?? marksAt(selection.$from);
    return read(runFormat(context, selection.$from.parent, marks));
  }
  return common(
    runsIn(state, state.schema.marks.font as MarkType)
      .filter((r) => r.node.isText)
      .map((r) => read(runFormat(context, r.parent, r.node.marks))),
  );
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
  let current = state;
  let tr: Transaction | null = null;
  for (const command of commands) {
    command(current, (next) => {
      // Each command's steps go on the first transaction; stored marks and selection too.
      if (!tr) tr = next;
      else {
        for (const step of next.steps) tr.step(step);
        if (next.storedMarks !== current.storedMarks) tr.setStoredMarks(next.storedMarks);
      }
      current = current.apply(next);
    });
  }
  if (!tr) return false;
  dispatch?.(tr);
  return true;
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
  node: Node,
  key: string,
  value: unknown,
  shows: (paragraph: ReturnType<WordContext["resolver"]["paragraph"]>["paragraph"]) => boolean,
): Attrs {
  const without = { ...node.attrs, [key]: null };
  const inherited = context.resolver.paragraph(without).paragraph;
  return shows(inherited) ? without : { ...node.attrs, [key]: value };
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
        node,
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

/**
 * Line spacing of the selected paragraphs as a multiple of single spacing (1, 1.15, 1.5, 2…);
 * null puts back the styles' spacing. Space before and after stays.
 */
export function setLineSpacing(multiple: number | null): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context || (multiple !== null && !(multiple > 0 && multiple <= 132))) return false;
    const line = multiple === null ? null : Math.round(multiple * 240);
    return updateParagraphs(state, dispatch, (node) => {
      const own = { ...((node.attrs.spacing as Record<string, unknown> | null) ?? {}) };
      delete own.line;
      delete own.lineRule;
      const base = { ...node.attrs, spacing: Object.keys(own).length ? own : null };
      const inherited = context.resolver.paragraph(base).paragraph.spacing;
      if (line === null || (inherited.line === line && inherited.lineRule === "auto")) return base;
      return { ...node.attrs, spacing: { ...own, line, lineRule: "auto" } };
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
