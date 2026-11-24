/**
 * Inserting what is not text (23.6): pictures, page and section breaks, horizontal rules,
 * footnotes and endnotes, next to or in a paragraph, each through core's command for it so
 * every insertion is tracked as the editor tracks it.
 */
import {
  insertNote,
  insertPageBreak,
  insertPicture,
  insertSectionBreak,
  type Node,
  type SectionBreakKind,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import {
  type Changed,
  type Context,
  changed,
  inline,
  insert,
  lockedControls,
  MAX_WRITTEN,
  paragraphAt,
  placesIn,
  quote,
} from "./operations.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** A picture's image: its bytes, its type, and what it shows for a reader who cannot see it. */
export interface PictureItem {
  kind: "picture";
  data: Uint8Array;
  /** `image/png`, `image/jpeg`, `image/gif`: left out, read from the bytes. */
  contentType?: string;
  /** Alt text, required: what the picture shows. */
  alt: string;
  /** In points; with one of them, the other keeps the image's proportions. Default: its size, fitted to the page. */
  width?: number;
  height?: number;
}
/** What `insertItem` inserts. */
export type InsertItem =
  | PictureItem
  | { kind: "pageBreak" }
  | { kind: "sectionBreak"; start?: SectionBreakKind }
  | { kind: "horizontalRule" }
  | { kind: "footnote" | "endnote"; text: string; on?: string };

export interface InsertItemOptions {
  /** A picture or a rule as a paragraph of its own after (default) or before the block; a break at the paragraph's end or start. */
  where?: "after" | "before";
}

/**
 * A paragraph `insert` made to hold a picture or a rule: none of its neighbour's properties
 * (a heading's style, a list's number), only the content controls it is in.
 */
function plain(context: Context, handle: string, extra: Record<string, unknown> = {}): boolean {
  const found = context.handles.resolve(handle);
  if (!found) return false;
  const { editor } = context;
  editor.dispatch(
    editor.state.tr.setNodeMarkup(found.pos, found.node.type, {
      controls: found.node.attrs.controls ?? null,
      // Its own insertion stays recorded: rejecting it takes the paragraph out.
      revision: found.node.attrs.revision ?? null,
      ...extra,
    }),
  );
  return true;
}

/** EMU per point, as DrawingML measures. */
const EMU = 12_700;
/** The largest size a picture has, in EMU (as core's schema holds it). */
const MAX_EMU = 2_147_483_647;
/** The text width when the page does not say, in points (A4 with 2.54 cm margins). */
const TEXT_WIDTH = 451;

/** An image's size in pixels and its type, from its first bytes; null when not known. */
export function imageInfo(
  bytes: Uint8Array,
): { width: number; height: number; contentType: string } | null {
  const at = (i: number) => bytes[i] ?? 0;
  const be16 = (i: number) => (at(i) << 8) | at(i + 1);
  const be32 = (i: number) =>
    ((at(i) << 24) >>> 0) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3);
  // PNG: the signature, then IHDR's width and height.
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    String.fromCharCode(at(12), at(13), at(14), at(15)) === "IHDR"
  )
    return { width: be32(16), height: be32(20), contentType: "image/png" };
  // GIF: GIF87a or GIF89a, then the screen's width and height, little-endian.
  const gif = String.fromCharCode(at(0), at(1), at(2), at(3), at(4), at(5));
  if (gif === "GIF87a" || gif === "GIF89a")
    return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8), contentType: "image/gif" };
  // JPEG: markers up to a start of frame (SOF0–SOF15 but DHT, JPG and DAC).
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: be16(i + 7), height: be16(i + 5), contentType: "image/jpeg" };
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** @internal Bytes as base64, with no platform's encoder (the package runs anywhere core does). */
export function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    // A string per 196 K characters (48 K entries of 4), not one array of all: a large picture's memory.
    if (out.length >= 0xc000) {
      chunks.push(out.join(""));
      out = [];
    }
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out.push(
      B64[(n >> 18) & 63] as string,
      B64[(n >> 12) & 63] as string,
      b === undefined ? "=" : (B64[(n >> 6) & 63] as string),
      c === undefined ? "=" : (B64[n & 63] as string),
    );
  }
  chunks.push(out.join(""));
  return chunks.join("");
}

