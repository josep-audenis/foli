/**
 * Schema v3 blocks as DOM, formatted as Word formats them (8.6b): every paragraph's and run's
 * effective formatting from `Resolver` as inline CSS, list markers, tracked changes, comment
 * anchors, and content the model keeps opaque shown as text. Read-only: built with
 * createElement/textContent only (never innerHTML); the page layout is in `pages.ts`.
 */
import {
  type FoliDocumentV3,
  type ListMarker,
  type MarkJSON,
  type NodeJSON,
  type ParagraphFormat,
  Resolver,
  type RunFormat,
  type SectionJSON,
} from "@folijs/core";

/** Marks the <br> of an explicit page break (the page flow ends the page after its line). */
export const WORD_PAGE_BREAK_ATTR = "data-page-break";

/** CSS px per twip (1/1440 inch; CSS: 96 px per inch). */
export const PX_PER_TWIP = 96 / 1440;

/** Which version of tracked changes to show. */
export type ReviewView = "markup" | "final";

export interface BlockOptions {
  /** `markup` (the default): insertions underlined, deletions struck through. `final`: as if accepted. */
  review?: ReviewView;
  /**
   * The ratio of a font's normal line height to its size (`fontFamily`: a CSS font-family
   * list). Word's single line spacing is the font's own line height; multiples scale it.
   * Measured by the page layout; 1.2 when nothing measures (no layout engine).
   */
  lineRatio?: (fontFamily: string) => number;
}

/** A rendered block and what the page flow needs to know about it. */
export interface WordBlock {
  element: HTMLElement;
  /** Indices in the document's content of the nodes it shows (several when paragraphs merged). */
  nodes: number[];
  /** Space before and after, in CSS px (Word adds them: the flow places them). */
  before: number;
  after: number;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  /** The page setup of the section this block ends (null: the section goes on). */
  section: SectionJSON | null;
}

/**
 * Metric-compatible open fonts for Word's common fonts: the same advance widths and line
 * heights, so text breaks into the same lines where the original is not installed.
 */
const SUBSTITUTES: Record<string, string[]> = {
  calibri: ["Carlito"],
  cambria: ["Caladea"],
  arial: ["Liberation Sans", "Arimo"],
  "times new roman": ["Liberation Serif", "Tinos"],
  "courier new": ["Liberation Mono", "Cousine"],
  georgia: ["Gelasio"],
};
const SERIF = new Set(["cambria", "times new roman", "georgia", "garamond", "book antiqua"]);
const MONOSPACE = new Set(["courier new", "consolas", "courier"]);

/** A CSS font-family list for a Word font name: the font, its substitutes, a generic family. */
export function fontStack(name: string | null): string {
  const font = name ?? "Times New Roman";
  const key = font.toLowerCase();
  const generic = SERIF.has(key) ? "serif" : MONOSPACE.has(key) ? "monospace" : "sans-serif";
  const quote = (f: string) => `"${f.replace(/["\\]/g, "")}"`;
  return [font, ...(SUBSTITUTES[key] ?? [])].map(quote).concat(generic).join(", ");
}

/** Word's highlight colors (`w:highlight`). */
const HIGHLIGHTS: Record<string, string> = {
  black: "#000000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  green: "#00FF00",
  magenta: "#FF00FF",
  red: "#FF0000",
  yellow: "#FFFF00",
  white: "#FFFFFF",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#C0C0C0",
};

const UNDERLINES: Record<string, string> = {
  double: "double",
  dotted: "dotted",
  dottedHeavy: "dotted",
  dash: "dashed",
  dashedHeavy: "dashed",
  dashLong: "dashed",
  wave: "wavy",
  wavyHeavy: "wavy",
  wavyDouble: "wavy",
};

const ALIGN: Record<string, string> = {
  left: "left",
  start: "left",
  right: "right",
  end: "right",
  center: "center",
  both: "justify",
  distribute: "justify",
};

const BORDER_STYLES: Record<string, string> = {
  double: "double",
  dotted: "dotted",
  dashed: "dashed",
  dashSmallGap: "dashed",
  none: "none",
  nil: "none",
};

