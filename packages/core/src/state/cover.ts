/**
 * Insert ▸ Pages (35.6): a cover page as Word's building block is one, and a blank page.
 *
 * Word's cover is a block content control of the Cover Pages gallery (`w:docPartObj`,
 * `w:docPartGallery` "Cover Pages", `w:docPartUnique`: one a document) at the document's start,
 * holding shapes fixed on the page, the title, subtitle, author and date as content controls, and
 * a page break. Foli's designs are its own, built the same way: Word lists the cover as its
 * current one, Insert ▸ Cover Page replaces it and Remove Current Cover Page removes it.
 */
import type { Mark, Node, NodeType } from "../model/index.js";
import type { ControlJSON } from "../v3/document.js";
import { attempt } from "./attempt.js";
import { freshControlId, placeholderRun } from "./controls.js";
import { closeHistory } from "./history.js";
import { idsOf } from "./ids.js";
import { TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { trackState } from "./track.js";
import { setEnvelopeValue, type WordEnvelope, withEnvelope, wordContext } from "./word.js";

/** The cover designs: Foli's own, each Word's way (shapes, the fields as controls). */
export const COVER_PAGES = ["Banded", "Sidebar", "Simple"] as const;
export type CoverPageDesign = (typeof COVER_PAGES)[number];

/** The cover control's properties, as Word writes them (Word gives the `w:id`). */
const COVER_EXT =
  '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/><w:docPartUnique/></w:docPartObj></w:sdtPr></w:sdt>';
const IS_COVER = /<[\w.-]+:docPartGallery\s+[\w.-]+:val="Cover Pages"/;

/** EMU per twip, and per inch. */
const EMU = 635;
const INCH = 914_400;

/** The document's cover control's id, if it has one. */
export function coverPageId(state: EditorState): string | null {
  const controls = wordContext(state)?.envelope.controls ?? {};
  for (const [id, control] of Object.entries(controls))
    if (control.kind === "other" && control.ext && IS_COVER.test(control.ext)) {
      let found = false;
      state.doc.forEach((block) => {
        found ||= ((block.attrs.controls as string[] | null) ?? []).includes(id);
      });
      if (found) return id;
    }
  return null;
}

/** The blocks a cover control holds: from the first to after the last. */
function coverRange(state: EditorState, id: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  state.doc.forEach((block, pos) => {
    if (!((block.attrs.controls as string[] | null) ?? []).includes(id)) return;
    if (from < 0) from = pos;
    to = pos + block.nodeSize;
  });
  return from < 0 ? null : { from, to };
}

/**
 * Insert ▸ Cover Page: a cover of `design` at the document's start (Word's way: replacing the
 * current one), on a page of its own, its title, subtitle, author and date controls showing
 * their placeholders, in the theme's colors. One undo step; not in a story, not while tracking.
 */
export function insertCoverPage(design: CoverPageDesign): Command {
  return (state, dispatch) => {
    const word = wordContext(state);
    if (!word || !COVER_PAGES.includes(design) || trackState(state)?.on === true) return false;
    // In the body only (a header's or note's editor holds no cover).
    if (state.doc.type.name !== "doc" || !state.schema.nodes.shape) return false;
    if (!dispatch) return true;
    return attempt(state, dispatch, (tr) => {
      const current = coverPageId(state);
      const range = current ? coverRange(state, current) : null;
      let envelope: WordEnvelope = word.envelope;
      const controls: Record<string, ControlJSON> = { ...(envelope.controls ?? {}) };
      // The current cover goes, with the controls it holds.
      if (current) delete controls[current];
      if (range)
        state.doc.nodesBetween(range.from, range.to, (node) => {
          if (node.type.name === "controlStart") delete controls[String(node.attrs.id)];
          return true;
        });
      const fresh = idsOf(state);
      const id = freshControlId(controls, fresh);
      controls[id] = { kind: "other", ext: COVER_EXT };
      const built = coverBlocks(state, design, id, controls, envelope, fresh);
      envelope = built.envelope;
      if (range) tr.delete(range.from, range.to);
      tr.insert(0, built.blocks);
      if (envelope !== word.envelope) withEnvelope(tr, envelope);
      setEnvelopeValue(state, tr, "controls", built.controls);
      tr.setSelection(TextSelection.create(tr.doc, 1)).setMeta(closeHistory, true);
    });
  };
}

/** Insert ▸ Cover Page ▸ Remove Current Cover Page: the cover's blocks and controls, one step. */
export const removeCoverPage: Command = (state, dispatch) => {
  const word = wordContext(state);
  const id = coverPageId(state);
  const range = id ? coverRange(state, id) : null;
  if (!word || !id || !range || trackState(state)?.on === true) return false;
  if (!dispatch) return true;
  return attempt(state, dispatch, (tr) => {
    const gone = new Set([id]);
    tr.doc.nodesBetween(range.from, range.to, (node) => {
      if (node.type.name === "controlStart") gone.add(String(node.attrs.id));
      return true;
    });
    tr.delete(range.from, range.to);
    // The document keeps a paragraph.
    if (!tr.doc.childCount) tr.insert(0, (tr.doc.type.schema.nodes.paragraph as NodeType).create());
    const controls = Object.fromEntries(
      Object.entries(word.envelope.controls ?? {}).filter(([key]) => !gone.has(key)),
    );
    setEnvelopeValue(state, tr, "controls", controls);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(1, tr.doc.content.size))));
    tr.setMeta(closeHistory, true);
  });
};

/**
 * Insert ▸ Blank Page: Word's two page breaks at the selection, so that a page with nothing on
 * it stands there. One undo step.
 */
