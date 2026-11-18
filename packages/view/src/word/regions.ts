/**
 * Headers and footers on pages (11.7, ADR-0007), for both renderers: which story a page shows, how
 * tall it is with that page's fields filled in, how far it pushes the text, and its elements.
 * A story is always drawn from the model here, by the read-only blocks renderer; `PAGE`, `NUMPAGES`
 * and `SECTIONPAGES` are filled in the copy drawn, never in the document.
 */
import {
  type FoliDocument,
  formatNumber,
  type NodeJSON,
  pageVariant,
  type Resolver,
  type SectionJSON,
  type StoryJSON,
  type StorySide,
  storyOfSection,
} from "@folijs/core";
import type { FlowPage, PageFacts } from "../layout/flow.js";
import { type BlockOptions, PX_PER_TWIP, renderBlocks, type WordBlock } from "./blocks.js";

/** The class of a page's header or footer element. */
export const REGION_CLASS = "foli-region";
export const REGION_CONTENT_CLASS = "foli-region-content";

/** Word's distance from the page's edge when a section does not give one: half an inch. */
const EDGE = 720;

/** What the page fields of a page show. */
export interface FieldValues {
  page: string;
  pages: string;
  sectionPages: string;
}

const PAGE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);
const FORMATS: Record<string, string> = {
  arabic: "decimal",
  roman: "lowerRoman",
  ROMAN: "upperRoman",
  alphabetic: "lowerLetter",
  ALPHABETIC: "upperLetter",
};

/** What a field shows for `code` (its instruction), or null when it is not a page field. */
function pageFieldText(code: string, values: FieldValues, numbers: string | undefined) {
  const words = code.trim().split(/\s+/);
  const name = words[0]?.toUpperCase() ?? "";
  if (!PAGE_FIELDS.has(name)) return null;
  const at = words.indexOf("\\*");
  const asked = at >= 0 ? FORMATS[words[at + 1] ?? ""] : undefined;
  const raw =
    name === "PAGE" ? values.page : name === "NUMPAGES" ? values.pages : values.sectionPages;
  const n = Number(raw);
  // The section's number format is the page number's; a switch in the field goes before it.
  const format = asked ?? (name === "PAGE" ? numbers : undefined);
  return { name, text: Number.isFinite(n) ? formatNumber(n, format) : raw };
}

/**
 * A paragraph's inline nodes with its page fields' results replaced by what `values` says (one run,
 * formatted as the result's first). Only whole fields inside the list: a page field does not span
 * paragraphs. `seen` collects the names of those found.
 */
function fillInline(
  nodes: readonly NodeJSON[],
  values: FieldValues,
  numbers: string | undefined,
  seen: Set<string>,
): NodeJSON[] {
  const out: NodeJSON[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as NodeJSON;
    out.push(node);
    if (node.type !== "fieldStart") continue;
    let depth = 1;
    let separator = -1;
    let end = -1;
    let code = "";
    for (let j = i + 1; j < nodes.length && end < 0; j++) {
      const inner = nodes[j] as NodeJSON;
      if (inner.type === "fieldStart") depth++;
      else if (inner.type === "fieldEnd" && --depth === 0) end = j;
      else if (depth === 1 && inner.type === "fieldSeparator" && separator < 0) separator = j;
      else if (depth === 1 && separator < 0 && inner.type === "fieldCode")
        code += String(inner.attrs?.text ?? "");
    }
    const shown = end < 0 ? null : pageFieldText(code, values, numbers);
    if (!shown) continue;
    seen.add(shown.name);
    const codeEnd = separator < 0 ? end : separator + 1;
    const result = nodes.slice(codeEnd, end);
    const model = result.find((n) => n.type === "text") ?? nodes[codeEnd - 1];
    out.push(...nodes.slice(i + 1, codeEnd));
    if (shown.text)
      out.push({
        type: "text",
        text: shown.text,
        ...(model?.marks ? { marks: model.marks } : {}),
      });
    out.push(nodes[end] as NodeJSON);
    i = end;
  }
  return out;
}

/** `node` with the page fields in it filled. */
function filled(
  node: NodeJSON,
  values: FieldValues,
  numbers: string | undefined,
  seen: Set<string>,
): NodeJSON {
  if (!node.content) return node;
  const content =
    node.type === "paragraph"
      ? fillInline(node.content, values, numbers, seen)
      : node.content.map((child) => filled(child, values, numbers, seen));
  return { ...node, content };
}

/** The page fields a story holds. */
const NO_VALUES: FieldValues = { page: "", pages: "", sectionPages: "" };

/** A story with some values: its height, and its content to draw. */
interface Drawn {
  height: number;
  content: HTMLElement;
}

/** Per story (an object replaced when the story changes), what was measured and drawn of it. */
export type RegionCache = WeakMap<StoryJSON, { fields: Set<string>; drawn: Map<string, Drawn> }>;