/** The one font name a run shows for Latin text. */
const latin = (run: RunFormat) => run.font.ascii ?? run.font.hAnsi;

/** A line height in CSS for text in `run` (`ratio`: its font's normal line height ratio). */
function lineHeight(paragraph: ParagraphFormat, run: RunFormat, ratio: number): string {
  const sizePx = (run.size / 2) * (96 / 72);
  const { line, lineRule } = paragraph.spacing;
  if (line === null) return String(ratio);
  if (lineRule === "exact") return `${line * PX_PER_TWIP}px`;
  if (lineRule === "atLeast") return `${Math.max(line * PX_PER_TWIP, ratio * sizePx)}px`;
  return String((ratio * line) / 240);
}

/** Run formatting as inline CSS on `element`. */
function styleRun(element: HTMLElement, run: RunFormat, line: string): void {
  const { style } = element;
  style.fontFamily = fontStack(latin(run));
  style.fontSize = `${run.size / 2}pt`;
  style.lineHeight = line;
  style.fontWeight = run.bold ? "700" : "400";
  style.fontStyle = run.italic ? "italic" : "normal";
  const decorations = [];
  if (run.underline) decorations.push("underline");
  if (run.strike || run.doubleStrike) decorations.push("line-through");
  if (decorations.length) {
    style.textDecorationLine = decorations.join(" ");
    if (run.doubleStrike || run.underline === "double") style.textDecorationStyle = "double";
    else if (run.underline && UNDERLINES[run.underline])
      style.textDecorationStyle = UNDERLINES[run.underline] as string;
    if (run.underlineColor && run.underlineColor !== "auto")
      style.textDecorationColor = `#${run.underlineColor}`;
  }
  if (run.caps) style.textTransform = "uppercase";
  if (run.smallCaps) style.fontVariant = "small-caps";
  if (run.color) style.color = `#${run.color}`;
  const background = run.highlight ? HIGHLIGHTS[run.highlight] : run.shading && `#${run.shading}`;
  if (background) style.backgroundColor = background;
  if (run.verticalAlign !== "baseline") {
    // Word raises or lowers a smaller copy without growing the line.
    style.verticalAlign = run.verticalAlign === "superscript" ? "super" : "sub";
    style.fontSize = `${(run.size / 2) * (2 / 3)}pt`;
    style.lineHeight = "0";
  }
  if (run.characterSpacing) style.letterSpacing = `${run.characterSpacing * PX_PER_TWIP}px`;
  if (run.hidden) style.display = "none";
}

/** Paragraph properties as inline CSS on `element` (spacing is the flow's). */
function styleParagraph(element: HTMLElement, paragraph: ParagraphFormat): void {
  const { style } = element;
  style.margin = "0";
  style.whiteSpace = "pre-wrap";
  style.overflowWrap = "break-word";
  // Word's default tab stops: every half inch.
  style.tabSize = `${720 * PX_PER_TWIP}px`;
  const { left, right, firstLine, hanging } = paragraph.indent;
  style.paddingLeft = `${left * PX_PER_TWIP}px`;
  style.paddingRight = `${right * PX_PER_TWIP}px`;
  style.textIndent = `${(firstLine - hanging) * PX_PER_TWIP}px`;
  const align = paragraph.justification && ALIGN[paragraph.justification];
  if (align) style.textAlign = align;
  if (paragraph.shading?.fill && paragraph.shading.fill !== "auto")
    style.backgroundColor = `#${paragraph.shading.fill}`;
  for (const [side, border] of Object.entries(paragraph.borders ?? {})) {
    if (!border || side === "between" || side === "bar") continue;
    const kind = BORDER_STYLES[border.style] ?? "solid";
    // Sizes in eighths of a point; the space between text and border in points.
    const width = kind === "none" ? 0 : Math.max(((border.size ?? 4) / 8) * (96 / 72), 1);
    const color = border.color && border.color !== "auto" ? `#${border.color}` : "currentColor";
    style.setProperty(`border-${side}`, `${width}px ${kind} ${color}`);
    style.setProperty(`padding-${side}`, `${((border.space ?? 0) * 96) / 72}px`);
  }
}