export const insertBlankPage: Command = (state, dispatch) => {
  const type = state.schema.nodes.pageBreak;
  if (!type || !wordContext(state) || !state.selection.$from.parent.inlineContent) return false;
  return attempt(state, dispatch, (tr: Transaction) => {
    if (!state.selection.empty) tr.deleteSelection();
    const at = tr.selection.from;
    tr.insert(at, [type.create(), type.create()]);
    tr.setSelection(TextSelection.create(tr.doc, at + 2)).setMeta(closeHistory, true);
  });
};

// ---------- the designs ----------

interface Field {
  alias: "Title" | "Subtitle" | "Author" | "Date";
  placeholder: string;
  /** Half points. */
  size: number;
  color?: string;
  bold?: boolean;
}

function coverBlocks(
  state: EditorState,
  design: CoverPageDesign,
  coverId: string,
  controls: Record<string, ControlJSON>,
  envelope: WordEnvelope,
  fresh: (after: number) => number,
): { blocks: Node[]; controls: Record<string, ControlJSON>; envelope: WordEnvelope } {
  const { schema } = state;
  const word = wordContext(state);
  const theme = word?.envelope.theme?.colors ?? {};
  const accent = theme.accent1 ?? "156082";
  const dark = theme.dk2 ?? "0E2841";
  const section = word?.envelope.section;
  const pageWidth = (section?.pageSize?.width ?? 12_240) * EMU;
  const pageHeight = (section?.pageSize?.height ?? 15_840) * EMU;
  const paragraph = schema.nodes.paragraph as NodeType;
  const inCover = { controls: [coverId] };
  const mark = (name: string, attrs: Record<string, unknown>): Mark[] => {
    const type = schema.marks[name];
    return type ? [type.create(attrs)] : [];
  };
  /** A content control showing its placeholder, in the field's look. */
  const field = (f: Field): Node[] => {
    const id = freshControlId(controls, fresh);
    const format = [
      { type: "fontSize", attrs: { value: f.size, complexScript: f.size } },
      ...(f.color ? [{ type: "color", attrs: { value: f.color } }] : []),
      ...(f.bold ? [{ type: "bold" }] : []),
    ];
    const control: ControlJSON =
      f.alias === "Date"
        ? {
            kind: "date",
            alias: f.alias,
            dateFormat: "MMMM d, yyyy",
            format,
            placeholder: { showing: true, text: f.placeholder },
          }
        : {
            kind: "text",
            alias: f.alias,
            format,
            placeholder: { showing: true, text: f.placeholder },
          };
    controls[id] = control;
    const made = placeholderRun(state, control, envelope);
    envelope = made.envelope;
    const looks = [
      ...made.run.marks,
      ...mark("fontSize", { value: f.size, complexScript: f.size }),
      ...(f.bold ? mark("bold", {}) : []),
    ];
    return [
      (schema.nodes.controlStart as NodeType).create({ id }),
      schema.text(made.run.text ?? "", looks),
      (schema.nodes.controlEnd as NodeType).create({ id }),
    ];
  };
  /** A rectangle fixed on the page, behind the text. */
  const band = (x: number, y: number, width: number, height: number, fill: string): Node =>
    (schema.nodes.shape as NodeType).create({
      geometry: "rect",
      width: Math.round(width),
      height: Math.round(height),
      float: {
        horizontal: { relativeTo: "page", offset: Math.round(x) },
        vertical: { relativeTo: "page", offset: Math.round(y) },
        wrap: "behind",
        distance: { top: 0, bottom: 0, left: 114_300, right: 114_300 },
      },
      fill,
      outline: null,
    });
  const p = (attrs: Record<string, unknown>, content: Node[] = []) =>
    paragraph.create({ ...inCover, ...attrs }, content);
  const space = (before: number) => ({ spacing: { before, after: 0 } });
  const title: Field = { alias: "Title", placeholder: "[Document title]", size: 72, color: accent };
  const subtitle: Field = { alias: "Subtitle", placeholder: "[Document subtitle]", size: 32 };
  const author: Field = { alias: "Author", placeholder: "[Author name]", size: 24, color: accent };
  const date: Field = { alias: "Date", placeholder: "[Date]", size: 24 };
  const pageBreak = (schema.nodes.pageBreak as NodeType).create();
  let blocks: Node[];
  if (design === "Banded") {
    // A band of the accent across the page's top third, the title under it.
    blocks = [
      p(space(0), [band(0, 0, pageWidth, pageHeight / 3, accent)]),
      p(space(4320), field(title)),
      p(space(240), field(subtitle)),
      p(space(3600), field(author)),
      p(space(120), field(date)),
      p({}, [pageBreak]),
    ];
  } else if (design === "Sidebar") {
    // A dark bar down the page's left, a thin accent line beside it; the text to its right.
    blocks = [
      p(space(0), [
        band(0, 0, INCH * 1.5, pageHeight, dark),
        band(INCH * 1.5, 0, INCH * 0.12, pageHeight, accent),
      ]),
      p({ ...space(4320), indent: { left: 1440 } }, field(title)),
      p({ ...space(240), indent: { left: 1440 } }, field(subtitle)),
      p({ ...space(3600), indent: { left: 1440 } }, field(author)),
      p({ ...space(120), indent: { left: 1440 } }, field(date)),
      p({}, [pageBreak]),
    ];
  } else {
    // Text only, centered, a rule under the title.
    const center = { justification: "center" };
    const rule = { style: "single", size: 12, space: 8, color: accent };
    blocks = [
      p({ ...space(4320), ...center, borders: { bottom: rule } }, field(title)),
      p({ ...space(240), ...center }, field(subtitle)),
      p({ ...space(3600), ...center }, field(author)),
      p({ ...space(120), ...center }, field(date)),
      p({}, [pageBreak]),
    ];
  }
  return { blocks, controls, envelope };
}
