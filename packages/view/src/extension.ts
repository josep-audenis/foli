/**
 * The view's side of extensions (ADR-0008, 12.4): node views draw custom nodes, mark views style
 * runs of custom marks, decorations put classes and attributes on drawn ranges, and plugin views
 * live as long as the `EditorView`. Core has no DOM: these hooks are on `ViewExtension`, which an
 * app gives to `createEditor` as an ordinary extension; the view reads them from
 * `editor.extensions`.
 *
 * Everything here is drawn with DOM calls, never parsed from HTML: attribute names are checked
 * (no `on*` handlers, no `contenteditable`, none of the view's own `data-foli-*`), and URL
 * attributes must be safe links (`isSafeHref`).
 */
import {
  type EditorState,
  type Extension,
  isSafeHref,
  type Mark,
  type Node as ModelNode,
} from "@folijs/core";
import type { EditorView } from "./view.js";

/**
 * Attributes put on a drawn element: `class` is added to its classes, `style` to its style, any
 * other name set (`aria-*`, `data-*`, `title`…).
 */
export interface DecorationAttrs {
  class?: string;
  style?: string;
  [name: string]: string | undefined;
}

/**
 * Attributes on a range of the document as drawn, never content: the text and inline leaves
 * from `from` to `to` (body positions of the state the decorations are for), or with `node` the
 * node at `from`: a block (its element on every page it is on) or an inline leaf. A table, row
 * or cell takes none.
 */
export interface Decoration {
  from: number;
  to: number;
  node?: boolean;
  attrs: DecorationAttrs;
}

/**
 * What a node view draws with: its document, and `h`, which makes elements safely. A node view may
 * build its DOM by other means: what `render` returns is used as it is, unchecked (extension code
 * is trusted, the node's attributes are not: never put them through HTML).
 */
export interface NodeViewDOM {
  readonly document: Document;
  /**
   * An element `tag` (from an allowlist of content elements: no `script`, `style`, `base`,
   * `form`, frames…) with attributes `attrs` (checked as decorations' are) and children, strings
   * as text nodes: data from the document never goes through HTML.
   */
  h(
    tag: string,
    attrs?: Readonly<Record<string, string>> | null,
    ...children: readonly (Node | string)[]
  ): HTMLElement;
}

/**
 * How a custom node is drawn. Inline: in its line, which wraps around it as the browser sizes it.
 * Block: on the pages, measured by the flow; one taller than the room left on a page splits
 * between its root element's children (each part drawn again by `render`, clipped), unless
 * `split` is false, which keeps it whole on one page.
 */
export interface NodeView {
  /**
   * Called whenever the node is drawn again: a changed node, or a block split differently. Its
   * DOM may change later (content loaded, a chart drawn): the view does not read it back.
   */
  render(node: ModelNode, dom: NodeViewDOM): Node;
  split?: boolean;
  /** Called with what `render` returned once the view no longer shows it (or is destroyed). */
  destroy?(dom: Node): void;
}

/** How a run of a custom mark is drawn: attributes on the run's element. */
export type MarkView = (mark: Mark) => DecorationAttrs;

/** What a view extension keeps beside an `EditorView`: told of each update, destroyed with it. */
export interface PluginView {
  /** After the view drew a new state; `previous` is the state before. */
  update?(view: EditorView, previous: EditorState): void;
  destroy?(): void;
}

/**
 * An extension with view hooks (ADR-0008), given to `createEditor({ extensions })` (and React's
 * `extensions` prop) like any extension.
 */
export interface ViewExtension extends Extension {
  /** By node type: one of the extension's (or another extension's) custom nodes. */
  nodeViews?: Readonly<Record<string, NodeView>>;
  /** By mark type. */
  markViews?: Readonly<Record<string, MarkView>>;
  /**
   * The decorations for a state, asked on every update: keep it cheap (plugin state is a good
   * place to keep them). Only blocks whose decorations changed are drawn again.
   */
  decorations?(state: EditorState): readonly Decoration[];
  /** Called when a view of the editor is made (a story open on its page has a view too). */
  view?(view: EditorView): PluginView;
}

/** The node and mark views of a view's extensions. @internal */
export interface Views {
  nodes: ReadonlyMap<string, NodeView>;
  marks: ReadonlyMap<string, MarkView>;
}

/** A node view's drawing, in its box, until the view drops it. @internal */
export interface Drawn {
  view: NodeView;
  root: Node;
  box: Element;
}

/** @internal */
export function viewsOf(extensions: readonly ViewExtension[]): Views {
  return {
    nodes: new Map(extensions.flatMap((e) => Object.entries(e.nodeViews ?? {}))),
    marks: new Map(extensions.flatMap((e) => Object.entries(e.markViews ?? {}))),
  };
}