/** Text a run of opaque XML shows: its `w:t` elements (field results, content controls). */
function opaqueText(element: Element): string {
  let text = "";
  for (const node of element.getElementsByTagNameNS("*", "*")) {
    if (node.localName === "t") text += node.textContent;
    else if (node.localName === "tab" && node.parentElement?.localName === "r") text += "\t";
  }
  return text;
}

/**
 * Parses verbatim WordprocessingML (opaque content) into an inert XML document, declaring the
 * prefixes it uses; null when it is not well-formed.
 */
export function parseOpaque(xml: string, doc: Document): Element | null {
  const view = doc.defaultView;
  if (!view?.DOMParser) return null;
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(/<\/?([A-Za-z_][\w.-]*):|\s([A-Za-z_][\w.-]*):[\w.-]+\s*=/g)) {
    const prefix = match[1] ?? match[2];
    if (prefix && prefix !== "xml" && prefix !== "xmlns") prefixes.add(prefix);
  }
  const declarations = [...prefixes].map((p) => ` xmlns:${p}="urn:foli:${p}"`).join("");
  const parsed = new view.DOMParser().parseFromString(
    `<foli${declarations}>${xml}</foli>`,
    "application/xml",
  );
  const root = parsed.documentElement;
  if (root.localName !== "foli" || parsed.getElementsByTagName("parsererror").length) return null;
  return root.firstElementChild;
}

/**
 * Renders a document's blocks. `final` review merges a paragraph whose mark was deleted into
 * the next one, as accepting the deletion does.
 */
export function renderBlocks(
  document: FoliDocumentV3,
  doc: Document,
  options: BlockOptions = {},
): WordBlock[] {
  const review = options.review ?? "markup";
  const ratios = new Map<string, number>();
  const ratio = (family: string) => {
    let value = ratios.get(family);
    if (value === undefined) {
      value = options.lineRatio?.(family) ?? 1.2;
      ratios.set(family, value);
    }
    return value;
  };
  const resolver = new Resolver(document);
  const content = document.content.content ?? [];
  const attrsOf = (node: NodeJSON) => (node.attrs ?? {}) as Record<string, unknown>;
  const markers = resolver.markers(
    content.map((node) => (node.type === "paragraph" ? attrsOf(node) : { numbering: { id: 0 } })),
  );
  const blocks: WordBlock[] = [];
  let carried: { nodes: number[]; inline: NodeJSON[] } | null = null;
  /** Comment ranges open at this point of the document. */
  const comments = new Set<number>();

  content.forEach((node, index) => {
    if (node.type !== "paragraph") {
      if (carried) {
        // A deleted paragraph mark before a table: nothing to merge into; shown as it is.
        carried = null;
      }
      blocks.push(opaqueBlock(node, index, resolver, doc, ratio));
      return;
    }
    const attrs = attrsOf(node);
    const revision = attrs.revision as { deletion?: unknown } | null | undefined;
    if (review === "final" && revision?.deletion && index < content.length - 1) {
      const previous: { nodes: number[]; inline: NodeJSON[] } = carried ?? {
        nodes: [],
        inline: [],
      };
      carried = {
        nodes: [...previous.nodes, index],
        inline: [...previous.inline, ...(node.content ?? [])],
      };
      return;
    }
    const merged: { nodes: number[]; inline: NodeJSON[] } = carried ?? { nodes: [], inline: [] };
    carried = null;
    const { paragraph, run } = resolver.paragraph(attrs);
    const element = doc.createElement(tagOf(paragraph));
    styleParagraph(element, paragraph);
    styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
    const marker = markers[index];
    const firstMerged = merged.nodes[0];
    const shownMarker = firstMerged !== undefined ? (markers[firstMerged] ?? null) : marker;
    if (shownMarker) element.append(markerElement(shownMarker, paragraph, doc, ratio));
    const inline = [...merged.inline, ...(node.content ?? [])];
    renderInline(element, inline, run, paragraph, {
      resolver,
      doc,
      review,
      comments,
      ratio,
    });
    // An empty paragraph, or one ending in a line break, shows its last (empty) line; after a
    // page break the paragraph mark stays on the break's line, as in Word.
    const last = element.lastChild as Element | null;
    const endsInBreak = last?.nodeName === "BR";
    if (
      (endsInBreak && !last?.hasAttribute(WORD_PAGE_BREAK_ATTR)) ||
      (!endsInBreak && !element.textContent)
    )
      element.append(doc.createElement("br"));
    const pt = (twips: number) => twips * PX_PER_TWIP;
    const { before, after } = paragraph.spacing;
    // Word's automatic spacing (HTML): 14 pt.
    const spaceBefore = paragraph.spacing.beforeAutospacing ? 280 : before;
    const spaceAfter = paragraph.spacing.afterAutospacing ? 280 : after;
    blocks.push({
      element,
      nodes: [...merged.nodes, index],
      before: pt(spaceBefore),
      after: pt(spaceAfter),
      keepNext: paragraph.keepNext,
      keepLines: paragraph.keepLines,
      pageBreakBefore: paragraph.pageBreakBefore,
      section: (attrs.section as SectionJSON | null | undefined) ?? null,
    });
    element.dataset.style = paragraph.style ?? "";
    if (paragraph.contextualSpacing) element.dataset.contextual = "";
  });
  applyContextualSpacing(blocks);
  return blocks;
}

