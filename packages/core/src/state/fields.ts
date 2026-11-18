/**
 * Word's fields in the editor (ADR-0007, 11.8): finding them over a tree of markers, what a view
 * hides or shows of them, and the selection rules (a field is selected whole when the selection
 * crosses its markers; the caret never rests in what is hidden). Their instructions and results:
 * `fieldupdate.ts`.
 */
import type { Node } from "../model/index.js";
import { type Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, PluginKey } from "./state.js";
import { storyBody } from "./word.js";

/** A field of a tree, partners found by nesting depth. Positions are the tree's. */
export interface Field {
  /** Before its `fieldStart`. */
  from: number;
  /** After its `fieldEnd`. */
  to: number;
  /** Before its `fieldSeparator`; null without one. */
  separator: number | null;
  /** Where the code range ends: the separator, or the `fieldEnd`. */
  codeEnd: number;
  resultFrom: number;
  /** Before the `fieldEnd`. */
  resultTo: number;
  /** The instruction, nested fields in the code standing as their results. */
  instruction: string;
  /** Its first word in capitals (`PAGE`, `TOC`). */
  name: string;
  /** The result as text: tabs, line breaks as "\n", paragraphs as "\r"; deleted text left out. */
  result: string;
  locked: boolean;
  /** Its start is a tracked deletion. */
  deleted: boolean;
  /** The field around it, if any. */
  parent: Field | null;
  /** It stands in `parent`'s code. */
  inCode: boolean;
}

const known = new WeakMap<Node, readonly Field[]>();
const isDeleted = (node: Node) => node.marks.some((m) => m.type.name === "deletion");

/** The fields of `tree` in document order (outer before inner). Unpaired markers are ignored. */
export function fieldsIn(tree: Node): readonly Field[] {
  const cached = known.get(tree);
  if (cached) return cached;
  interface Open {
    field: Field;
    code: string;
    text: string;
    /** A paragraph ended inside its result, to be counted before more text. */
    broke: boolean;
  }
  const fields: Field[] = [];
  const open: Open[] = [];
  const add = (text: string) => {
    const top = open[open.length - 1];
    if (!top || !text) return;
    if (top.field.separator === null) top.code += text;
    else {
      if (top.broke) top.text += "\r";
      top.broke = false;
      top.text += text;
    }
  };
  tree.descendants((node, pos) => {
    if (node.isTextblock) {
      for (const entry of open) if (entry.field.separator !== null) entry.broke = true;
      return true;
    }
    if (!node.isInline) return true;
    const top = open[open.length - 1];
    switch (node.type.name) {
      case "fieldStart":
        open.push({
          code: "",
          text: "",
          broke: false,
          field: {
            from: pos,
            to: pos,
            separator: null,
            codeEnd: pos,
            resultFrom: pos,
            resultTo: pos,
            instruction: "",
            name: "",
            result: "",
            locked: node.attrs.locked === true,
            deleted: isDeleted(node),
            parent: top?.field ?? null,
            inCode: !!top && top.field.separator === null,
          },
        });
        break;
      case "fieldCode":
        if (top?.field.separator === null) top.code += String(node.attrs.text ?? "");
        break;
      case "fieldSeparator":
        if (top?.field.separator === null) top.field.separator = pos;
        break;
      case "fieldEnd": {
        const entry = open.pop();
        if (!entry) break;
        const { field } = entry;
        field.to = pos + 1;
        field.codeEnd = field.separator ?? pos;
        field.resultFrom = field.separator === null ? pos : field.separator + 1;
        field.resultTo = pos;
        field.instruction = entry.code.trim();
        field.name = (/^\S*/.exec(field.instruction)?.[0] ?? "").toUpperCase();
        field.result = entry.text;
        fields.push(field);
        add(entry.text);
        break;
      }
      case "text":
        if (!isDeleted(node)) add(node.text ?? "");
        break;
      case "tab":
        if (!isDeleted(node)) add("\t");
        break;
      case "hardBreak":
        if (!isDeleted(node)) add("\n");
        break;
      default:
    }
    return false;
  });
  fields.sort((a, b) => a.from - b.from);
  if (open.length) {
    const lost = new Set(open.map((entry) => entry.field));
    for (const field of fields)
      if (field.parent && lost.has(field.parent)) {
        field.parent = null;
        field.inCode = false;
      }
  }
  known.set(tree, fields);
  return fields;
}

