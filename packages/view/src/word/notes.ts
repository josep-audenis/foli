/**
 * Footnotes and endnotes on pages (11.10, ADR-0007), for both renderers: a note measured as lines
 * for the flow, and its pieces drawn at the column's foot or, for endnotes, after the text. A note
 * is drawn from the model by the read-only blocks renderer, its number filled in.
 */
import {
  type FoliDocument,
  type NoteNumber,
  noteKindOf,
  noteProperties,
  type Resolver,
  type SectionJSON,
  type StoryJSON,
} from "@folijs/core";
import { arrangeNotes, type FlowNote, type FlowRules, type NotePiece } from "../layout/flow.js";
import { type BlockOptions, renderBlocks } from "./blocks.js";
import { columnsPx } from "./columns.js";
import { REGION_CLASS, REGION_CONTENT_CLASS, type RegionOptions, stack } from "./regions.js";

/** On a piece of a note drawn on a page: the story. */
export const NOTE_ATTR = "data-foli-note";
/** The class of what holds a column's notes. */
export const NOTES_CLASS = "foli-notes";

/**
 * The bottom of each line of a rendered block, from its top. Lines are the vertical clusters of
 * its contents' client rects; a boundary is halfway between one line's content and the next's,
 * the last line ends at the block's bottom.
 *
 * shortcut: line boxes are inferred from content rects (exact for even line heights); a
 * superscript or a much larger run on a line moves that line's boundaries slightly.
 */
export function lineBottoms(element: HTMLElement): number[] {
  const box = element.getBoundingClientRect();
  const doc = element.ownerDocument;
  const range = doc.createRange();
  const rects: { rect: DOMRect; text: boolean }[] = [];
  // Text and line breaks only: a range over the whole block also has the boxes of the
  // elements inside it (a table's), which span many lines.
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      // A raised number says nothing about where its line is.
      if ((node.parentElement as HTMLElement | null)?.style.verticalAlign === "super") continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) rects.push({ rect, text: true });
    } else if (node.nodeName === "BR")
      rects.push({ rect: (node as Element).getBoundingClientRect(), text: false });
  }
  rects.sort((a, b) => a.rect.top - b.rect.top);
  type Line = { top: number; bottom: number; text: boolean };
  const lines: Line[] = [];
  for (const { rect, text } of rects) {
    if (rect.height <= 0) continue;
    const last = lines[lines.length - 1];
    // Same line: it starts above the middle of the line so far.
    if (last && rect.top < (last.top + last.bottom) / 2) {
      // A line's text says where it is; a <br> only for a line without text (engines size
      // its box differently).
      if (text && !last.text) Object.assign(last, { top: rect.top, bottom: rect.bottom, text });
      else if (text === last.text) {
        last.top = Math.min(last.top, rect.top);
        last.bottom = Math.max(last.bottom, rect.bottom);
      }
    } else lines.push({ top: rect.top, bottom: rect.bottom, text });
  }
  const bottoms = lines.slice(1).map((line, i) => {
    const above = lines[i] as { bottom: number };
    return (above.bottom + line.top) / 2 - box.top;
  });
  bottoms.push(box.height);
  return bottoms;
}

/** Word's separators when a document has none of its own. */
const defaultSeparator = (type: "separator" | "continuationSeparator"): StoryJSON => ({
  kind: "footnote",
  noteType: type,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { spacing: { after: 0, line: 240, lineRule: "auto" } },
        content: [{ type: "opaqueInline", attrs: { xml: `<w:r><w:${type}/></w:r>`, label: type } }],
      },
    ],
  },
});
const DEFAULT_SEPARATOR = defaultSeparator("separator");
const DEFAULT_CONTINUATION = defaultSeparator("continuationSeparator");

/** A note at a width, with its number, as drawn and measured. */
interface Drawn {
  serial: number;
  template: HTMLElement;
  /** The bottom of each line, from its top. */
  lines: number[];
}

export type NoteCache = WeakMap<StoryJSON, Map<string, Drawn>>;

let serial = 0;

/** The notes at a band's foot, or after the text of one of its columns. */
export interface NoteGroup {
  page: number;
  band: number;
  /** In the flow, its column. */
  column: number;
  /** In the text's flow: endnotes, and footnotes set beneath the text. */
  inFlow: boolean;
  pieces: NotePiece[];
  /** The section whose columns they are in. */
  section: number;
}