/** A section's page as the regions need it, in CSS px. */
interface Edges {
  top: number;
  bottom: number;
  /** Whether a header or footer can push the text (a negative margin is exact, as in Word). */
  pushesTop: boolean;
  pushesBottom: boolean;
  header: number;
  footer: number;
  left: number;
  right: number;
  height: number;
  width: number;
}

function edgesOf(section: SectionJSON): Edges {
  const m = section.margins ?? {};
  const top = m.top ?? 1440;
  const bottom = m.bottom ?? 1440;
  const left = (m.left ?? 1440) + (m.gutter ?? 0);
  const right = m.right ?? 1440;
  const width = section.pageSize?.width ?? 12_240;
  return {
    top: Math.abs(top) * PX_PER_TWIP,
    bottom: Math.abs(bottom) * PX_PER_TWIP,
    pushesTop: top >= 0,
    pushesBottom: bottom >= 0,
    header: (m.header ?? EDGE) * PX_PER_TWIP,
    footer: (m.footer ?? EDGE) * PX_PER_TWIP,
    left: left * PX_PER_TWIP,
    right: right * PX_PER_TWIP,
    height: (section.pageSize?.height ?? 15_840) * PX_PER_TWIP,
    width: Math.max(width - left - right, 1) * PX_PER_TWIP,
  };
}

/** Lays `blocks` out as a story: spacing as between the paragraphs of a page. */
function stack(blocks: readonly WordBlock[], parent: HTMLElement, adds: boolean): number {
  let previous = 0;
  blocks.forEach((block, i) => {
    const gap = !i
      ? block.before
      : adds
        ? previous + block.before
        : Math.max(previous, block.before);
    block.element.style.marginTop = `${gap}px`;
    block.element.style.marginBottom = "0";
    previous = block.after;
    parent.append(block.element);
  });
  return previous;
}

export interface RegionOptions extends Omit<BlockOptions, "resolver"> {
  /** Where stories are measured (hidden, for a moment). */
  measureIn(): HTMLElement;
  /** Layout px per measured px's inverse: what a scaled ancestor multiplies sizes by. */
  scale?(): number;
}

/** What the layout of a document's pages needs to know of their headers and footers. */
export class PageRegions {
  /** The page count and each section's, as of the last flow (the fields' values). */
  private pages = 1;
  private sectionPages = new Map<number, number>();
  private edges: Edges[] = [];
  private document: Omit<FoliDocument, "content"> | null = null;
  /** The document's sections, in order. */
  private sections: readonly SectionJSON[] = [];
  private resolver: Resolver | null = null;

  constructor(
    private readonly doc: Document,
    private readonly options: RegionOptions,
    /** Kept across layouts by the view; replaced when what stories look like changes. */
    public cache: RegionCache,
  ) {}

  /** What is laid out now. */
  setDocument(
    document: Omit<FoliDocument, "content">,
    sections: readonly SectionJSON[],
    resolver: Resolver,
  ): void {
    this.document = document;
    this.sections = sections;
    this.resolver = resolver;
    this.edges = [];
  }

  private get stories() {
    return this.document?.stories;
  }

  private edgesAt(index: number): Edges {
    let found = this.edges[index];
    if (!found) {
      found = edgesOf(this.sections[index] ?? {});
      this.edges[index] = found;
    }
    return found;
  }

  /** The story a page of section `index` shows, as `first` and its number say. */
  storyId(index: number, side: StorySide, page: { first: boolean; number: number }): string | null {
    const section = this.sections[index];
    if (!section) return null;
    const even = this.document?.settings?.evenAndOddHeaders === true;
    const variant = pageVariant(section, page, even);
    const found = storyOfSection(this.sections, index, side, variant);
    return found && this.stories?.[found.id] ? found.id : null;
  }

  private entry(story: StoryJSON) {
    let entry = this.cache.get(story);
    if (!entry) {
      const fields = new Set<string>();
      filled(story.content, NO_VALUES, undefined, fields);
      entry = { fields, drawn: new Map() };
      this.cache.set(story, entry);
    }
    return entry;
  }

  private valuesFor(index: number, number: number): FieldValues {
    return {
      page: String(number),
      pages: String(this.pages),
      sectionPages: String(this.sectionPages.get(index) ?? 1),
    };
  }

