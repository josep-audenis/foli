/**
 * Equations (35.5, schema 12, ADR-0018): an `equation` node holds Word's OMML. These commands put
 * one in and change one; the view (`@folijs/view`'s `unicodeMathToOmml`) writes the OMML from an
 * equation's linear form.
 */
import type { Node } from "../model/index.js";
import { attempt } from "./attempt.js";
import { closeHistory } from "./history.js";
import { marksAt, NodeSelection } from "./selection.js";
import type { Command, EditorState } from "./state.js";
import { trackState } from "./track.js";
import { wordContext } from "./word.js";

const DISPLAY = /^<(?:[\w.-]+:)?oMathPara[\s>/]/;

/** Whether `xml` is a display equation (`m:oMathPara`, on a line of its own). */
export const isDisplayEquation = (xml: string) => DISPLAY.test(xml);

/** The selected equation and its position, or null. */
export function selectedEquation(state: EditorState): { node: Node; pos: number } | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "equation"
    ? { node: selection.node, pos: selection.from }
    : null;
}

/**
 * Insert ▸ Equation: an equation of OMML `xml` (an `m:oMath`, or an `m:oMathPara` for a display
 * one) in place of the selection, in the selection's run formatting, one undo step, then selected.
 * Not while tracking changes (Word tracks an equation's runs one by one; Foli does not).
 */
export function insertEquation(xml: string): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes.equation;
    const { $from } = state.selection;
    if (!type || !wordContext(state) || trackState(state)?.on === true) return false;
    if (!$from.parent.inlineContent) return false;
    let node: Node;
    try {
      node = type.create({ xml }, null, marksAt($from));
      node.check();
    } catch {
      return false;
    }
    if (!dispatch) return true;
    return attempt(state, dispatch, (tr) => {
      if (!state.selection.empty) tr.deleteSelection();
      const at = tr.selection.from;
      tr.insert(at, node);
      tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta(closeHistory, true);
    });
  };
}

/** The equation at `pos` given new OMML (its edited linear form, written back), one undo step. */
export function setEquation(pos: number, xml: string): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type.name !== "equation" || trackState(state)?.on === true) return false;
    if (node.attrs.xml === xml) return false;
    try {
      node.type.create({ xml }, null, node.marks).check();
    } catch {
      return false;
    }
    if (!dispatch) return true;
    return attempt(state, dispatch, (tr) => {
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, xml });
      tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta(closeHistory, true);
    });
  };
}
