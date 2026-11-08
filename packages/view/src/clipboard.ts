import {
  type Alignment,
  type DocJSON,
  Fragment,
  type InlineJSON,
  isSafeHref,
  type MarkJSON,
  type Node as ModelNode,
  type ParagraphJSON,
  parseContent,
  type SimpleMarkName,
} from "@folijs/core";
import { PAGE_BREAK_ATTR, renderTree } from "./render.js";

/**
 * Clipboard type for Foli content, read back first on paste: `{ open, content }`, the copied
 * blocks as `DocJSON` and whether they were cut out of one block (see `Pasted.open`).
 */
export const FOLI_MIME = "application/x-foli+json";

/** Validated clipboard content. */
export interface Pasted {
  doc: ModelNode;
  /**
   * True when no block boundary was copied (text from inside one block, plain text, inline
   * HTML): the content always joins the block it is pasted into, which keeps its type. Closed
   * content (whole blocks) replaces an empty block instead.
   */
  open: boolean;
}

export interface ClipboardContent {
  text: string;
  html: string;
  json: string;
}

/** Serializes `from..to` of `doc` for the clipboard. Hard breaks and block ends become "\n". */
export function serializeRange(
  doc: ModelNode,
  from: number,
  to: number,
  ownerDocument: Document,
): ClipboardContent {
  // A slice inside one textblock holds only inline content: wrap it back in its ancestors.
  const $from = doc.resolve(from);
  let content = doc.slice(from, to).content;
  for (let depth = $from.sharedDepth(to); depth > 0; depth--)
    content = Fragment.from($from.node(depth).copy(content));
  // Not validated: a cut-open list item may lack its first paragraph. The JSON is validated
  // when pasted; the HTML is only markup.
  const blocks = doc.type.createOpen(null, content);
  const container = ownerDocument.createElement("div");
  // Built with createElement/textContent (render.ts); reading innerHTML only serializes it.
  // A range inside one textblock is that block's text: its lists around it stay out of the HTML
  // (a word copied from a list item must not paste as a one-item list); the JSON keeps them.
  const $to = doc.resolve(to);
  const inline = $from.parent.isTextblock && $from.sameParent($to);
  const htmlBlocks = inline
    ? [$from.parent.copy(doc.slice(from, to).content)]
    : blocks.content.content;
  renderTree(htmlBlocks, container, ownerDocument);
  // Keep repeated and leading spaces in other apps.
  for (const block of container.querySelectorAll("p, h1, h2, h3, h4, h5, h6"))
    (block as HTMLElement).style.whiteSpace = "pre-wrap";
  // How other apps (and print) recognize a page break; the editor itself does not need it.
  for (const br of container.querySelectorAll(`br[${PAGE_BREAK_ATTR}]`))
    (br as HTMLElement).style.cssText = "page-break-before: always; break-before: page";
  return {
    text: doc.textBetween(from, to, "\n", "\n"),
    html: container.innerHTML,
    json: JSON.stringify({ open: $from.sharedDepth(to) > 0, content: blocks.toJSON() }),
  };
}

/**
 * The content of clipboard data, validated, or null. Priority: Foli JSON, then HTML, then plain
 * text. Every format is validated by the schema (`parseContent`); a format that fails falls
 * through to the next. `marks` are given to plain text (the marks typing would get at the
 * insertion point).
 */
export function docFromClipboard(
  data: Pick<DataTransfer, "getData">,
  marks: readonly MarkJSON[] = [],
): Pasted | null {
  const json = data.getData(FOLI_MIME);
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  const candidates: (() => { content: unknown; open: boolean } | null)[] = [
    () => {
      if (!json) return null;
      const value: unknown = JSON.parse(json);
      if (typeof value !== "object" || value === null) return null;
      const { open, content } = value as { open?: unknown; content?: unknown };
      return { content, open: open === true };
    },
    () => (html ? readHTML(html) : null),
    () => (text ? { content: textToDoc(text, marks), open: true } : null),
  ];
  for (const candidate of candidates) {
    try {
      const found = candidate();
      if (!found) continue;
      return { doc: parseContent(found.content), open: found.open };
    } catch {
      // Invalid or unreadable in this format: try the next one.
    }
  }
  return null;
}

/** Plain text: one paragraph per line. */
export function textToDoc(text: string, marks: readonly MarkJSON[] = []): DocJSON {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line
        ? {
            content: [{ type: "text", text: line, ...(marks.length ? { marks: [...marks] } : {}) }],
          }
        : {}),
    })) as ParagraphJSON[],
  };
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Elements whose content is never document text. */
const SKIPPED_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "head",
  "iframe",
  "img",
  "input",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "video",
]);

