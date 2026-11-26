/**
 * Word's Show/Hide ¶ (29.5): paragraph marks, spaces, tabs and breaks drawn over the text, in a
 * layer of their own outside the document (`aria-hidden`, no pointer events), so copying,
 * finding, exporting and screen readers meet the text as it is. Drawn for the pages near the
 * screen, again after each change, scroll or resize.
 * shortcut: the body only; a header, footer or note open on its page shows none.
 */

/** @internal One mark, where it goes on the screen (viewport coordinates). */
export interface MarkGlyph {
  readonly text: string;
  /** Where the glyph is centred across (`center`) or starts (`start`), and its line's box. */
  readonly x: number;
  readonly top: number;
  readonly height: number;
  readonly align: "center" | "start";
}

const LAYER_CLASS = "foli-formatting-marks";

/** @internal The marks of one view. */
export class FormattingMarks {
  private layer: HTMLElement | null = null;

  constructor(private readonly doc: Document) {}

  /** Draws `glyphs`, shown only where `clip` (the editor's box on the screen) is. */
  draw(glyphs: readonly MarkGlyph[], clip: DOMRect): void {
    const layer = this.layer ?? this.create();
    const win = this.doc.defaultView;
    const width = win?.innerWidth ?? 0;
    const height = win?.innerHeight ?? 0;
    layer.style.clipPath = `inset(${Math.max(0, clip.top)}px ${Math.max(0, width - clip.right)}px ${Math.max(0, height - clip.bottom)}px ${Math.max(0, clip.left)}px)`;
    const spans = glyphs.map((glyph) => {
      const span = this.doc.createElement("span");
      span.textContent = glyph.text;
      const size = Math.max(6, glyph.height * 0.7);
      Object.assign(span.style, {
        position: "absolute",
        left: `${glyph.x}px`,
        top: `${glyph.top}px`,
        height: `${glyph.height}px`,
        lineHeight: `${glyph.height}px`,
        fontSize: `${size}px`,
        transform: glyph.align === "center" ? "translateX(-50%)" : "",
      });
      return span;
    });
    layer.replaceChildren(...spans);
  }

  clear(): void {
    this.layer?.remove();
    this.layer = null;
  }

  private create(): HTMLElement {
    const layer = this.doc.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "1",
      color: "var(--foli-formatting-marks, #4a6fa5)",
      fontFamily: "Arial, sans-serif",
      whiteSpace: "pre",
    });
    this.doc.body.append(layer);
    this.layer = layer;
    return layer;
  }
}

/** The glyph for each character a mark is drawn for. */
export const MARK_TEXT: Readonly<Record<string, string>> = {
  " ": "·",
  " ": "°",
  "\t": "→",
};
