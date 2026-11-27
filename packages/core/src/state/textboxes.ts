/**
 * Text boxes (Phase 33, ADR-0016). A text box is a `textBox` node in the body or in a header or
 * footer, its text a story of kind `textBox` (`textbox:<n>`), edited as a note's is. A text box
 * that goes takes its story in the same transaction (one undo step), as a note's reference does.
 */

import type { Node } from "../model/index.js";
import { parseContent } from "../v3/document.js";
import { closeHistory } from "./history.js";
import { NodeSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { isRemote, Plugin } from "./state.js";
import { untracked } from "./track.js";
import { type Story, StoryStep, storyAfter, storyBody, wordContext } from "./word.js";

const NONE: readonly string[] = [];
const inBlocks = new WeakMap<Node, readonly string[]>();

/** The stories of the text boxes in a block, cached by node. */
function boxesInBlock(block: Node): readonly string[] {
  let found = inBlocks.get(block);
  if (!found) {
    const list: string[] = [];
    block.descendants((node) => {
      if (node.type.name === "textBox") list.push(String(node.attrs.story));
      return true;
    });
    found = list.length ? list : NONE;
    inBlocks.set(block, found);
  }
  return found;
}

/**
 * The stories of the text boxes in `doc`.
 * @internal
 */
export function textBoxesIn(doc: Node): Set<string> {
  const out = new Set<string>();
  doc.forEach((block) => {
    for (const id of boxesInBlock(block)) out.add(id);
  });
  return out;
}

/** The text boxes of the body and of every header and footer. */
function allBoxes(state: EditorState): Set<string> {
  const out = textBoxesIn(state.doc);
  for (const story of wordContext(state)?.stories.values() ?? [])
    if (story.kind === "header" || story.kind === "footer")
      for (const id of textBoxesIn(story.doc)) out.add(id);
  return out;
}

/**
 * A story id for a new text box: `textbox:<n>`, free in the document.
 * @internal
 */
export function freshTextBoxId(state: EditorState, taken: ReadonlySet<string> = new Set()) {
  const stories = wordContext(state)?.stories;
  let n = 1;
  while (stories?.has(`textbox:${n}`) || taken.has(`textbox:${n}`)) n++;
  return `textbox:${n}`;
}

/**
 * Keeps text boxes' stories with their nodes: a story whose text box the transaction took from
 * the body and every header and footer goes too, in its undo step (a story no node showed
 * before stays: it is not this edit's to remove).
 * @internal
 */
export function textBoxesPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, before, after) {
      const was = wordContext(before);
      const now = wordContext(after);
      if (
        !now ||
        (before.doc === after.doc && was?.stories === now.stories) ||
        transactions.some((t) => t.getMeta("historyOp")) ||
        transactions.every(isRemote) ||
        ![...now.stories.values()].some((s) => s.kind === "textBox")
      )
        return null;
      const shown = allBoxes(after);
      const shownBefore = allBoxes(before);
      const tr: Transaction = after.tr.setMeta(untracked, true);
      for (const [id, story] of now.stories) {
        if (story.kind !== "textBox" || shown.has(id) || !shownBefore.has(id)) continue;
        const current = storyAfter(after, tr, id);
        if (current) tr.step(new StoryStep(id, current, null));
      }
      return tr.steps.length ? tr : null;
    },
  });
}

/** What `insertTextBox` makes: Word's drawn text box unless said otherwise. */
export interface InsertTextBoxOptions {
  /** In EMU (default 2 by 1 inches). */
  width?: number;
  height?: number;
  /** In line with text instead of floating (square, at the paragraph's top left). */
  inline?: boolean;
}

/**
 * Inserts a text box at the end of the selection (Insert ▸ Text Box, 33.3): floating, wrapped
 * square at its paragraph's top left, 2 by 1 inches, white with Word's thin black line, holding
 * an empty paragraph; its story added in the same undo step. Selects the box. Not in a story
 * (shortcut: Word also puts boxes in headers; insert one there from the body's view later).
 */
export function insertTextBox(options: InsertTextBoxOptions = {}): Command {
  return (state, dispatch) => {
    if (!wordContext(state) || storyBody(state)) return false;
    const { $to } = state.selection;
    if (!$to.parent.inlineContent) return false;
    if (!dispatch) return true;
    const id = freshTextBoxId(state);
    const box = state.schema.node("textBox", {
      story: id,
      width: options.width ?? 1_828_800,
      height: options.height ?? 914_400,
      fill: "FFFFFF",
      outline: { color: "000000", width: 6350 },
      float: options.inline
        ? null
        : {
            horizontal: { relativeTo: "column", offset: 0 },
            vertical: { relativeTo: "paragraph", offset: 0 },
            wrap: "square",
            side: "bothSides",
            distance: { top: 0, bottom: 0, left: 114_300, right: 114_300 },
          },
    });
    const tr = state.tr.setMeta(closeHistory, true);
    tr.insert($to.pos, box);
    tr.setSelection(NodeSelection.create(tr.doc, $to.pos));
    const story: Story = {
      kind: "textBox",
      doc: parseContent(
        { type: "doc", content: [{ type: "paragraph" }] },
        { schema: state.schema },
      ),
    };
    tr.step(new StoryStep(id, null, story));
    dispatch(tr);
    return true;
  };
}

/** The text box selected (a node selection of one), or null. */
export function selectedTextBox(state: EditorState): Node | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "textBox"
    ? selection.node
    : null;
}