/** A paragraph's element: a heading of its outline level (1-6), else a paragraph. */
function tagOf(paragraph: ParagraphFormat): string {
  const level = paragraph.outlineLevel;
  return level !== null && level >= 0 && level < 6 ? `h${level + 1}` : "p";
}

/** Word ignores the space between paragraphs of the same style that ask for it. */
function applyContextualSpacing(blocks: WordBlock[]): void {
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1] as WordBlock;
    const b = blocks[i] as WordBlock;
    const style = a.element.dataset.style;
    if (style === undefined || style !== b.element.dataset.style) continue;
    if ("contextual" in a.element.dataset) a.after = 0;
    if ("contextual" in b.element.dataset) b.before = 0;
  }
}

/** A list marker: its text, then what follows it (a tab to the text's indent, a space). */
function markerElement(
  marker: ListMarker,
  paragraph: ParagraphFormat,
  doc: Document,
  ratio: (family: string) => number,
): HTMLElement {
  const span = doc.createElement("span");
  span.dataset.foliMarker = "";
  span.setAttribute("aria-hidden", "true");
  styleRun(
    span,
    marker.run,
    lineHeight(paragraph, marker.run, ratio(fontStack(latin(marker.run)))),
  );
  span.textContent = marker.text;
  const hanging = paragraph.indent.hanging * PX_PER_TWIP;
  if (marker.suffix === "tab" && hanging > 0) {
    // shortcut: a marker wider than the hanging indent goes to the next default tab stop in
    // Word; here the text follows it directly.
    span.style.display = "inline-block";
    span.style.minWidth = `${hanging}px`;
    span.style.textIndent = "0";
  } else if (marker.suffix === "tab") span.textContent += "\t";
  else if (marker.suffix === "space") span.textContent += " ";
  return span;
}

interface InlineContext {
  resolver: Resolver;
  doc: Document;
  review: ReviewView;
  comments: Set<number>;
  ratio: (family: string) => number;
}