const TAG_MARKS: ReadonlyMap<string, SimpleMarkName> = new Map([
  ["b", "bold"],
  ["strong", "bold"],
  ["i", "italic"],
  ["em", "italic"],
  ["u", "underline"],
  ["ins", "underline"],
  ["s", "strike"],
  ["strike", "strike"],
  ["del", "strike"],
]);

/** Marks by type: one of each (a link, a text color and a highlight carry attributes). */
type Marks = ReadonlyMap<string, MarkJSON>;

const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  olive: "#808000",
  orange: "#ffa500",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
};

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/**
 * A CSS color as the schema stores it (lowercase `#rrggbb`), or null: transparent, unknown
 * (system colors such as Word's `windowtext`) or empty. Hex (3 or 6 digits), `rgb()`/`rgba()`
 * and the basic named colors.
 */
export function parseColor(value: string): string | null {
  const color = value.trim().toLowerCase();
  const named = NAMED_COLORS[color];
  if (named) return named;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(
      color,
    );
  if (!rgb) return null;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null; // fully transparent
  return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
}

/**
 * Marks of an element on top of the inherited ones: tags first, then inline styles; a link
 * from `a[href]` when the href is safe (`isSafeHref`; links inside the source page, `#…`, are
 * dropped); text color and highlight from inline elements only (a page's colored containers
 * are layout, not formatting), black text and white highlight being the defaults.
 */
function marksOf(element: Element, inherited: Marks): Map<string, MarkJSON> {
  const marks = new Map(inherited);
  const tag = element.localName;
  const tagMark = TAG_MARKS.get(tag);
  if (tagMark) marks.set(tagMark, { type: tagMark });
  if (tag === "a") {
    const href = element.getAttribute("href")?.trim().replace(/ /g, "%20");
    if (href && !href.startsWith("#") && isSafeHref(href)) {
      marks.set("link", { type: "link", attrs: { href } } as MarkJSON);
    }
  }
  const style = (element as HTMLElement).style;
  if (!style) return marks;
  const weight = style.fontWeight;
  // Google Docs wraps everything in <b style="font-weight:normal">.
  if (/^(bold|bolder|[6-9]00)$/.test(weight)) marks.set("bold", { type: "bold" });
  else if (/^(normal|lighter|[1-5]00)$/.test(weight)) marks.delete("bold");
  if (/^(italic|oblique)/.test(style.fontStyle)) marks.set("italic", { type: "italic" });
  else if (style.fontStyle === "normal") marks.delete("italic");
  const decoration = `${style.textDecorationLine} ${style.textDecoration}`;
  if (decoration.includes("underline")) marks.set("underline", { type: "underline" });
  if (decoration.includes("line-through")) marks.set("strike", { type: "strike" });
  // `text-decoration: none` on a child does not remove a parent's line in CSS: keep it.
  if (!BLOCK_TAGS.has(tag)) {
    const color = parseColor(
      style.color || (tag === "font" ? (element.getAttribute("color") ?? "") : ""),
    );
    if (color === "#000000") marks.delete("textColor");
    else if (color) marks.set("textColor", { type: "textColor", attrs: { color } } as MarkJSON);
    const background = parseColor(style.backgroundColor);
    if (background === "#ffffff") marks.delete("highlight");
    else if (background) {
      marks.set("highlight", { type: "highlight", attrs: { color: background } } as MarkJSON);
    }
  }
  return marks;
}

/** A block's own alignment (`text-align`, or the old `align` attribute), or undefined. */
function alignOf(element: Element): Alignment | undefined {
  const value = (
    (element as HTMLElement).style?.textAlign ||
    element.getAttribute("align") ||
    ""
  ).toLowerCase();
  if (value === "left" || value === "start") return "start";
  if (value === "center" || value === "-webkit-center") return "center";
  if (value === "right" || value === "end") return "end";
  if (value === "justify") return "justify";
  return undefined;
}

/**
 * A page break in pasted HTML: Foli's own `<br data-page-break>`, or a `<br>` or `<hr>` styled
 * to break the page (Word writes `<br clear=all style='page-break-before:always'>`, Google Docs
 * `<hr style="page-break-before:always;display:none">`).
 *
 * shortcut: a block styled to break before or after it (`<p style="page-break-before:always">`) loses the break; map it when a real capture needs it.
 */
function isPageBreak(element: Element): boolean {
  if (element.localName !== "br" && element.localName !== "hr") return false;
  if (element.hasAttribute(PAGE_BREAK_ATTR)) return true;
  const style = element.getAttribute("style") ?? "";
  // Anchored on a property start, so Word's `mso-column-break-before` (a column break) is not one.
  return /(?:^|[;\s])(?:page-)?break-(?:before|after)\s*:\s*(?:always|page)/i.test(style);
}

