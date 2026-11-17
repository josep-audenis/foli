/**
 * Picture commands (10.8, ADR-0006): inserting an inline picture (its image a new resource of
 * the envelope; alt text required, or the picture marked decorative), and changing a picture's
 * size and alt text. Inserting and deleting a picture is tracked like text while tracking; its
 * size does not change while tracking (Foli does not record it yet); alt text, which Word does
 * not track either, changes any time.
 */
import type { Node } from "../model/index.js";
import type { ResourceJSON } from "../v3/document.js";
import { checkResource } from "../v3/document.js";
import { attempt } from "./attempt.js";
import { deleteSelectionKeepingTables } from "./commands.js";
import { closeHistory } from "./history.js";
import { marksAt, NodeSelection, TextSelection } from "./selection.js";
import type { Command, EditorState } from "./state.js";
import { trackState } from "./track.js";
import { withEnvelope, wordContext } from "./word.js";

/** The largest size the schema takes, in EMU. */
const MAX_EMU = 2_147_483_647;

/** A picture to insert: its image (a `data:` URL or a URL the app gave) and its size in EMU. */
export interface NewPicture {
  /** The image's media type (`image/png`…). */
  contentType: string;
  /** Where the image is: a URL the app gave (an upload's) … */
  url?: string;
  /** … or, opted into, a `data:` URL holding it. */
  data?: string;
  width: number;
  height: number;
  /** Required unless `decorative`. */
  alt?: string;
  title?: string;
  /** Marked decorative: no alt text needed (a screen reader passes it by). */
  decorative?: boolean;
}

const validSize = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_EMU;

/**
 * Inserts `picture` at the selection (replacing it), its image added to the document's
 * resources under a new key. Does not apply without alt text (unless decorative), with an image
 * the document cannot hold (not an image type, no URL or `data:` URL, an unsafe URL), or where
 * the selection is not in text.
 */
export function insertPicture(picture: NewPicture): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const type = state.schema.nodes.picture;
    if (!context || !type) return false;
    const alt = picture.alt?.trim();
    if (!alt && !picture.decorative) return false;
    if (!validSize(picture.width) || !validSize(picture.height)) return false;
    const resource: ResourceJSON = {
      contentType: picture.contentType,
      ...(picture.url !== undefined ? { url: picture.url } : {}),
      ...(picture.data !== undefined ? { data: picture.data } : {}),
    };
    if (checkResource(resource) !== undefined) return false;
    const resources = context.envelope.resources ?? {};
    let n = Object.keys(resources).length + 1;
    while (Object.hasOwn(resources, `foli-picture-${n}`)) n++;
    const key = `foli-picture-${n}`;
    const node = type.create({
      resource: key,
      width: picture.width,
      height: picture.height,
      alt: alt || null,
      title: picture.title || null,
      decorative: picture.decorative || null,
    });
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      if (!tr.selection.empty) deleteSelectionKeepingTables(tr);
      const $pos = tr.selection.$from;
      if (!$pos.parent.inlineContent || !$pos.parent.type.contentMatch.matchType(type))
        throw new RangeError("No text where the picture would go");
      // The marks typing would get there (its run's properties), as Word gives a new picture.
      const marks = (state.storedMarks ?? marksAt($pos)).filter((m) =>
        $pos.parent.type.allowsMarkType(m.type),
      );
      tr.insert($pos.pos, node.mark(marks));
      withEnvelope(tr, { ...context.envelope, resources: { ...resources, [key]: resource } });
      tr.setSelection(TextSelection.create(tr.doc, $pos.pos + 1));
    });
  };
}

/** The selected picture (a node selection of one) and its position, if any. */
export function selectedPicture(state: EditorState): { node: Node; pos: number } | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "picture"
    ? { node: selection.node, pos: selection.from }
    : null;
}

/** The picture at `pos`, if there is one. */
const pictureAt = (state: EditorState, pos: number) => {
  const node = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
  return node?.type.name === "picture" ? node : null;
};

/**
 * Sets the size (EMU) of the picture at `pos`. Not while tracking (Foli does not record a
 * picture's size change yet).
 */
export function setPictureSize(pos: number, width: number, height: number): Command {
  return (state, dispatch) => {
    const node = pictureAt(state, pos);
    if (!node || trackState(state)?.on === true) return false;
    if (!validSize(width) || !validSize(height)) return false;
    if (node.attrs.width === width && node.attrs.height === height) return false;
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, width, height });
      // The picture stays selected (a resize keeps working on it).
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}

/**
 * Sets the alt text of the picture at `pos`, or marks it decorative (no alt text). Does not
 * apply with empty alt text unless decorative.
 */
export function setPictureAlt(pos: number, alt: string, decorative = false): Command {
  return (state, dispatch) => {
    const node = pictureAt(state, pos);
    const text = alt.trim();
    if (!node || (!text && !decorative)) return false;
    if (text.length > 65_535) return false;
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        alt: text || null,
        decorative: decorative || null,
      });
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}
