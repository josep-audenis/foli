/**
 * Other people editing the document (22.9, ADR-0012): their selections marked through the CSS
 * Custom Highlight API, as find marks matches (nothing added to the pages, the document or its
 * undo), and a caret with their name drawn over the page in their colour. Nothing moves: no
 * blinking, no animation, so reduced motion has nothing to stop.
 * shortcut: the body only; a presence in a header, footer or note is not drawn there.
 */

/** One peer as the view draws it. */
export interface PeerDrawing {
  readonly name: string;
  /** `#rgb` or `#rrggbb` (checked by core when received). */
  readonly color: string;
  readonly ranges: readonly Range[];
  /** Where the caret is on the screen (viewport coordinates), or null when not drawn. */
  readonly caret: { left: number; top: number; height: number } | null;
}

interface HighlightWindow {
  CSS?: { highlights?: Map<string, Set<Range> & { priority: number }> };
  Highlight?: new () => Set<Range> & { priority: number };
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const STYLE_ATTR = "data-foli-peers";
/** A highlight's name for a colour: one per colour, shared by the document's views. */
const nameOf = (color: string) => `foli-peer-${color.slice(1).toLowerCase()}`;

/** @internal One view's peers: their marks and their carets. */
export class PeerMarks {
  private marked = new Map<string, Range[]>();
  private carets: HTMLElement[] = [];

  constructor(private readonly doc: Document) {}

  draw(peers: readonly PeerDrawing[]): void {
    this.clear();
    const win = this.doc.defaultView as unknown as HighlightWindow | null;
    const registry = win?.CSS?.highlights;
    for (const peer of peers) {
      if (!COLOR.test(peer.color)) continue;
      const name = nameOf(peer.color);
      if (registry && win?.Highlight && peer.ranges.length) {
        this.style(name, peer.color);
        let highlight = registry.get(name);
        if (!highlight) {
          highlight = new win.Highlight();
          highlight.priority = -1;
          registry.set(name, highlight);
        }
        for (const range of peer.ranges) highlight.add(range);
        this.marked.set(name, [...(this.marked.get(name) ?? []), ...peer.ranges]);
      }
      if (peer.caret) this.carets.push(this.caret(peer, peer.caret));
    }
  }

  clear(): void {
    const registry = (this.doc.defaultView as unknown as HighlightWindow | null)?.CSS?.highlights;
    for (const [name, ranges] of this.marked) {
      const highlight = registry?.get(name);
      for (const range of ranges) highlight?.delete(range);
    }
    this.marked.clear();
    for (const caret of this.carets) caret.remove();
    this.carets = [];
  }

  /** The rule that colours highlight `name`, added once per document. */
  private style(name: string, color: string): void {
    let element = this.doc.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
    if (!element) {
      element = this.doc.createElement("style");
      element.setAttribute(STYLE_ATTR, "");
      this.doc.head.append(element);
    }
    if (element.textContent?.includes(`(${name})`)) return;
    // The colour is checked: a hex colour, nothing else reaches the rule.
    const tint = color.length === 4 ? `${color}4` : `${color}40`;
    element.append(
      `::highlight(${name}){background-color:${tint}}` +
        `@media print{::highlight(${name}){background-color:transparent}}`,
    );
  }

  private caret(peer: PeerDrawing, at: NonNullable<PeerDrawing["caret"]>): HTMLElement {
    const caret = this.doc.createElement("div");
    caret.setAttribute("aria-hidden", "true");
    caret.setAttribute("data-foli-peer", "");
    Object.assign(caret.style, {
      position: "fixed",
      left: `${at.left}px`,
      top: `${at.top}px`,
      height: `${at.height}px`,
      width: "0",
      borderLeft: `2px solid ${peer.color}`,
      pointerEvents: "none",
      zIndex: "2147483646",
    });
    const label = this.doc.createElement("span");
    label.textContent = peer.name;
    Object.assign(label.style, {
      position: "absolute",
      left: "-2px",
      bottom: "100%",
      background: peer.color,
      color: readableOn(peer.color),
      font: "11px/1.4 system-ui, sans-serif",
      padding: "0 4px",
      borderRadius: "3px 3px 3px 0",
      whiteSpace: "nowrap",
    });
    caret.append(label);
    this.doc.body.append(caret);
    return caret;
  }
}

/** Black or white, whichever reads better on `color` (a checked hex colour). */
function readableOn(color: string): string {
  const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join("") : color.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  // WCAG relative luminance; white wins where its contrast is the higher.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000" : "#fff";
}
