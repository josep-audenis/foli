import type { NodeJSON } from "../model/index.js";
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
  /** Only this range of the body (a selection); default: the whole body. */
  from?: number | undefined;
  to?: number | undefined;
  /** Footnotes and endnotes too, as Word's "Include textboxes, footnotes and endnotes". */
  notes?: boolean | undefined;
}

/**
 * Counts the document's words, characters and paragraphs as Word's Word Count does: the body (or
 * a range of it), its notes on request; text of tracked deletions is not counted, insertions are
 * (Word's count with changes shown). Field codes are not text; their results are.
 */
export function countWords(state: EditorState, options: CountOptions = {}): WordCount {
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
  const from = options.from ?? 0;
  const to = options.to ?? state.doc.content.size;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (start + child.nodeSize <= from || start >= to) return;
      if (child.isText) {
        if (deleted(child.marks)) return;
        text += (child.text ?? "").slice(Math.max(0, from - start), to - start);
      } else if (child.type.name === "tab") text += "\t";
      else if (child.isInline && child.isLeaf) text += " ";
    });
    paragraph(text);
    return false;
  });
  if (options.notes) {
    const stories = wordContext(state)?.envelope.stories ?? {};
    const walk = (node: NodeJSON): string => {
      if (node.type === "text") return deleted(node.marks) ? "" : (node.text ?? "");
      const inner = (node.content ?? []).map(walk).join("");
      if (node.type === "paragraph") {
        paragraph(inner);
        return "";
      }
      return node.type === "tab" ? "\t" : inner;
    };
    for (const story of Object.values(stories))
      if (story.kind === "footnote" || story.kind === "endnote") walk(story.content);
  }
  return count;
}
