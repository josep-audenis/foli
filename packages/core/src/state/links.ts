import type { Mark, MarkType, ResolvedPos } from "../model/index.js";
import { isSafeHref } from "../schema.js";
import { TransformError } from "../transform/transform.js";
import { attempt } from "./attempt.js";
import { AllSelection, marksAt, TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";

const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.\p{L}{2,}$/iu;
/**
 * A host name with a dot and a letter TLD (`www.` alone is enough; letters in any script), then a
 * port, path or end.
 */
const DOMAIN = /^(?:www\.|(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:[:/?#]|$))/iu;
const AUTOLINK = /^(?:https?:\/\/|mailto:|www\.)\S+$/i;

/**
 * Cleans up a typed or pasted URL before validation (`isSafeHref`): trims it, turns `\` into
 * `/`, percent-encodes spaces, and adds the scheme people leave out: `mailto:` for an email
 * address, `https://` for a host name (`example.com/page`, `www.example.com`). A relative
 * file name that looks like a host (`page.html`) becomes one too: write `./page.html`.
 */
export function normalizeHref(input: string): string {
  const href = input.trim().replace(/\\/g, "/").replace(/ /g, "%20");
  if (EMAIL.test(href)) return `mailto:${href}`;
  if (DOMAIN.test(href)) return `https://${href}`;
  return href;
}

/**
 * The href for pasted plain text that is one URL (`http(s)://…`, `mailto:…`, `www.…`), or null:
 * pasting it makes a link.
 */
export function autolinkHref(text: string): string | null {
  const trimmed = text.trim();
  if (!AUTOLINK.test(trimmed)) return null;
  const href = normalizeHref(trimmed);
  return isSafeHref(href) ? href : null;
}

const linkType = (state: EditorState): MarkType | undefined => state.schema.marks.link;

/**
 * The link around a caret (touching it at either edge, so a caret just after a link edits that
 * link), with its extent, or null.
 */
function linkAround(
  $pos: ResolvedPos,
  type: MarkType,
): { from: number; to: number; mark: Mark } | null {
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const index = $pos.index();
  for (const i of $pos.textOffset ? [index] : [index - 1, index]) {
    const mark = type.isInSet(parent.maybeChild(i)?.marks ?? []);
    if (!mark) continue;
    let start = i;
    let end = i + 1;
    while (start > 0 && mark.isInSet(parent.child(start - 1).marks)) start--;
    while (end < parent.childCount && mark.isInSet(parent.child(end).marks)) end++;
    let from = $pos.start();
    let to = from;
    for (let c = 0; c < end; c++) {
      const size = parent.child(c).nodeSize;
      if (c < start) from += size;
      to += size;
    }
    return { from, to, mark };
  }
  return null;
}

/** Whether the selection is in (or holds) text that can take a link. */
function canLink(state: EditorState, type: MarkType): boolean {
  const { selection } = state;
  if (selection.empty) {
    const { parent } = selection.$from;
    return parent.inlineContent && parent.type.allowsMarkType(type);
  }
  let found = false;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isTextblock && node.type.allowsMarkType(type)) found = true;
    return !found;
  });
  return found;
}

/**
 * The href of the link at the selection: around a caret, or the one link all selected text has
 * (null when text has no link or different ones).
 */
export function linkAt(state: EditorState): string | null {
  const type = linkType(state);
  if (!type) return null;
  const { selection } = state;
  if (selection.empty)
    return (linkAround(selection.$from, type)?.mark.attrs.href as string) ?? null;
  // undefined: no text seen yet; null: text without a link, or with another one.
  let href = undefined as string | null | undefined;
  state.doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (href === null) return false;
    if (!node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
    const value = (type.isInSet(node.marks)?.attrs.href as string | undefined) ?? null;
    href = href === undefined || href === value ? value : null;
    return false;
  });
  return href ?? null;
}

/**
 * Replaces the selection with `text` (default: the href) linked to `href` (normalized, then
 * validated: an unsafe href does not apply). The text keeps the marks typing would get there.
 */
export function insertLink(href: string, text?: string): Command {
  return (state, dispatch) => {
    const type = linkType(state);
    const normalized = normalizeHref(href);
    const label = text ?? normalized;
    const { selection } = state;
    if (!type || !label || !isSafeHref(normalized)) return false;
    if (!(selection instanceof AllSelection) && !canLink(state, type)) return false;
    const link = type.create({ href: normalized });
    return attempt(state, dispatch, (tr) => {
      const marks = state.storedMarks ?? marksAt(selection.$from);
      tr.deleteSelection();
      const pos = tr.selection.from;
      const parent = tr.doc.resolve(pos).parent;
      if (!parent.inlineContent || !parent.type.allowsMarkType(type)) {
        throw new TransformError("No link here");
      }
      const allowed = marks.filter((mark) => parent.type.allowsMarkType(mark.type));
      tr.insertText(label, pos, pos, link.addToSet(allowed));
      tr.setSelection(TextSelection.create(tr.doc, pos + label.length));
    });
  };
}

/**
 * Links the selected text to `href` (normalized, then validated: an unsafe href does not apply),
 * replacing other links there. At a caret in (or at the edge of) a link, changes that link's
 * href; elsewhere inserts the href as linked text.
 */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const type = linkType(state);
    const normalized = normalizeHref(href);
    if (!type || !isSafeHref(normalized) || !canLink(state, type)) return false;
    const mark = type.create({ href: normalized });
    const { selection } = state;
    if (!selection.empty) {
      return attempt(state, dispatch, (tr) => tr.addMark(selection.from, selection.to, mark));
    }
    const around = linkAround(selection.$from, type);
    if (!around) return insertLink(normalized)(state, dispatch);
    return attempt(state, dispatch, (tr) => tr.addMark(around.from, around.to, mark));
  };
}

/** Removes the links in the selection; at a caret, the whole link around it. */
export const removeLink: Command = (state, dispatch) => {
  const type = linkType(state);
  if (!type) return false;
  const { selection } = state;
  const range = selection.empty ? linkAround(selection.$from, type) : selection;
  if (!range) return false;
  return attempt(state, dispatch, (tr) => tr.removeMark(range.from, range.to, type));
};

/** Transaction metadata set by `openLinkEditor`; a link editing UI listens for it. */
export const linkEditorRequest = "linkEditorRequest";

/**
 * Mod-K: asks the UI to open its link editor (the React toolbar's link dialog), with a
 * transaction that changes nothing and carries `linkEditorRequest`. Does not apply where text
 * cannot take a link. Without such a UI, Mod-K does nothing.
 */
export const openLinkEditor: Command = (state, dispatch) => {
  const type = linkType(state);
  if (!type || !canLink(state, type)) return false;
  dispatch?.(state.tr.setMeta(linkEditorRequest, true));
  return true;
};

/** Whether `tr` asks for the link editor (`openLinkEditor`). */
export const requestsLinkEditor = (tr: Transaction): boolean =>
  tr.getMeta(linkEditorRequest) === true;