/** The innermost field with `pos` strictly inside it. */
export function fieldAround(tree: Node, pos: number): Field | null {
  let found: Field | null = null;
  for (const field of fieldsIn(tree)) {
    if (field.from >= pos) break;
    if (pos < field.to) found = field;
  }
  return found;
}

/** The innermost field holding the node at `pos`: the field a marker there belongs to. */
export function fieldOfPart(tree: Node, pos: number): Field | null {
  let found: Field | null = null;
  for (const field of fieldsIn(tree)) {
    if (field.from > pos) break;
    if (pos < field.to) found = field;
  }
  return found;
}

/** Field markers a caret walking over a paragraph meets. */
export const isFieldPart = (node: Node | null | undefined): boolean =>
  !!node && FIELD_PARTS.has(node.type.name);
const FIELD_PARTS = new Set(["fieldStart", "fieldCode", "fieldSeparator", "fieldEnd"]);

// ---------- what is shown ----------

/** How a view draws a paragraph's inline nodes, by index. */
export interface FieldDisplay {
  /** Nodes not drawn: what is in a code range or, with codes shown, in a result. */
  hidden: ReadonlySet<number>;
  /** With codes shown: the brace a field marker draws. */
  braces: ReadonlyMap<number, "{" | "}">;
  /** Nothing of the paragraph shows, its mark included: it takes no room. */
  gone: boolean;
}

const NOTHING: FieldDisplay = { hidden: new Set(), braces: new Map(), gone: false };
/** Inline nodes with nothing to draw of their own. */
const UNSEEN = new Set([
  ...FIELD_PARTS,
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "commentReference",
  "controlStart",
  "controlEnd",
]);

/**
 * What a view draws of paragraphs in document order, each given as its inline nodes' type names.
 * A code range is hidden; with `codes`, the codes show between braces and the results are hidden.
 */
export function fieldDisplay(
  paragraphs: readonly (readonly string[])[],
  codes: boolean,
): FieldDisplay[] {
  // The markers that have partners, as paragraph and index.
  const key = (p: number, i: number) => p * 65_536 + i;
  const roles = new Map<number, "start" | "separator" | "end">();
  const stack: { at: number; separator: number | null }[] = [];
  paragraphs.forEach((types, p) => {
    types.forEach((type, i) => {
      if (type === "fieldStart") stack.push({ at: key(p, i), separator: null });
      else if (type === "fieldSeparator") {
        const top = stack[stack.length - 1];
        if (top && top.separator === null) top.separator = key(p, i);
      } else if (type === "fieldEnd") {
        const top = stack.pop();
        if (!top) return;
        roles.set(top.at, "start");
        if (top.separator !== null) roles.set(top.separator, "separator");
        roles.set(key(p, i), "end");
      }
    });
  });
  if (!roles.size) return paragraphs.map(() => NOTHING);
  const phases: ("code" | "result")[] = [];
  let inCode = 0;
  let inResult = 0;
  const concealed = () => (codes ? inResult > 0 : inCode > 0);
  return paragraphs.map((types, p) => {
    const hidden = new Set<number>();
    const braces = new Map<number, "{" | "}">();
    const openAtStart = concealed();
    let seen = false;
    types.forEach((type, i) => {
      const role = roles.get(key(p, i));
      if (role === "start") {
        if (codes && !inResult) braces.set(i, "{");
        phases.push("code");
        inCode++;
      } else if (role === "separator") {
        inCode--;
        if (codes && !inResult) braces.set(i, "}");
        inResult++;
        phases[phases.length - 1] = "result";
      } else if (role === "end") {
        if (phases.pop() === "code") {
          inCode--;
          if (codes && !inResult) braces.set(i, "}");
        } else inResult--;
      } else if (concealed()) hidden.add(i);
      else if (!UNSEEN.has(type) || (codes && type === "fieldCode")) seen = true;
    });
    const gone = openAtStart && concealed() && !seen && !braces.size;
    return hidden.size || braces.size || gone ? { hidden, braces, gone } : NOTHING;
  });
}