/** The body's text width in points, from the last section's page. */
function textWidth(context: Context): number {
  const section = wordContext(context.editor.state)?.envelope.section;
  const width = section?.pageSize?.width;
  const margins = section?.margins as { left?: number; right?: number } | undefined;
  if (typeof width !== "number") return TEXT_WIDTH;
  return Math.max(36, (width - (margins?.left ?? 1440) - (margins?.right ?? 1440)) / 20);
}

const KINDS = ["picture", "pageBreak", "sectionBreak", "horizontalRule", "footnote", "endnote"];
const STARTS: readonly SectionBreakKind[] = ["nextPage", "continuous", "evenPage", "oddPage"];

/** Why `item` cannot be inserted as given, or null. */
function wrong(item: unknown): string | null {
  if (!item || typeof item !== "object" || !KINDS.includes((item as { kind?: string }).kind ?? ""))
    return `kind is one of ${KINDS.join(", ")}.`;
  const i = item as Record<string, unknown>;
  const size = (v: unknown) =>
    v === undefined || (typeof v === "number" && v >= 1 && v <= 22 * 72 * 10);
  if (i.kind === "picture") {
    if (!(i.data instanceof Uint8Array) || !i.data.length)
      return "A picture needs its image's bytes.";
    if (typeof i.alt !== "string" || !i.alt.trim())
      return "A picture needs alt text: what it shows, for a reader who cannot see it.";
    if (!size(i.width) || !size(i.height)) return "width and height are in points, 1 to 15840.";
  }
  if (
    i.kind === "sectionBreak" &&
    i.start !== undefined &&
    !STARTS.includes(i.start as SectionBreakKind)
  )
    return `start is one of ${STARTS.join(", ")}.`;
  if (
    (i.kind === "footnote" || i.kind === "endnote") &&
    (typeof i.text !== "string" || !i.text.trim())
  )
    return "A note needs its text.";
  if ((i.kind === "footnote" || i.kind === "endnote") && (i.text as string).length > MAX_WRITTEN)
    return `A note's text is at most ${MAX_WRITTEN} characters.`;
  return null;
}

