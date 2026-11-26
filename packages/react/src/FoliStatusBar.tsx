import {
  countWords,
  type Editor,
  type EditorState,
  setTrackChanges,
  trackState,
} from "@folijs/core";
import { useEffect, useId, useRef, useState } from "react";
import { useEditorOrContext, useEditorState } from "./editor.js";

/** Every string the status bar shows, in English; each is its own key in `messages`. */
export const statusBarMessages = [
  "Status bar",
  "Page {page} of {pages}",
  "{words} words",
  "{count} of {words} words",
  "Word count",
  "Statistics",
  "Pages",
  "Words",
  "Characters (no spaces)",
  "Characters (with spaces)",
  "Paragraphs",
  "Include footnotes and endnotes",
  "Close",
  "Track changes: on",
  "Track changes: off",
  "Zoom",
  "Zoom out",
  "Zoom in",
  "Fit page width",
  "Whole page",
] as const;

/** Translations of the status bar's strings, by their English text (`statusBarMessages`). */
export type StatusBarMessages = Partial<
  Readonly<Record<(typeof statusBarMessages)[number], string>>
>;

export interface FoliStatusBarProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** Which parts show (each true by default): the page, the word count, tracking, the zoom. */
  page?: boolean | undefined;
  words?: boolean | undefined;
  trackChanges?: boolean | undefined;
  /** The zoom the pages are drawn at (1 is 100%); with `onZoomChange`, the zoom controls show. */
  zoom?: number | undefined;
  onZoomChange?: ((zoom: number) => void) | undefined;
  /** The zoom that fits a page's width or the whole page (`FoliCanvasHandle.fitZoom`). */
  fitZoom?: ((kind: "width" | "page") => number) | undefined;
  messages?: StatusBarMessages | undefined;
  className?: string | undefined;
}

// Selectors at module scope: `useEditorState` keeps a value while its selector stays the same.
const headOf = (state: EditorState) => state.selection.head;
const trackingOf = (state: EditorState) => trackState(state)?.on ?? null;
/** The body's count: kept by document, so a selection moving does not count it again. */
const wordsOf = (state: EditorState) => countWords(state).words;
const selectedOf = (state: EditorState) =>
  state.selection.empty ? null : countWords(state, { selection: true }).words;

/** Word's zoom steps for the minus and plus buttons, in percent. */
const STEPS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400, 500];

/**
 * Word's status bar: the page the caret is on and how many there are, the word count (of the
 * selection too; a click opens Word's count), whether changes are tracked (a click switches),
 * and the zoom (minus, slider, plus, fit width, whole page). Pages come from the view of the
 * editor (`editor.storyView`): without one that part is empty.
 */
