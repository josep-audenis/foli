/**
 * Picture commands (10.8, ADR-0006): inserting an inline picture (its image a new resource of
 * the envelope; alt text required, or the picture marked decorative), and changing a picture's
 * size and alt text. Inserting and deleting a picture is tracked like text while tracking; its
 * size does not change while tracking (Foli does not record it yet); alt text, which Word does
 * not track either, changes any time.
 */
import type { Node } from "../model/index.js";
import { TransformError } from "../transform/index.js";
import type { ResourceJSON } from "../v3/document.js";
import { checkResource } from "../v3/document.js";
import { attempt } from "./attempt.js";
import { deleteSelectionKeepingTables } from "./commands.js";
import { closeHistory } from "./history.js";
import { typedMarks } from "./mark.js";
import { marksAt, NodeSelection, TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { trackState, untracked } from "./track.js";
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
/** Alt text and titles as the schema holds them. */
const validText = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.length <= 65_535);
/** A `data:` URL's media type, lower case. */
const dataType = (data: string) => /^data:([^;,]*)/i.exec(data)?.[1]?.toLowerCase();

/**
 * Inserts `picture` at the selection (replacing it), its image added to the document's
 * resources under a new key. Does not apply without alt text (unless decorative, or
 * `requireAlt` is false: a picture pasted or dropped, asked for later and marked), with an image
 * the document cannot hold (not an image type, no URL or `data:` URL, an unsafe URL), or where
 * the selection is not in text.
 */
export function insertPicture(
  picture: NewPicture,
  { requireAlt = true }: { requireAlt?: boolean } = {},
): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const type = state.schema.nodes.picture;
    if (!context || !type) return false;
    if (!validText(picture.alt) || !validText(picture.title)) return false;
    const alt = picture.decorative ? "" : (picture.alt?.trim() ?? "");
    if (!alt && !picture.decorative && requireAlt) return false;
    if (!validSize(picture.width) || !validSize(picture.height)) return false;
    // The bytes are of the type the document says (a part is named from it on export).
    if (
      picture.data !== undefined &&
      dataType(String(picture.data)) !== String(picture.contentType).toLowerCase()
    )
      return false;
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
      // Over selected cells, into the anchor cell (as typing goes).
      if (!tr.selection.empty) deleteSelectionKeepingTables(tr, true);
      const $pos = tr.selection.$from;
      if (!$pos.parent.inlineContent || !$pos.parent.type.contentMatch.matchType(type))
        throw new TransformError("No text where the picture would go");
      // The marks typing would get there (its run's properties, a link), never a tracked
      // change's: tracking marks it as its own.
      const marks = typedMarks(state.storedMarks ?? marksAt($pos)).filter((m) =>
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

/** A picture's crop, each side in 1000ths of a percent of its image (25 000: a quarter). */
export interface PictureCrop {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

/** A turn, in DrawingML's 60 000ths of a degree. */
const TURN = 21_600_000;

/**
 * Sets the rotation of the picture at `pos`, clockwise in 60 000ths of a degree (90°: 5 400 000;
 * any value is taken modulo a turn, 0 is none). Not while tracking (Foli does not record it).
 */
export function setPictureRotation(pos: number, rotation: number): Command {
  return (state, dispatch) => {
    const node = pictureAt(state, pos);
    if (!node || trackState(state)?.on === true || !Number.isFinite(rotation)) return false;
    const turn = ((Math.round(rotation) % TURN) + TURN) % TURN;
    if (node.attrs.rotation === turn) return false;
    return changePicture(state, dispatch, pos, node, { rotation: turn });
  };
}

/**
 * Crops the picture at `pos` to `crop` (sides missing or 0 cut nothing; `{}` takes a crop off),
 * as Word does: the image keeps its scale, so the picture's size grows or shrinks with what
 * shows of it. Refused when nothing would be left, or while tracking.
 */
export function setPictureCrop(pos: number, crop: PictureCrop): Command {
  return (state, dispatch) => {
    const node = pictureAt(state, pos);
    if (!node || trackState(state)?.on === true) return false;
    const side = (c: PictureCrop | null | undefined, key: keyof PictureCrop) => {
      const v = c?.[key];
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
    };
    const old = node.attrs.crop as PictureCrop | null;
    const next = {
      left: side(crop, "left"),
      top: side(crop, "top"),
      right: side(crop, "right"),
      bottom: side(crop, "bottom"),
    };
    const across = 100_000 - next.left - next.right;
    const down = 100_000 - next.top - next.bottom;
    if (across <= 0 || down <= 0) return false;
    const wasAcross = 100_000 - side(old, "left") - side(old, "right");
    const wasDown = 100_000 - side(old, "top") - side(old, "bottom");
    const width = Math.round((Number(node.attrs.width) / wasAcross) * across);
    const height = Math.round((Number(node.attrs.height) / wasDown) * down);
    if (!validSize(width) || !validSize(height)) return false;
    const sides = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== 0));
    if (old !== null && JSON.stringify(sides) === JSON.stringify(sidesOf(old))) return false;
    return changePicture(state, dispatch, pos, node, { crop: sides, width, height });
  };
}

const sidesOf = (crop: PictureCrop) =>
  Object.fromEntries(
    (["left", "top", "right", "bottom"] as const)
      .filter((k) => typeof crop[k] === "number" && crop[k] !== 0)
      .map((k) => [k, crop[k]]),
  );

/** `attrs` on the picture at `pos`, as one undo step, the picture kept selected. */
function changePicture(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
  node: Node,
  attrs: Record<string, unknown>,
): boolean {
  return attempt(state, dispatch, (tr) => {
    tr.setMeta(closeHistory, true);
    tr.setNodeMarkup(pos, node.type, { ...node.attrs, ...attrs });
    if (state.selection instanceof NodeSelection && state.selection.from === pos)
      tr.setSelection(NodeSelection.create(tr.doc, pos));
  });
}

/**
 * Sets the alt text of the picture at `pos`, or marks it decorative (no alt text). Does not
 * apply with empty alt text unless decorative.
 */
export function setPictureAlt(pos: number, alt: string, decorative = false): Command {
  return (state, dispatch) => {
    const node = pictureAt(state, pos);
    if (!node || !validText(alt)) return false;
    // A decorative picture has no alt text (a screen reader passes it by).
    const text = decorative ? null : alt.trim() || null;
    if (!text && !decorative) return false;
    if (node.attrs.alt === text && (node.attrs.decorative === true) === decorative) return false;
    return attempt(state, dispatch, (tr) => {
      // Not a tracked change, as in Word.
      tr.setMeta(closeHistory, true).setMeta(untracked, true);
      tr.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        alt: text,
        decorative: decorative || null,
      });
      if (state.selection instanceof NodeSelection && state.selection.from === pos)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
    });
  };
}