const NAME = /^[a-z_][\w.:-]*$/i;
const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "background",
]);
/** Attributes holding several URLs: `srcset` (comma separated, each before its size), `ping`. */
const URL_LISTS: Record<string, (value: string) => string[]> = {
  srcset: (value) => value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? ""),
  ping: (value) => value.split(/\s+/).filter(Boolean),
};
/** Style that fetches or runs something (escapes could spell it otherwise). */
const UNSAFE_STYLE = /url\s*\(|image-set|expression|@import|-moz-binding|behavior|\\/i;
/** Content elements a node view may make with `h` (no scripts, styles, forms, frames, `base`). */
const TAGS = new Set(
  (
    "a abbr address article aside audio b bdi bdo blockquote br button canvas caption cite code " +
    "col colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 " +
    "header hgroup hr i img ins kbd label li mark meter ol p picture pre progress q rp rt ruby s " +
    "samp section small source span strong sub summary sup table tbody td tfoot th thead time tr " +
    "track u ul var video wbr"
  ).split(" "),
);

/** Throws on an attribute a view must not set: handlers, editing, the view's own, unsafe URLs. */
function check(name: string, value: string): void {
  const lower = name.toLowerCase();
  if (
    !NAME.test(name) ||
    lower.startsWith("on") ||
    lower === "contenteditable" ||
    lower === "srcdoc" ||
    lower.startsWith("data-foli-") ||
    (URL_ATTRS.has(lower) && !isSafeHref(value)) ||
    URL_LISTS[lower]?.(value).some((url) => !isSafeHref(url)) ||
    (lower === "style" && UNSAFE_STYLE.test(value)) ||
    (lower === "class" && /(^|\s)foli-/.test(value))
  )
    throw new TypeError(`Foli: attribute ${name} is not allowed on drawn content`);
}

/**
 * Throws when `attrs` holds one an extension must not set (`check`).
 * @internal
 */
export function checkAttrs(attrs: DecorationAttrs): void {
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) check(name, value);
}

/**
 * Puts `attrs` on `element` (classes and style added, the rest set).
 * @internal
 */
export function applyAttrs(element: HTMLElement, attrs: DecorationAttrs): void {
  checkAttrs(attrs);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (name === "class") element.classList.add(...value.split(/\s+/).filter(Boolean));
    else if (name === "style") {
      const style = element.getAttribute("style")?.trim() ?? "";
      element.setAttribute(
        "style",
        style && !style.endsWith(";") ? `${style};${value}` : style + value,
      );
    } else element.setAttribute(name, value);
  }
}

/**
 * Reports an extension's failure without stopping the editor.
 * @internal
 */
export function reportError(error: unknown): void {
  console.error("Foli: an extension failed", error);
}

/** The DOM API node views draw with. @internal */
export function nodeViewDOM(document: Document): NodeViewDOM {
  return {
    document,
    h(tag, attrs, ...children) {
      if (!TAGS.has(tag.toLowerCase()))
        throw new TypeError(`Foli: element ${tag} is not allowed in a node view`);
      const element = document.createElement(tag);
      if (attrs) applyAttrs(element, attrs);
      element.append(...children);
      return element;
    },
  };
}

/**
 * The decorations of each block (`units`: the blocks drawn, in document order, with the position
 * before each), relative to its content's start: a node decoration on the block itself is at -1.
 * @internal
 */
export function decorationsByBlock(
  units: readonly { pos: number; node: ModelNode }[],
  decorations: readonly Decoration[],
): (readonly Decoration[] | undefined)[] {
  const out: Decoration[][] = [];
  const add = (i: number, d: Decoration) => {
    const list = out[i] ?? [];
    out[i] = list;
    list.push(d);
  };
  for (const decoration of decorations) {
    const { from, to } = decoration;
    if (!(from <= to) || (!decoration.node && from === to)) continue;
    // The first block ending after `from` (blocks do not overlap: their ends are sorted too).
    let low = 0;
    let high = units.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const unit = units[mid] as { pos: number; node: ModelNode };
      if (unit.pos + unit.node.nodeSize <= from) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < units.length; i++) {
      const { pos, node } = units[i] as { pos: number; node: ModelNode };
      const start = pos + 1;
      if (decoration.node) {
        if (from >= pos && from < pos + node.nodeSize)
          add(i, { ...decoration, from: from - start, to: to - start });
        break;
      }
      if (pos >= to) break;
      const end = pos + node.nodeSize - 1;
      // A block leaf has no text to decorate.
      if (!node.isLeaf && from < end && to > start)
        add(i, { ...decoration, from: from - start, to: to - start });
    }
  }
  return out;
}