/** Hidden text, Word's list bullets and empty-paragraph fillers. */
function isNoise(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  if (/mso-list:\s*ignore|mso-hide:\s*all/i.test(style)) return true;
  if ((element as HTMLElement).style?.display === "none" || element.hasAttribute("hidden")) {
    return true;
  }
  return element.localName === "o:p" && !element.textContent?.replace(/[\s ]/g, "");
}

/**
 * A Word list paragraph (`style="mso-list:l0 level2 lfo1"`): its list and level, and from its
 * marker (the `mso-list:Ignore` span Word adds for other apps) whether it is numbered and
 * where the numbering starts. Best effort: a marker ending in "." or ")" is a number or
 * letter (numbered); anything else ("·", "o", "§") a bullet.
 */
function wordListItem(
  element: Element,
): { list: string; level: number; ordered: boolean; start: number } | null {
  const match = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(element.getAttribute("style") ?? "");
  if (!match) return null;
  let marker = "";
  for (const child of element.querySelectorAll("[style]")) {
    if (/mso-list:\s*ignore/i.test(child.getAttribute("style") ?? "")) {
      marker = (child.textContent ?? "").replace(/[\s ]+/g, "");
      break;
    }
  }
  const ordered = /^\(?[0-9a-zA-Z]{1,6}[.)]$/.test(marker);
  const number = /^\(?(\d+)/.exec(marker);
  return {
    list: match[1] as string,
    level: Number(match[2]),
    ordered,
    start: ordered && number ? Number(number[1]) : 1,
  };
}

/** Loose block JSON while reading (validated by the schema afterwards). */
interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (BlockNode | InlineJSON)[];
}

interface Container {
  node: BlockNode;
  kind: "doc" | "list" | "item";
  /** An item the reader opened itself (text directly in a list, a list nested in a list). */
  implicit?: boolean;
  /** Where a list goes when it closes (lists with no items are dropped). */
  parent?: BlockNode[];
  /** A Word list paragraph's list and level (Word lists are flat paragraphs). */
  word?: { list: string; level: number; ordered: boolean };
}

/** A list item must start with a paragraph: a heading becomes one, else one is added. */
function finishItem(item: BlockNode): void {
  if (!item.content) item.content = [];
  const content = item.content as BlockNode[];
  const first = content[0];
  if (first?.type === "heading") {
    first.type = "paragraph";
    const align = first.attrs?.align;
    if (align) first.attrs = { align };
    else delete first.attrs;
  } else if (first?.type !== "paragraph") {
    content.unshift({ type: "paragraph" });
  }
}

/**
 * Own HTML reader: maps known tags and inline styles to the schema (paragraphs, headings,
 * lists, rules; bold, italic, underline, strike, links, colors; alignment), drops everything
 * else. The HTML is parsed into an inert document and never inserted.
 */
export function htmlToDoc(html: string): DocJSON | null {
  return readHTML(html)?.content ?? null;
}

