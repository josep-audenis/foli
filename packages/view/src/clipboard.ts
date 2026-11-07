import {
  type DocJSON,
  Fragment,
  type HeadingJSON,
  type InlineJSON,
  type MarkJSON,
  type Node as ModelNode,
  type ParagraphJSON,
  parseContent,
  type SimpleMarkName,
} from "@folijs/core";
import { PAGE_BREAK_ATTR, renderBlock } from "./render.js";

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
  const blocks = doc.type.create(null, content);
  const container = ownerDocument.createElement("div");
  // Built with createElement/textContent (render.ts); reading innerHTML only serializes it.
  blocks.forEach((block) => {
    const { dom } = renderBlock(block, ownerDocument);
    dom.style.whiteSpace = "pre-wrap"; // keep repeated and leading spaces in other apps
    // How other apps (and print) recognize a page break; the editor itself does not need it.
    for (const br of dom.querySelectorAll(`br[${PAGE_BREAK_ATTR}]`))
      (br as HTMLElement).style.cssText = "page-break-before: always; break-before: page";
    container.append(dom);
  });
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

/** Marks of an element on top of the inherited ones: tags first, then inline styles. */
function marksOf(element: Element, inherited: ReadonlySet<SimpleMarkName>): Set<SimpleMarkName> {
  const marks = new Set(inherited);
  const tagMark = TAG_MARKS.get(element.localName);
  if (tagMark) marks.add(tagMark);
  const style = (element as HTMLElement).style;
  if (!style) return marks;
  const weight = style.fontWeight;
  // Google Docs wraps everything in <b style="font-weight:normal">.
  if (/^(bold|bolder|[6-9]00)$/.test(weight)) marks.add("bold");
  else if (/^(normal|lighter|[1-5]00)$/.test(weight)) marks.delete("bold");
  if (/^(italic|oblique)/.test(style.fontStyle)) marks.add("italic");
  else if (style.fontStyle === "normal") marks.delete("italic");
  const decoration = `${style.textDecorationLine} ${style.textDecoration}`;
  if (decoration.includes("underline")) marks.add("underline");
  if (decoration.includes("line-through")) marks.add("strike");
  // `text-decoration: none` on a child does not remove a parent's line in CSS: keep it.
  return marks;
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
  return element.localName === "o:p" && !element.textContent?.replace(/[\s ]/g, "");
}

/**
 * Own HTML reader: maps known tags and inline styles to schema v1, drops everything else
 * (links keep their text). The HTML is parsed into an inert document and never inserted.
 */
export function htmlToDoc(html: string): DocJSON | null {
  return readHTML(html)?.content ?? null;
}

/** `htmlToDoc`, plus whether the HTML had no block elements (`Pasted.open`). */
function readHTML(html: string): { content: DocJSON; open: boolean } | null {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  // Paste maps HTML to paragraphs and headings (lists, links, rules: task 7.8).
  const blocks: (ParagraphJSON | HeadingJSON)[] = [];
  let inline: InlineJSON[] | null = null;
  let blockType: (ParagraphJSON | HeadingJSON)["type"] = "paragraph";
  let level = 1;
  let blockPre = false;
  let sawBlock = false;
  let afterSpace = true; // collapse leading and repeated whitespace like HTML layout does

  const open = (type: (ParagraphJSON | HeadingJSON)["type"], headingLevel = 1, pre = false) => {
    inline = [];
    blockType = type;
    level = headingLevel;
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
      if (node.type === "text") node.text = node.text.replace(/\u00a0/g, " ");
    }
    const content = inline.filter((node) => node.type !== "text" || node.text);
    if (content.length || keepEmpty) {
      blocks.push(
        blockType === "heading"
          ? ({ type: "heading", attrs: { level }, content } as HeadingJSON)
          : ({ type: "paragraph", content } as ParagraphJSON),
      );
    }
    inline = null;
  };
  const addText = (raw: string, marks: ReadonlySet<SimpleMarkName>, pre: boolean) => {
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
      const markJSON = [...marks].map((type) => ({ type }));
      (inline as InlineJSON[]).push({
        type: "text",
        text,
        ...(markJSON.length ? { marks: markJSON } : {}),
      } as InlineJSON);
    });
  };
  /** An explicit page break: in the open block, else at the end of the previous one. */
  const addPageBreak = () => {
    const previous = blocks[blocks.length - 1];
    if (inline) inline.push({ type: "pageBreak" });
    else if (previous) previous.content = [...(previous.content ?? []), { type: "pageBreak" }];
    else {
      open("paragraph");
      (inline as InlineJSON[] | null)?.push({ type: "pageBreak" });
    }
    afterSpace = true;
  };
  const addBreak = () => {
    // A <br> between blocks is an empty line (Google Docs writes empty paragraphs this way).
    if (!inline) {
      blocks.push({ type: "paragraph" });
      return;
    }
    const list = inline as InlineJSON[];
    const tail = list[list.length - 1];
    if (tail?.type === "text") tail.text = tail.text.replace(/ +$/, "");
    list.push({ type: "hardBreak" });
    afterSpace = true;
  };

  /** Walks `node`; returns whether it contained a block element. */
  const walk = (node: Node, marks: ReadonlySet<SimpleMarkName>, pre: boolean): boolean => {
    if (node.nodeType === 3) {
      addText((node as Text).data, marks, pre);
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
    const childMarks = marksOf(element, marks);
    const whiteSpace = (element as HTMLElement).style?.whiteSpace ?? "";
    const childPre = pre || tag === "pre" || whiteSpace.startsWith("pre");
    if (!BLOCK_TAGS.has(tag)) {
      let hasBlock = false;
      for (const child of element.childNodes)
        hasBlock = walk(child, childMarks, childPre) || hasBlock;
      return hasBlock;
    }
    sawBlock = true;
    close(false);
    const heading = /^h([1-6])$/.exec(tag);
    open(heading ? "heading" : "paragraph", heading ? Number(heading[1]) : 1, childPre);
    let hasBlock = false;
    for (const child of element.childNodes)
      hasBlock = walk(child, childMarks, childPre) || hasBlock;
    // <p></p> is an empty line; a container such as <div><p>…</p></div> adds none.
    close(!hasBlock && tag !== "hr" && !/^(ol|ul|dl|table|tbody|thead|tfoot|tr)$/.test(tag));
    return true;
  };

  walk(parsed.body, new Set(), false);
  close(false);
  return blocks.length ? { content: { type: "doc", content: blocks }, open: !sawBlock } : null;
}