/** @internal */
export function insertItem(
  context: Context,
  handle: string,
  item: InsertItem,
  options: InsertItemOptions = {},
): Result<Changed> {
  const { editor } = context;
  const why = wrong(item);
  if (why) return refuse("invalid", why);
  const where = options.where ?? "after";
  if (where !== "after" && where !== "before")
    return refuse("invalid", 'where is "after" or "before".');
  const target: Refusal | { pos: number; node: Node } = paragraphAt(
    context,
    handle,
    "it goes next to or in a paragraph",
  );
  if ("ok" in target) return target;
  const locked = lockedControls(context, target.pos, target.node)[0];
  if (locked)
    return refuse(
      "read-only",
      `Block ${handle} is in the locked content control ${quote(locked)}: nothing goes in it.`,
    );
  const end = target.pos + target.node.nodeSize - 1;
  const caret = where === "after" ? end : target.pos + 1;
  const before = editor.state.doc;
  const failed = (what: string) =>
    refuse(
      "refused",
      `${what} could not be inserted ${where === "after" ? "after" : "before"} block ${handle}. Nothing was changed.`,
    );

  switch (item.kind) {
    case "pageBreak": {
      editor.select(caret);
      if (!editor.run(insertPageBreak) || editor.state.doc === before)
        return failed("A page break");
      return { ok: true, ...changed(context, [handle]) };
    }
    case "sectionBreak": {
      if (editor.state.doc.resolve(target.pos).depth !== 0)
        return refuse(
          "invalid",
          "A section break goes in a paragraph of the body, not in a table.",
        );
      editor.select(caret);
      if (!editor.run(insertSectionBreak(item.start ?? "nextPage")) || editor.state.doc === before)
        return failed("A section break");
      // The paragraph split there. The handle follows the paragraph mark, which is the second
      // part's: the first part, ending the section, is a paragraph of its own.
      const now = context.handles.resolve(handle);
      const first = now ? editor.state.doc.resolve(now.pos).nodeBefore : null;
      const handles = [handle];
      if (now && first) handles.unshift(context.handles.at(now.pos - first.nodeSize, first));
      return { ok: true, ...changed(context, handles) };
    }
    case "horizontalRule": {
      // Word's horizontal line: an empty paragraph with a bottom border, as typing --- makes.
      const made = insert(context, handle, [""], where);
      if (!made.ok) return made;
      const rule = made.blocks[0]?.handle as string;
      const borders = { bottom: { style: "single", size: 6, space: 1, color: "auto" } };
      if (!plain(context, rule, { borders })) return failed("A horizontal line");
      return { ok: true, ...changed(context, [rule]) };
    }
    case "footnote":
    case "endnote": {
      const places =
        item.on === undefined
          ? [{ from: end, to: end }]
          : placesIn(context, handle, target, item.on, false);
      if (!Array.isArray(places)) return places;
      const at = (places[0] as { to: number }).to;
      const stories = () => new Set(Object.keys(wordContext(editor.state)?.envelope.stories ?? {}));
      const had = stories();
      editor.select(at);
      if (!editor.run(insertNote(item.kind)) || editor.state.doc === before)
        return failed(`A ${item.kind}`);
      const id = [...stories()].find((s) => !had.has(s));
      const story = id ? editor.story(id) : null;
      if (!story) return failed(`A ${item.kind}`);
      // Word's new note: its mark and a space; the text goes after them.
      const content = story.state.doc.firstChild;
      if (!content) return failed(`A ${item.kind}`);
      story.dispatch(story.state.tr.insert(1 + content.content.size, inline(editor, item.text)));
      return { ok: true, ...changed(context, [handle]) };
    }
    case "picture": {
      const info = imageInfo(item.data);
      const contentType = item.contentType ?? info?.contentType;
      if (!contentType)
        return refuse(
          "invalid",
          "The image's type could not be told from its bytes: give its contentType (image/png, image/jpeg…).",
        );
      if (
        info &&
        (info.width < 1 || info.height < 1) &&
        (item.width === undefined || item.height === undefined)
      )
        return refuse(
          "invalid",
          "The image's header gives it no size: give its width and height in points.",
        );
      if (!info && (item.width === undefined || item.height === undefined))
        return refuse(
          "invalid",
          "The image's size could not be read from its bytes: give its width and height in points.",
        );
      // Pixels at 96 per inch, fitted to the text width; or as given, keeping the proportions.
      const ratio = info && info.width > 0 ? info.height / info.width : 1;
      let width =
        item.width ?? (item.height !== undefined ? item.height / ratio : (info?.width ?? 0) * 0.75);
      let height = item.height ?? width * ratio;
      const most = textWidth(context);
      if (item.width === undefined && item.height === undefined && width > most) {
        height = (height * most) / width;
        width = most;
      }
      if (width * EMU > MAX_EMU || height * EMU > MAX_EMU)
        return refuse(
          "invalid",
          "The picture would be larger than Word holds (about 2,350 inches): give a smaller width or height.",
        );
      const made = insert(context, handle, [""], where);
      if (!made.ok) return made;
      const holder = made.blocks[0]?.handle as string;
      if (!plain(context, holder)) return failed("A picture");
      const found = context.handles.resolve(holder);
      if (!found) return failed("A picture");
      editor.select(found.pos + 1);
      const inserted = editor.run(
        insertPicture({
          contentType,
          data: `data:${contentType};base64,${base64(item.data)}`,
          width: Math.max(1, Math.round(width * EMU)),
          height: Math.max(1, Math.round(height * EMU)),
          alt: item.alt.trim(),
        }),
      );
      if (!inserted)
        return refuse(
          "refused",
          `The picture could not be inserted: its type ${quote(contentType)} or its bytes are not an image the document holds. Nothing was changed.`,
        );
      return { ok: true, ...changed(context, [holder]) };
    }
  }
}