/** A paragraph's inline content: runs as spans, breaks, comment anchors, opaque inline content. */
function renderInline(
  parent: HTMLElement,
  inline: readonly NodeJSON[],
  paragraphRun: RunFormat,
  paragraph: ParagraphFormat,
  context: InlineContext,
): void {
  const { resolver, doc, review, comments, ratio } = context;
  for (const node of inline) {
    const marks = (node.marks ?? []) as MarkJSON[];
    const inserted = marks.some((m) => m.type === "insertion");
    const deleted = marks.some((m) => m.type === "deletion");
    if (deleted && review === "final") continue;
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    switch (node.type) {
      case "commentStart":
        comments.add(attrs.id as number);
        continue;
      case "commentEnd":
        comments.delete(attrs.id as number);
        continue;
      case "commentReference": {
        const anchor = doc.createElement("span");
        anchor.dataset.foliCommentReference = String(attrs.id);
        parent.append(anchor);
        continue;
      }
      case "bookmarkStart":
      case "bookmarkEnd":
        continue;
      case "hardBreak":
      case "columnBreak":
        // shortcut: a column break ends the line; Foli lays out one column.
        parent.append(doc.createElement("br"));
        continue;
      case "pageBreak": {
        const br = doc.createElement("br");
        br.setAttribute(WORD_PAGE_BREAK_ATTR, "");
        parent.append(br);
        continue;
      }
      default:
    }
    let text: string;
    if (node.type === "text") text = node.text ?? "";
    else if (node.type === "tab") text = "\t";
    else if (node.type === "opaqueInline") {
      const xml = parseOpaque(String(attrs.xml ?? ""), doc);
      // A run's content (a drawing, a field character) shows as nothing; a content control or
      // simple field as its text.
      text = xml ? opaqueText(xml) : "";
      if (!text) {
        const placeholder = doc.createElement("span");
        placeholder.dataset.foliOpaque = String(attrs.label ?? "");
        parent.append(placeholder);
        continue;
      }
    } else continue;
    const run = resolver.run(paragraphRun, marks);
    let element: HTMLElement = doc.createElement("span");
    styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
    element.textContent = text;
    const link = marks.find((m) => m.type === "link");
    if (link) element.dataset.href = String(link.attrs?.href ?? `#${String(link.attrs?.anchor)}`);
    if (comments.size) {
      element.dataset.foliComments = [...comments].join(" ");
      if (!run.highlight && !run.shading)
        element.style.backgroundColor = "rgba(255, 213, 79, 0.35)";
    }
    if (review === "markup" && (inserted || deleted)) {
      const wrapper = doc.createElement(inserted ? "ins" : "del");
      const author = marks.find((m) => m.type === (inserted ? "insertion" : "deletion"))?.attrs
        ?.author;
      if (author) wrapper.title = String(author);
      wrapper.style.color = "#B5082E";
      wrapper.style.textDecorationLine = inserted ? "underline" : "line-through";
      wrapper.append(element);
      element = wrapper;
    }
    parent.append(element);
  }
}

/**
 * A block the model keeps opaque (tables until Phase 10, block content controls), shown from
 * its XML: a table as a table of its cells' paragraphs, anything else as its paragraphs. Only
 * text is read: no formatting beyond the paragraph styles.
 */
function opaqueBlock(
  node: NodeJSON,
  index: number,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
): WordBlock {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const element = doc.createElement("div");
  element.dataset.foliOpaque = String(attrs.label ?? "");
  element.style.margin = "0";
  const xml = parseOpaque(String(attrs.xml ?? ""), doc);
  let after = 0;
  if (xml?.localName === "tbl") element.append(opaqueTable(xml, resolver, doc, ratio));
  else if (xml) {
    const paragraphs = [...xml.getElementsByTagNameNS("*", "p")];
    paragraphs.forEach((p, i) => {
      const rendered = opaqueParagraph(p, resolver, doc, ratio);
      if (i < paragraphs.length - 1) rendered.element.style.marginBottom = `${rendered.after}px`;
      else after = rendered.after;
      element.append(rendered.element);
    });
  }
  if (!element.firstChild) {
    // Nothing to show: a placeholder line.
    element.style.minHeight = "1em";
    element.style.outline = "1px dashed #999";
  }
  return {
    element,
    nodes: [index],
    before: 0,
    after,
    keepNext: false,
    keepLines: false,
    pageBreakBefore: false,
    section: null,
  };
}