/** What a document's pages need to know of its notes. */
export class PageNotes {
  private document: Omit<FoliDocument, "content"> | null = null;
  private sections: readonly SectionJSON[] = [];
  private resolver: Resolver | null = null;
  private references: readonly NoteNumber[] = [];
  private numbers = new Map<string, string>();
  /** The note being edited: whole, one line to the flow. */
  open: string | null = null;

  constructor(
    private readonly doc: Document,
    private readonly options: RegionOptions,
    public cache: NoteCache,
  ) {}

  /** What is laid out now: the references shown, in order, with their numbers. */
  setDocument(
    document: Omit<FoliDocument, "content">,
    sections: readonly SectionJSON[],
    resolver: Resolver,
    references: readonly NoteNumber[],
  ): void {
    this.document = document;
    this.sections = sections;
    this.resolver = resolver;
    this.references = references;
    this.numbers = new Map(references.map((n) => [n.story, n.text]));
  }

  private story(id: string): StoryJSON | undefined {
    const stories = this.document?.stories;
    return stories && Object.hasOwn(stories, id) ? stories[id] : undefined;
  }

  /** The separator of `kind`, the document's own or Word's. */
  private separator(kind: "footnote" | "endnote", type: "separator" | "continuationSeparator") {
    const found = Object.entries(this.document?.stories ?? {}).find(
      ([, story]) => story.kind === kind && story.noteType === type,
    );
    return found
      ? { id: found[0], story: found[1] }
      : {
          id: `${kind}:${type}`,
          story: type === "separator" ? DEFAULT_SEPARATOR : DEFAULT_CONTINUATION,
        };
  }

  private storyFor(id: string): StoryJSON | undefined {
    if (id === "footnote:separator" || id === "endnote:separator") return DEFAULT_SEPARATOR;
    if (id.endsWith(":continuationSeparator")) return DEFAULT_CONTINUATION;
    return this.story(id);
  }

  private drawn(id: string, width: number): Drawn {
    const story = this.storyFor(id) as StoryJSON;
    const mark = this.numbers.get(id) ?? "";
    let byKey = this.cache.get(story);
    if (!byKey) {
      byKey = new Map();
      this.cache.set(story, byKey);
    }
    const key = `${mark}|${width}`;
    let found = byKey.get(key);
    if (!found) {
      const template = this.doc.createElement("div");
      template.className = REGION_CONTENT_CLASS;
      template.style.paddingTop = "0.01px";
      const options: BlockOptions = {
        ...this.options,
        notes: { mark },
        ...(this.resolver ? { resolver: this.resolver } : {}),
      };
      const blocks = renderBlocks(
        { ...this.document, content: story.content } as FoliDocument,
        this.doc,
        options,
      );
      const after = stack(blocks, template, !!this.resolver?.addsParagraphSpacing);
      const { style } = template;
      style.position = "absolute";
      style.visibility = "hidden";
      style.width = `${width}px`;
      this.options.measureIn().append(template);
      const scale = this.options.scale?.() ?? 1;
      const top = template.getBoundingClientRect().top;
      const lines = blocks.flatMap(({ element }) => {
        const offset = (element.getBoundingClientRect().top - top) / scale;
        return lineBottoms(element).map((bottom) => offset + bottom / scale);
      });
      template.remove();
      style.position = "";
      style.visibility = "";
      style.width = "";
      // The last space after is the note's: the next one starts below it.
      if (lines.length) lines[lines.length - 1] = (lines.at(-1) as number) + after;
      found = { serial: ++serial, template, lines: lines.length ? lines : [0] };
      byKey.set(key, found);
    }
    return found;
  }

  /** The lines of story `id` in `width`; the note being edited is one, whole. */
  private linesOf(id: string, width: number): number[] {
    const { lines } = this.drawn(id, width);
    return id === this.open ? [lines.at(-1) as number] : lines;
  }

  private flowNote(id: string, widths: readonly number[]): FlowNote {
    return { id, lines: (column) => this.linesOf(id, widths[column] ?? (widths[0] as number)) };
  }