// ---------- codes shown, and the selection ----------

const key = new PluginKey<boolean>("fields");

/** Whether fields show their codes (one setting for the document, its stories included). */
export const fieldCodesShown = (state: EditorState): boolean =>
  key.getState(storyBody(state)?.state ?? state) === true;

/** Word's Alt+F9: shows or hides every field's code. */
export const toggleFieldCodes: Command = (state, dispatch) => {
  const body = storyBody(state);
  if (body) return dispatch ? body.run(toggleFieldCodes) : body.can(toggleFieldCodes);
  const shown = key.getState(state);
  if (shown === undefined) return false;
  dispatch?.(state.tr.setMeta(key, !shown));
  return true;
};

/** Whether `pos` is somewhere the caret cannot be seen, in `field`. */
function concealedIn(field: Field, pos: number, codes: boolean): boolean {
  if (codes) return field.separator !== null && pos > field.separator && pos < field.to;
  return pos > field.from && pos <= field.codeEnd;
}

/** `pos`, out of every hidden range: on in the direction of travel. */
function outOfHidden(fields: readonly Field[], at: number, forward: boolean, codes: boolean) {
  let pos = at;
  for (let again = true; again; ) {
    again = false;
    for (const field of fields) {
      if (!concealedIn(field, pos, codes)) continue;
      const separator = field.separator as number;
      if (codes) pos = forward ? field.to : separator;
      else if (!forward) pos = field.from;
      else pos = field.separator === null ? field.to : separator + 1;
      again = true;
    }
  }
  return pos;
}

/**
 * The selection `selection` should be, if it should change: out of hidden ranges, and a range with
 * one end inside a field and the other outside it grown over the whole field (or, when the head
 * comes back into it from outside, stopped before it).
 */
function settled(state: EditorState, previous: Selection): Selection | null {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection)) return null;
  const fields = fieldsIn(doc);
  if (!fields.length) return null;
  const codes = fieldCodesShown(state);
  const movedOn = selection.head >= previous.head;
  let head = outOfHidden(fields, selection.head, movedOn, codes);
  let anchor = selection.empty
    ? head
    : outOfHidden(fields, selection.anchor, selection.anchor > selection.head, codes);
  const inside = (field: Field, pos: number) => pos > field.from && pos < field.to;
  if (anchor !== head)
    for (let again = true, rounds = 0; again && rounds < 64; rounds++) {
      again = false;
      for (const field of fields) {
        if (field.deleted || inside(field, anchor) === inside(field, head)) continue;
        again = true;
        if (inside(field, anchor)) anchor = head > field.from ? field.from : field.to;
        // The head coming back over the field it had taken in stops on the other side.
        else if (anchor < field.from) head = previous.head >= field.to ? field.from : field.to;
        else head = previous.head <= field.from ? field.to : field.from;
      }
    }
  return anchor === selection.anchor && head === selection.head
    ? null
    : TextSelection.create(doc, anchor, head);
}

/** The fields' state, and the selection kept to their rules. */
export function fieldsPlugin(): Plugin<boolean> {
  return new Plugin({
    key,
    state: {
      init: () => false,
      apply: (tr, shown) => (tr.getMeta(key) as boolean | undefined) ?? shown,
    },
    appendTransaction(_transactions, before, after) {
      if (
        before.selection.eq(after.selection) &&
        before.doc === after.doc &&
        fieldCodesShown(before) === fieldCodesShown(after)
      )
        return null;
      const next = settled(after, before.selection);
      return next ? after.tr.setSelection(next) : null;
    },
  });
}

/** The whole of `field` as a selection. */
export const fieldSelection = (tree: Node, field: Field): Selection =>
  TextSelection.create(tree, field.from, field.to);