/** The value of a WordprocessingML child's `w:val` (by local names). */
function childValue(element: Element | null | undefined, name: string, attribute = "val") {
  for (const child of element?.children ?? []) {
    if (child.localName !== name) continue;
    for (const a of child.attributes) if (a.localName === attribute) return a.value;
  }
  return undefined;
}
function child(element: Element | null | undefined, name: string): Element | undefined {
  for (const c of element?.children ?? []) if (c.localName === name) return c;
  return undefined;
}

/** A paragraph of opaque XML: its style's formatting and its text. */
function opaqueParagraph(
  p: Element,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
): { element: HTMLElement; after: number } {
  const pPr = child(p, "pPr");
  const style = childValue(pPr, "pStyle");
  const justification = childValue(pPr, "jc");
  const { paragraph, run } = resolver.paragraph({
    ...(style ? { style } : {}),
    ...(justification ? { justification } : {}),
  });
  const element = doc.createElement(tagOf(paragraph));
  styleParagraph(element, paragraph);
  styleRun(element, run, lineHeight(paragraph, run, ratio(fontStack(latin(run)))));
  for (const r of p.getElementsByTagNameNS("*", "r")) {
    // Deleted text is `w:delText`: not read, in markup too (shortcut: shown as accepted).
    const text = opaqueText(r);
    const formatted = resolver.run(run, runMarks(child(r, "rPr")));
    const span = doc.createElement("span");
    styleRun(span, formatted, lineHeight(paragraph, formatted, ratio(fontStack(latin(formatted)))));
    span.textContent = text;
    element.append(span);
  }
  if (!element.textContent) element.append(doc.createElement("br"));
  if (paragraph.spacing.before)
    element.style.marginTop = `${paragraph.spacing.before * PX_PER_TWIP}px`;
  return { element, after: paragraph.spacing.after * PX_PER_TWIP };
}

/** The run properties of verbatim XML Foli reads for showing it (`w:rPr`) as marks. */
function runMarks(rPr: Element | undefined): MarkJSON[] {
  const marks: MarkJSON[] = [];
  const on = (name: string) => {
    const value = childValue(rPr, name);
    return value === undefined || !["0", "false", "off"].includes(value);
  };
  const style = childValue(rPr, "rStyle");
  if (style) marks.push({ type: "characterStyle", attrs: { id: style } });
  for (const [name, type] of [
    ["b", "bold"],
    ["i", "italic"],
    ["caps", "caps"],
    ["smallCaps", "smallCaps"],
    ["strike", "strike"],
  ] as const)
    if (child(rPr, name)) marks.push({ type, attrs: { value: on(name) } });
  const underline = childValue(rPr, "u");
  if (underline) marks.push({ type: "underline", attrs: { style: underline } });
  const color = childValue(rPr, "color");
  if (color) marks.push({ type: "color", attrs: { value: color } });
  const size = Number(childValue(rPr, "sz"));
  if (size > 0) marks.push({ type: "fontSize", attrs: { value: size } });
  const highlight = childValue(rPr, "highlight");
  if (highlight) marks.push({ type: "highlight", attrs: { value: highlight } });
  return marks;
}

/** A WordprocessingML border (`w:top`, `w:insideH`…) as CSS; undefined when it says none. */
function borderCss(border: Element | undefined): string | undefined {
  if (!border) return undefined;
  const value = childValueOf(border, "val") ?? "single";
  if (value === "nil" || value === "none") return "none";
  const size = Number(childValueOf(border, "sz") ?? 4);
  const color = childValueOf(border, "color");
  const kind = BORDER_STYLES[value] ?? "solid";
  // Sizes in eighths of a point.
  const width = Math.max((size / 8) * (96 / 72), 0.5);
  return `${width}px ${kind} ${color && color !== "auto" ? `#${color}` : "#000"}`;
}

/** Cell margins (`w:tblCellMar`, `w:tcMar`) in px by side, over `base`. */
function margins(element: Element | undefined, base: Record<string, number>) {
  const out = { ...base };
  for (const side of element?.children ?? []) {
    const name =
      side.localName === "start" ? "left" : side.localName === "end" ? "right" : side.localName;
    const width = Number(childValueOf(side, "w"));
    if (name in out && Number.isFinite(width)) out[name] = width * PX_PER_TWIP;
  }
  return out;
}