  private widths(section: number): number[] {
    return columnsPx(this.sections[section] ?? {}).widths;
  }

  /** The footnote `story` as the flow takes it, when its reference is shown. */
  footnote(story: string, section: number): FlowNote | null {
    return noteKindOf(story) === "footnote" && this.numbers.has(story) && this.story(story)
      ? this.flowNote(story, this.widths(section))
      : null;
  }

  /** What goes above footnotes, when the document has any on its pages. */
  flowRules(): FlowRules["notes"] {
    if (!this.references.some((n) => n.kind === "footnote" && this.story(n.story)))
      return undefined;
    const widths = this.widths(0);
    return {
      separator: this.flowNote(this.separator("footnote", "separator").id, widths),
      continuation: this.flowNote(this.separator("footnote", "continuationSeparator").id, widths),
    };
  }

  /** The endnotes that follow the last block of each section, with their separator. */
  endnotes(): Map<number, FlowNote[]> {
    const out = new Map<number, FlowNote[]>();
    const lastSection = Math.max(this.sections.length - 1, 0);
    const document = this.document;
    if (!document) return out;
    const atSectionEnd = noteProperties(document, "endnote").position === "sectEnd";
    for (const { story, kind, section } of this.references) {
      if (kind !== "endnote" || !this.story(story)) continue;
      const at = atSectionEnd ? section : lastSection;
      const list = out.get(at) ?? [
        this.flowNote(this.separator("endnote", "separator").id, this.widths(at)),
      ];
      list.push(this.flowNote(story, this.widths(at)));
      out.set(at, list);
    }
    return out;
  }

  /** A change in what any of these measures means a new flow. */
  key(): string {
    if (!this.references.length) return "";
    const heights = this.references
      .filter((n) => this.story(n.story))
      .map(({ story, section }) => {
        const lines = this.linesOf(story, this.widths(section)[0] as number);
        return `${lines.length}:${lines.at(-1)}`;
      });
    return `${this.open ?? ""}|${heights.join(" ")}`;
  }

  /** The notes of each column of each page, foot and flow apart. */
  groups(pieces: readonly NotePiece[], sectionOf: (page: number, band: number) => number) {
    const groups = new Map<string, NoteGroup>();
    for (const piece of pieces) {
      const band = piece.band ?? 0;
      const column = piece.column ?? 0;
      const section = sectionOf(piece.page, band);
      const setup = this.sections[section];
      // Beneath the text: with one column, whose text they then follow.
      const beneath =
        !!this.document &&
        this.widths(section).length === 1 &&
        noteProperties(this.document, "footnote", setup).position === "beneathText";
      const inFlow = !!piece.end || (beneath && noteKindOf(piece.id) === "footnote");
      const key = `${piece.page}|${band}|${inFlow ? column : 0}|${inFlow}`;
      let group = groups.get(key);
      if (!group) {
        group = { page: piece.page, band, column, inFlow, pieces: [], section };
        groups.set(key, group);
      }
      group.pieces.push(piece);
    }
    return [...groups.values()];
  }

  private widthOf(group: NoteGroup): number {
    const widths = this.widths(group.section);
    return widths[group.column] ?? (widths[0] as number);
  }

  private pieceHeight(piece: NotePiece, width: number): number {
    const lines = this.linesOf(piece.id, width);
    const to = Math.min(piece.toLine, lines.length);
    return (
      (piece.lead ?? 0) +
      (lines[to - 1] ?? 0) -
      (piece.fromLine ? (lines[piece.fromLine - 1] ?? 0) : 0)
    );
  }

  /** A group as it is set: its separators, then each piece in its column. */
  private arranged(group: NoteGroup) {
    const width = this.widthOf(group);
    const isSeparator = (piece: NotePiece) =>
      (this.storyFor(piece.id)?.noteType ?? "normal") !== "normal";
    const separators = group.pieces.filter(isSeparator);
    const notes = group.pieces.filter((piece) => !isSeparator(piece));
    const columns = group.inFlow ? 1 : this.widths(group.section).length;
    const heights = notes.map((piece) => this.pieceHeight(piece, width));
    const { height, columnOf } = arrangeNotes(heights, columns);
    const above = separators.reduce((sum, piece) => sum + this.pieceHeight(piece, width), 0);
    return { separators, notes, columnOf, columns, above, height };
  }