  private drawn(id: string, index: number, number: number): Drawn {
    const story = this.stories?.[id] as StoryJSON;
    const entry = this.entry(story);
    const section = this.sections[index] ?? {};
    const edges = this.edgesAt(index);
    const values = this.valuesFor(index, number);
    const format = section.pageNumbers?.format;
    const key = [
      edges.width,
      entry.fields.has("PAGE") ? `${values.page} ${format ?? ""}` : "",
      entry.fields.has("NUMPAGES") ? values.pages : "",
      entry.fields.has("SECTIONPAGES") ? values.sectionPages : "",
    ].join("|");
    let found = entry.drawn.get(key);
    if (!found) {
      const content = this.doc.createElement("div");
      content.className = REGION_CONTENT_CLASS;
      content.style.paddingTop = "0.01px";
      const blocks = renderBlocks(
        {
          ...this.document,
          content: entry.fields.size
            ? filled(story.content, values, format, new Set())
            : story.content,
        } as FoliDocument,
        this.doc,
        { ...this.options, ...(this.resolver ? { resolver: this.resolver } : {}) },
      );
      const after = stack(blocks, content, !!this.resolver?.addsParagraphSpacing);
      // Measured down to its last block: floating pictures do not make a story taller.
      const parent = this.options.measureIn();
      const { style } = content;
      style.position = "absolute";
      style.visibility = "hidden";
      style.width = `${edges.width}px`;
      parent.append(content);
      const last = content.lastElementChild;
      const scale = this.options.scale?.() ?? 1;
      const top = content.getBoundingClientRect().top;
      const bottom = last ? last.getBoundingClientRect().bottom : top;
      content.remove();
      style.position = "";
      style.visibility = "";
      style.width = "";
      found = { height: (bottom - top) / scale + after, content };
      entry.drawn.set(key, found);
    }
    return found;
  }

  /** How tall the header or footer of a page is (0: none). */
  private heightOf(index: number, side: StorySide, page: FlowPage): number {
    const id = this.storyId(index, side, page);
    return id ? this.drawn(id, index, page.number).height : 0;
  }

  /** The margins of a page, a header or footer taller than its own pushing the text. */
  margins(index: number, page: FlowPage): { top: number; bottom: number } {
    const edges = this.edgesAt(index);
    const header = edges.pushesTop ? this.heightOf(index, "header", page) : 0;
    const footer = edges.pushesBottom ? this.heightOf(index, "footer", page) : 0;
    return {
      top: header ? Math.max(edges.top, edges.header + header) : edges.top,
      bottom: footer ? Math.max(edges.bottom, edges.footer + footer) : edges.bottom,
    };
  }

  /** The height of a page's text. */
  boxHeight(index: number, page: FlowPage): number {
    const { top, bottom } = this.margins(index, page);
    return this.edgesAt(index).height - top - bottom;
  }

  /**
   * Takes the page counts of a finished flow. Whether its pages' text heights change with them
   * (a `NUMPAGES` that wraps): the flow is then made again, at most twice (ADR-0007).
   */
  settle(pages: readonly PageFacts[]): boolean {
    const heights = () =>
      pages
        .filter((p) => p.sectionPages)
        .map((p) => this.boxHeight(p.section, p))
        .join(" ");
    const before = heights();
    this.pages = pages.length;
    this.sectionPages = new Map();
    for (const page of pages)
      if (page.sectionPages) this.sectionPages.set(page.section, page.sectionPages);
    return heights() !== before;
  }

  /** Every header and footer height a section can give: a change means a new flow. */
  key(): string {
    return this.sections
      .flatMap((_, index) =>
        (["header", "footer"] as const).flatMap((side) =>
          [
            { first: true, number: 1 },
            { first: false, number: 1 },
            { first: false, number: 2 },
          ].map((page) => this.heightOf(index, side, { ...page, index: 0 })),
        ),
      )
      .join(" ");
  }

  /** What a page's region shows: equal keys, the same drawing. */
  drawing(
    index: number,
    side: StorySide,
    page: FlowPage,
  ): { id: string; content: Drawn; story: StoryJSON } | null {
    const id = this.storyId(index, side, page);
    if (!id) return null;
    return {
      id,
      content: this.drawn(id, index, page.number),
      story: this.stories?.[id] as StoryJSON,
    };
  }

  /** A new header or footer element for a page of section `index`. */
  element(index: number, side: StorySide): HTMLElement {
    const edges = this.edgesAt(index);
    const region = this.doc.createElement("div");
    region.className = `${REGION_CLASS} foli-${side}`;
    region.setAttribute("contenteditable", "false");
    const { style } = region;
    // As large as the page: floating pictures in it are placed against the page.
    style.position = "absolute";
    style.inset = "0";
    style.boxSizing = "border-box";
    style.pointerEvents = "none";
    // Not part of what the body's selection shows.
    style.userSelect = "none";
    style.setProperty("-webkit-user-select", "none");
    style.paddingLeft = `${edges.left}px`;
    style.paddingRight = `${edges.right}px`;
    if (side === "header") style.paddingTop = `${edges.header}px`;
    else {
      style.display = "flex";
      style.flexDirection = "column";
      style.justifyContent = "flex-end";
      style.paddingBottom = `${edges.footer}px`;
    }
    return region;
  }
}