/** A table of opaque XML: rows, cells (spans, widths, margins, borders, shading) and their paragraphs. */
function opaqueTable(
  tbl: Element,
  resolver: Resolver,
  doc: Document,
  ratio: (family: string) => number,
): HTMLElement {
  const table = doc.createElement("table");
  const { style } = table;
  style.borderCollapse = "collapse";
  style.tableLayout = "fixed";
  const tblPr = child(tbl, "tblPr");
  const borders = child(tblPr, "tblBorders");
  for (const side of ["top", "left", "bottom", "right"]) {
    const css = borderCss(child(borders, side));
    if (css) style.setProperty(`border-${side}`, css);
  }
  // Word's default cell margins: 0.08 inch left and right.
  const tableMargins = margins(child(tblPr, "tblCellMar"), {
    top: 0,
    bottom: 0,
    left: 108 * PX_PER_TWIP,
    right: 108 * PX_PER_TWIP,
  });
  const grid = [...(child(tbl, "tblGrid")?.children ?? [])]
    .filter((c) => c.localName === "gridCol")
    .map((c) => Number(childValueOf(c, "w")) || 0);
  const total = grid.reduce((a, b) => a + b, 0);
  if (total) style.width = `${total * PX_PER_TWIP}px`;
  const colgroup = doc.createElement("colgroup");
  for (const width of grid) {
    const col = doc.createElement("col");
    col.style.width = `${width * PX_PER_TWIP}px`;
    colgroup.append(col);
  }
  table.append(colgroup);
  const inside = {
    horizontal: borderCss(child(borders, "insideH")),
    vertical: borderCss(child(borders, "insideV")),
  };
  const body = doc.createElement("tbody");
  for (const tr of tbl.children) {
    if (tr.localName !== "tr") continue;
    const row = doc.createElement("tr");
    const trPr = child(tr, "trPr");
    // A header row, repeated at the top of each page the table continues on.
    const header = childValue(trPr, "tblHeader");
    if (child(trPr, "tblHeader") && header !== "0" && header !== "false")
      row.dataset.foliHeader = "";
    const rowMargins = margins(child(child(tr, "tblPrEx"), "tblCellMar"), tableMargins);
    for (const tc of tr.children) {
      if (tc.localName !== "tc") continue;
      const tcPr = child(tc, "tcPr");
      const cell = doc.createElement("td");
      const span = Number(childValue(tcPr, "gridSpan"));
      if (span > 1) cell.colSpan = span;
      const fill = childValue(tcPr, "shd", "fill");
      if (fill && fill !== "auto") cell.style.backgroundColor = `#${fill}`;
      const m = margins(child(tcPr, "tcMar"), rowMargins);
      cell.style.padding = `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`;
      cell.style.verticalAlign = "top";
      if (inside.horizontal) cell.style.borderTop = cell.style.borderBottom = inside.horizontal;
      if (inside.vertical) cell.style.borderLeft = cell.style.borderRight = inside.vertical;
      const own = child(tcPr, "tcBorders");
      for (const side of ["top", "left", "bottom", "right"]) {
        const css = borderCss(child(own, side));
        if (css) cell.style.setProperty(`border-${side}`, css);
      }
      // A cell merged into the one above shows nothing of its own.
      if (child(tcPr, "vMerge") && childValue(tcPr, "vMerge") !== "restart") {
        row.append(cell);
        continue;
      }
      for (const p of tc.children) {
        if (p.localName !== "p") continue;
        // Word counts the space after a cell's last paragraph in the row's height too.
        const rendered = opaqueParagraph(p, resolver, doc, ratio);
        rendered.element.style.marginBottom = `${rendered.after}px`;
        cell.append(rendered.element);
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  return table;
}

function childValueOf(element: Element, attribute: string): string | undefined {
  for (const a of element.attributes) if (a.localName === attribute) return a.value;
  return undefined;
}