  /** How tall a group is. */
  heightOf(group: NoteGroup): number {
    const { above, height } = this.arranged(group);
    return above + height;
  }

  /** What identifies how a group looks: the same key, the same drawing. */
  keyOf(group: NoteGroup): string {
    const width = this.widthOf(group);
    return group.pieces
      .map((p) => {
        const { serial: drawing } = this.drawn(p.id, width);
        return `${p.id}|${drawing}|${p.fromLine}|${p.toLine}|${p.lead ?? 0}|${p.id === this.open}`;
      })
      .join(";");
  }

  /** A piece of a note: the note's lines shown, clipped to them unless it is whole. */
  pieceElement(piece: NotePiece, group: NoteGroup): HTMLElement {
    const width = this.widthOf(group);
    const { lines, template } = this.drawn(piece.id, width);
    const outer = this.doc.createElement("div");
    outer.setAttribute(NOTE_ATTR, piece.id);
    if (piece.lead) outer.style.marginTop = `${piece.lead}px`;
    const copy = template.cloneNode(true) as HTMLElement;
    const whole = piece.fromLine === 0 && piece.toLine >= lines.length;
    if (whole || piece.id === this.open) {
      outer.append(copy);
      return outer;
    }
    const top = piece.fromLine ? (lines[piece.fromLine - 1] as number) : 0;
    const bottom = lines[Math.min(piece.toLine, lines.length) - 1] as number;
    outer.style.overflow = "hidden";
    outer.style.height = `${bottom - top}px`;
    copy.style.marginTop = `${-top}px`;
    if (piece.fromLine) copy.setAttribute("aria-hidden", "true");
    outer.append(copy);
    return outer;
  }

  /** The element of a group, its pieces given by `pieceOf` (one kept while it is being edited). */
  groupElement(
    group: NoteGroup,
    place: { left: number; bottom: number } | null,
    pieceOf: (piece: NotePiece) => HTMLElement = (piece) => this.pieceElement(piece, group),
    /** Above a group in the flow: the space after the text it follows. */
    lead = 0,
  ): HTMLElement {
    const element = this.doc.createElement("div");
    element.className = `${REGION_CLASS} ${NOTES_CLASS}`;
    element.setAttribute("contenteditable", "false");
    const { style } = element;
    style.userSelect = "none";
    style.setProperty("-webkit-user-select", "none");
    style.width = `${this.widthOf(group)}px`;
    if (lead) style.marginTop = `${lead}px`;
    if (place) {
      style.position = "absolute";
      style.left = `${place.left}px`;
      style.bottom = `${place.bottom}px`;
    }
    const { separators, notes, columnOf, columns, above } = this.arranged(group);
    if (columns === 1) {
      element.append(...group.pieces.map(pieceOf));
      return element;
    }
    // In the section's columns: the separator over the first, the others level with its notes.
    const { widths, gaps } = columnsPx(this.sections[group.section] ?? {});
    style.width = "auto";
    style.display = "flex";
    style.alignItems = "flex-start";
    for (let c = 0; c < columns; c++) {
      const column = this.doc.createElement("div");
      column.style.flex = "none";
      column.style.width = `${widths[c]}px`;
      column.style.marginRight = `${gaps[c] ?? 0}px`;
      if (c) column.style.paddingTop = `${above}px`;
      else column.append(...separators.map(pieceOf));
      column.append(...notes.filter((_, n) => columnOf[n] === c).map(pieceOf));
      element.append(column);
    }
    return element;
  }

  /** Where the foot of a band is: from the page's left edge and bottom edge. */
  footPlace(margins: { left: number; bottom: number }, stacked: number) {
    return { left: margins.left, bottom: margins.bottom + stacked };
  }

  /** How much of the foot the bands below a group's take, on its page. */
  stacked(group: NoteGroup, groups: readonly NoteGroup[]): number {
    const below = new Map<number, number>();
    for (const other of groups)
      if (other.page === group.page && !other.inFlow && other.band > group.band)
        below.set(other.band, Math.max(below.get(other.band) ?? 0, this.heightOf(other)));
    return [...below.values()].reduce((sum, height) => sum + height, 0);
  }
}
