import type { Node, NodeJSON } from "../model/index.js";
import type { EditorState } from "./state.js";
import { wordContext } from "./word.js";

/** What Word's Word Count dialog shows, without what only the pages know (lines, pages). */
export interface WordCount {
  /** Runs of characters between spaces (an em dash does not split a word, as in Word). */
  words: number;
  /** Characters but spaces, tabs and breaks. */
  characters: number;
  /** Characters with spaces and tabs. */
  charactersWithSpaces: number;
  /** Paragraphs with some text. */
  paragraphs: number;
}

export interface CountOptions {
  /** Only this range of the body; default: the whole body. */
  from?: number | undefined;
  to?: number | undefined;
  /** Only the selection (its ranges: a cell selection's selected cells). */
  selection?: boolean | undefined;
  /** Text boxes, footnotes and endnotes too, as Word's "Include textboxes, footnotes and endnotes". */
  notes?: boolean | undefined;
}

/** The whole body's count, by document: a selection moving does not count it again. */
const counted = new WeakMap<Node, WordCount>();

/**
 * Counts the document's words, characters and paragraphs as Word's Word Count does: the body (or
 * a range of it, or the selection), its notes on request; text of tracked deletions is not
 * counted, insertions are (Word's count with changes shown). Field codes, bookmarks, comment and
 * control ends are not text; a line break separates words, a tab is a character with spaces.
 */
export function countWords(state: EditorState, options: CountOptions = {}): WordCount {
  const whole =
    options.from === undefined && options.to === undefined && !options.selection && !options.notes;
  const known = whole ? counted.get(state.doc) : undefined;
  if (known) return known;
  const count: WordCount = { words: 0, characters: 0, charactersWithSpaces: 0, paragraphs: 0 };
  const paragraph = (text: string) => {
    if (!text.trim()) return;
    count.paragraphs++;
    count.words += text.split(/\s+/u).filter(Boolean).length;
    count.characters += [...text.replace(/\s+/gu, "")].length;
    count.charactersWithSpaces += [...text.replace(/[\r\n]/gu, "")].length;
  };
  const deleted = (marks: readonly { type: { name: string } | string }[] | undefined) =>
    marks?.some((m) => (typeof m.type === "string" ? m.type : m.type.name) === "deletion") ?? false;
  /** What a leaf that is not text adds: a line break splits words, a tab is a character. */
  const leaf = (type: string) => (type === "hardBreak" ? "\n" : type === "tab" ? "\t" : "");
  const ranges = options.selection
    ? state.selection.ranges
    : [{ from: options.from ?? 0, to: options.to ?? state.doc.content.size }];
  for (const { from, to } of ranges)
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      let text = "";
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (start + child.nodeSize <= from || start >= to) return;
        if (!child.isText) text += leaf(child.type.name);
        else if (!deleted(child.marks))
          text += (child.text ?? "").slice(Math.max(0, from - start), to - start);
      });
      paragraph(text);
      return false;
    });
  if (options.notes) {
    const stories = wordContext(state)?.envelope.stories ?? {};
    const walk = (node: NodeJSON): string => {
      if (node.type === "text") return deleted(node.marks) ? "" : (node.text ?? "");
      if (!node.content) return leaf(node.type);
      const inner = node.content.map(walk).join("");
      if (node.type !== "paragraph") return inner;
      paragraph(inner);
      return "";
    };
    for (const story of Object.values(stories))
      if (
        story.kind === "textBox" ||
        ((story.kind === "footnote" || story.kind === "endnote") &&
          (story.noteType ?? "normal") === "normal")
      )
        walk(story.content);
  }
  if (whole) counted.set(state.doc, Object.freeze(count));
  return count;
}