export function FoliStatusBar({
  editor: given,
  page = true,
  words = true,
  trackChanges = true,
  zoom = 1,
  onZoomChange,
  fitZoom,
  messages,
  className,
}: FoliStatusBarProps) {
  const editor = useEditorOrContext(given, "FoliStatusBar");
  const t = (message: (typeof statusBarMessages)[number], values?: Record<string, number>) => {
    const text = messages?.[message] ?? message;
    return values
      ? text.replace(/\{(\w+)\}/g, (all, name: string) => values[name]?.toLocaleString() ?? all)
      : text;
  };
  // Pages are laid out after a change: read again in the next frame.
  const [, setFrame] = useState(0);
  useEffect(() => {
    let frame = 0;
    const unsubscribe = editor.subscribe(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setFrame((n) => n + 1);
      });
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);
  const head = useEditorState(headOf, { editor });
  const tracking = useEditorState(trackingOf, { editor });
  const count = useEditorState(wordsOf, { editor });
  const selected = useEditorState(selectedOf, { editor });
  const layout = editor.storyView?.fieldLayout;
  const index = layout?.pageAt(head)?.index;
  const [dialog, setDialog] = useState(false);
  const wordsButton = useRef<HTMLButtonElement>(null);
  const percent = Math.round(zoom * 100);
  const step = (direction: 1 | -1) => {
    const next =
      direction > 0
        ? (STEPS.find((s) => s > percent) ?? 500)
        : ([...STEPS].reverse().find((s) => s < percent) ?? 10);
    onZoomChange?.(next / 100);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not a status bar.
    <div
      role="group"
      aria-label={t("Status bar")}
      className={className ? `foli-status-bar ${className}` : "foli-status-bar"}
    >
      {page && layout && index !== undefined && (
        <span className="foli-status-page">
          {t("Page {page} of {pages}", { page: index, pages: layout.pages })}
        </span>
      )}
      {words && (
        <button
          ref={wordsButton}
          type="button"
          className="foli-status-words"
          aria-haspopup="dialog"
          onClick={() => setDialog(true)}
        >
          {selected === null
            ? t("{words} words", { words: count })
            : t("{count} of {words} words", { count: selected, words: count })}
        </button>
      )}
      {trackChanges && tracking !== null && (
        <button
          type="button"
          className="foli-status-track"
          aria-pressed={tracking}
          onClick={() => editor.run(setTrackChanges(!tracking))}
        >
          {t(tracking ? "Track changes: on" : "Track changes: off")}
        </button>
      )}
      <span className="foli-status-spacer" />
      {onZoomChange && (
        <span className="foli-status-zoom">
          {fitZoom && (
            <>
              <button
                type="button"
                className="foli-status-fit-width"
                onClick={() => onZoomChange(fitZoom("width"))}
              >
                {t("Fit page width")}
              </button>
              <button
                type="button"
                className="foli-status-fit-page"
                onClick={() => onZoomChange(fitZoom("page"))}
              >
                {t("Whole page")}
              </button>
            </>
          )}
          <button
            type="button"
            className="foli-status-zoom-out"
            aria-label={t("Zoom out")}
            title={t("Zoom out")}
            onClick={() => step(-1)}
          >
            −
          </button>
          <input
            type="range"
            aria-label={t("Zoom")}
            min={10}
            max={500}
            step={1}
            value={percent}
            onChange={(event) => onZoomChange(Number(event.target.value) / 100)}
          />
          <button
            type="button"
            className="foli-status-zoom-in"
            aria-label={t("Zoom in")}
            title={t("Zoom in")}
            onClick={() => step(1)}
          >
            +
          </button>
          <span className="foli-status-percent">{percent}%</span>
        </span>
      )}
      {dialog && (
        <WordCountDialog
          editor={editor}
          t={t}
          onClose={() => {
            setDialog(false);
            // The focus goes back where the dialog came from.
            wordsButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * Word's Word Count dialog: pages, words, characters with and without spaces, paragraphs. A
 * popover, not modal: Escape (with the focus in it) or Close puts it away.
 */
function WordCountDialog({
  editor,
  t,
  onClose,
}: {
  editor: Editor;
  t: (message: (typeof statusBarMessages)[number]) => string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(false);
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const { state } = editor;
  const count = countWords(state, { notes, selection: !state.selection.empty });
  const pages = editor.storyView?.fieldLayout?.pages;
  const rows: [(typeof statusBarMessages)[number], number | undefined][] = [
    ["Pages", pages],
    ["Words", count.words],
    ["Characters (no spaces)", count.characters],
    ["Characters (with spaces)", count.charactersWithSpaces],
    ["Paragraphs", count.paragraphs],
  ];
  return (
    <div
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="foli-status-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <h2 id={`${id}-title`}>{t("Word count")}</h2>
      <table>
        <caption>{t("Statistics")}</caption>
        <tbody>
          {rows.map(([name, value]) =>
            value === undefined ? null : (
              <tr key={name}>
                <th scope="row">{t(name)}</th>
                <td>{value.toLocaleString()}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <label>
        <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />{" "}
        {t("Include footnotes and endnotes")}
      </label>
      <button ref={close} type="button" onClick={onClose}>
        {t("Close")}
      </button>
    </div>
  );
}