/** `htmlToDoc`, plus whether the HTML had no block elements (`Pasted.open`). */
function readHTML(html: string): { content: DocJSON; open: boolean } | null {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const doc: BlockNode = { type: "doc", content: [] };
  const stack: Container[] = [{ node: doc, kind: "doc" }];
  let inline: InlineJSON[] | null = null;
  let blockType: "paragraph" | "heading" = "paragraph";
  let level = 1;
  let blockAlign: Alignment | undefined;
  let blockPre = false;
  let sawBlock = false;
  let afterSpace = true; // collapse leading and repeated whitespace like HTML layout does

  const top = () => stack[stack.length - 1] as Container;
  /** Where blocks go now: the open item or the document (text directly in a list gets an item). */
  const container = (): BlockNode[] => {
    if (top().kind === "list") {
      const item: BlockNode = { type: "listItem", content: [] };
      (top().node.content as BlockNode[]).push(item);
      stack.push({ node: item, kind: "item", implicit: true });
    }
    return top().node.content as BlockNode[];
  };
  const lastBlock = (): BlockNode | undefined => {
    const blocks = top().node.content as BlockNode[];
    return blocks[blocks.length - 1];
  };

  const open = (
    type: "paragraph" | "heading",
    headingLevel = 1,
    pre = false,
    align: Alignment | undefined = undefined,
  ) => {
    inline = [];
    blockType = type;
    level = headingLevel;
    blockAlign = align;
    blockPre = pre;
    afterSpace = true;
  };
  const close = (keepEmpty: boolean) => {
    if (!inline) return;
    const last = inline[inline.length - 1];
    if (last?.type === "hardBreak") inline.pop(); // a trailing <br> adds no line in HTML
    const tail = inline[inline.length - 1];
    if (tail?.type === "text" && !blockPre) tail.text = tail.text.replace(/ +$/, "");
    // Non-breaking spaces survive the trimming above, then become ordinary spaces.
    for (const node of inline) {
      if (node.type === "text") node.text = node.text.replace(/ /g, " ");
    }
    const content = inline.filter((node) => node.type !== "text" || node.text);
    inline = null;
    if (!content.length && !keepEmpty) return;
    const attrs: Record<string, unknown> = {};
    if (blockType === "heading") attrs.level = level;
    if (blockAlign && blockAlign !== "start") attrs.align = blockAlign;
    container().push({
      type: blockType,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(content.length ? { content } : {}),
    });
  };
  const addText = (raw: string, marks: Marks, pre: boolean) => {
    // Source formatting between blocks ("</p>\n<br>\n<p>") is not content.
    if (!inline && !pre && !/[^ \t\n\r\f]/.test(raw)) return;
    if (!inline) open("paragraph", 1, pre);
    const lines = pre ? raw.replace(/\r\n?/g, "\n").split("\n") : [raw];
    lines.forEach((line, i) => {
      if (i > 0) addBreak();
      let text = pre ? line : line.replace(/[ \t\n\r\f]+/g, " ");
      if (!pre && afterSpace) text = text.replace(/^ /, "");
      if (!text) return;
      afterSpace = !pre && text.endsWith(" ");
      // A link's own look (Google Docs' blue underline) is the link's, not formatting.
      const markJSON = [...marks.values()].filter(
        (mark) => !marks.has("link") || (mark.type !== "underline" && mark.type !== "textColor"),
      );
      (inline as InlineJSON[]).push({
        type: "text",
        text,
        ...(markJSON.length ? { marks: markJSON } : {}),
      } as InlineJSON);
    });
  };
  /** An explicit page break: in the open block, else at the end of the previous textblock. */
  const addPageBreak = () => {
    const previous = lastBlock();
    if (inline) inline.push({ type: "pageBreak" });
    else if (previous && (previous.type === "paragraph" || previous.type === "heading")) {
      previous.content = [...(previous.content ?? []), { type: "pageBreak" }];
    } else {
      open("paragraph");
      (inline as InlineJSON[] | null)?.push({ type: "pageBreak" });
    }
    afterSpace = true;
  };
  const addBreak = () => {
    // A <br> between blocks is an empty line (Google Docs writes empty paragraphs this way).
    if (!inline) {
      container().push({ type: "paragraph" });
      return;
    }
    const list = inline as InlineJSON[];
    const tail = list[list.length - 1];
    if (tail?.type === "text") tail.text = tail.text.replace(/ +$/, "");
    list.push({ type: "hardBreak" });
    afterSpace = true;
  };

  /** Closes the top container: an item gets its first paragraph, a list goes to its parent. */
  const pop = () => {
    const container = stack.pop() as Container;
    if (container.kind === "item") finishItem(container.node);
    if (container.kind === "list" && container.node.content?.length) {
      container.parent?.push(container.node);
    }
  };
  /** Opens a list; one directly inside a list (sloppy HTML, Google Docs) nests in its last item. */
  const openList = (ordered: boolean, start: number, word?: Container["word"]) => {
    close(false);
    if (top().kind === "list") {
      const items = top().node.content as BlockNode[];
      let item = items[items.length - 1];
      if (!item) {
        item = { type: "listItem", content: [] };
        items.push(item);
      }
      stack.push({ node: item, kind: "item", implicit: true });
    }
    const node: BlockNode = {
      type: ordered ? "orderedList" : "bulletList",
      ...(ordered && start !== 1 && Number.isInteger(start) && start >= 0 && start <= 99_999
        ? { attrs: { start } }
        : {}),
      content: [],
    };
    stack.push({
      node,
      kind: "list",
      parent: top().node.content as BlockNode[],
      ...(word && { word }),
    });
  };
  const closeList = () => {
    close(false);
    while (top().kind === "item" && top().implicit) pop();
    if (top().kind === "list") pop();
    // The item this list was nested into because its parent was a list.
    if (top().kind === "item" && top().implicit) pop();
  };
  const openItem = (word?: Container["word"]) => {
    close(false);
    while (top().kind === "item" && (top().implicit || word)) pop();
    const item: BlockNode = { type: "listItem", content: [] };
    (top().node.content as BlockNode[]).push(item);
    stack.push({ node: item, kind: "item", ...(word && { word }) });
  };
  const closeItem = () => {
    close(false);
    while (top().kind === "item" && top().implicit) pop();
    if (top().kind === "item") pop();
  };

  /** Word lists are flat paragraphs with levels: open and close lists to nest them. */
  const wordItem = (item: NonNullable<ReturnType<typeof wordListItem>>) => {
    close(false);
    const wordList = () => {
      for (let i = stack.length - 1; i > 0; i--) {
        const entry = stack[i] as Container;
        if (entry.kind === "list" && entry.word) return { entry, index: i };
      }
      return null;
    };
    for (let found = wordList(); found; found = wordList()) {
      const { word } = found.entry;
      if (!word) break;
      const same =
        word.level === item.level && word.list === item.list && word.ordered === item.ordered;
      if (word.level < item.level || (same && word.level === item.level)) break;
      while (stack.length > found.index) pop();
    }
    const current = wordList();
    const word = { list: item.list, level: item.level, ordered: item.ordered };
    if (!current || current.entry.word?.level !== item.level) {
      openList(item.ordered, item.start, word);
    } else {
      // A sibling item: close the previous one (and anything nested in it).
      while (stack.length > current.index + 1) pop();
    }
    openItem(word);
  };
  const closeWordLists = () => {
    close(false);
    while (stack.some((entry) => entry.word)) pop();
  };

  interface Context {
    marks: Marks;
    pre: boolean;
    align: Alignment | undefined;
  }

  /** Walks `node`; returns whether it contained a block element. */
  const walk = (node: Node, context: Context): boolean => {
    if (node.nodeType === 3) {
      addText((node as Text).data, context.marks, context.pre);
      return false;
    }
    if (node.nodeType !== 1) return false; // comments (Word's conditional comments), etc.
    const element = node as Element;
    const tag = element.localName;
    // Before the noise check: Google Docs hides its page-break <hr> (display: none).
    if (isPageBreak(element)) {
      addPageBreak();
      return false;
    }
    if (SKIPPED_TAGS.has(tag) || isNoise(element)) return false;
    if (tag === "br") {
      // Chrome marks "the copied range ended with a line break" this way; it is not content.
      if (!element.classList.contains("Apple-interchange-newline")) addBreak();
      return false;
    }
    const whiteSpace = (element as HTMLElement).style?.whiteSpace ?? "";
    const child: Context = {
      marks: marksOf(element, context.marks),
      pre: context.pre || tag === "pre" || whiteSpace.startsWith("pre"),
      align: BLOCK_TAGS.has(tag) ? (alignOf(element) ?? context.align) : context.align,
    };
    const children = () => {
      let hasBlock = false;
      for (const node of element.childNodes) hasBlock = walk(node, child) || hasBlock;
      return hasBlock;
    };
    if (!BLOCK_TAGS.has(tag)) return children();
    sawBlock = true;
    const word = wordListItem(element);
    if (word) {
      wordItem(word);
      open("paragraph", 1, child.pre, child.align);
      children();
      close(true);
      return true;
    }
    // Word wraps its content in a <div>: only a block of its own content ends Word lists.
    if (!/^(div|body|section|article|main)$/.test(tag)) closeWordLists();
    if (tag === "ul" || tag === "ol") {
      const start = Number(element.getAttribute("start") ?? 1);
      openList(tag === "ol", start);
      children();
      closeList();
      return true;
    }
    if (tag === "li" && stack.some((entry) => entry.kind === "list")) {
      // Inside a list item that is itself still open, an <li> is a sibling: close down to a list.
      while (top().kind === "item") closeItem();
      openItem();
      children();
      closeItem();
      return true;
    }
    if (tag === "hr") {
      close(false);
      container().push({ type: "horizontalRule" });
      return true;
    }
    close(false);
    const heading = /^h([1-6])$/.exec(tag);
    open(
      heading ? "heading" : "paragraph",
      heading ? Number(heading[1]) : 1,
      child.pre,
      child.align,
    );
    const hasBlock = children();
    // <p></p> is an empty line; a container such as <div><p>…</p></div> adds none.
    close(!hasBlock && !/^(ol|ul|dl|table|tbody|thead|tfoot|tr|li)$/.test(tag));
    return true;
  };

  walk(parsed.body, { marks: new Map(), pre: false, align: undefined });
  close(false);
  while (stack.length > 1) pop();
  const content = doc.content as BlockNode[];
  return content.length
    ? { content: { type: "doc", content } as unknown as DocJSON, open: !sawBlock }
    : null;
}
