import {
  acceptChange,
  addComment,
  type Command,
  deleteColumns,
  deleteRows,
  deleteTable,
  type Editor,
  type EditorState,
  insertColumn,
  insertRow,
  mergeCells,
  openLinkEditor,
  rejectChange,
  splitCell,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import { type KeyboardEvent, useEffect, useRef } from "react";

/** One entry of the right-click menu. */
export interface ContextMenuItem {
  /** Unique in the menu; also its class, `foli-context-<key>`. */
  readonly key: string;
  /** What it shows (and its name), in English: `messages` translates it. */
  readonly label: string;
  /** What a press does, on the body's editor. */
  readonly run: (editor: Editor) => void;
  /** Whether it can be used now (default: always). Runs when the menu opens. */
  readonly enabled?: ((state: EditorState) => boolean) | undefined;
  /** A line before it, as between Word's groups of entries. */
  readonly separator?: boolean | undefined;
}

/** Every string of the built-in entries, in English; each is its own key in `messages`. */
export const contextMenuMessages = [
  "Document menu",
  "Cut",
  "Copy",
  "Paste",
  "Link…",
  "New comment",
  "Insert row above",
  "Insert row below",
  "Insert column left",
  "Insert column right",
  "Delete rows",
  "Delete columns",
  "Delete table",
  "Merge cells",
  "Split cell",
  "Accept change",
  "Reject change",
] as const;

/** Translations of the menu's strings (`contextMenuMessages`, or an app's own labels). */
export type ContextMenuMessages = Partial<Readonly<Record<string, string>>>;

const inTable = (state: EditorState) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "tableCell") return true;
  return false;
};
const command = (run: Command) => (editor: Editor) => {
  editor.run(run);
};
/** The browser's own clipboard commands: the document has the focus and the selection. */
const clipboard = (name: "cut" | "copy") => () => {
  document.execCommand(name);
};
/**
 * Paste through the Clipboard API (the browser may ask first): what it holds is pasted as the
 * keyboard's paste is, by a paste event on the document.
 */
const paste = async () => {
  const target = document.activeElement;
  if (!target || !navigator.clipboard?.read) return;
  const data = new DataTransfer();
  for (const item of await navigator.clipboard.read())
    for (const type of item.types)
      if (type === "text/html" || type === "text/plain")
        data.setData(type, await (await item.getType(type)).text());
  target.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
};

/**
 * Word's right-click entries that Foli has: the clipboard, a link and a comment; in a table its
 * rows, columns and cells; on a tracked change Accept and Reject. Pass a function to
 * `FoliContextMenu`'s `items` to add, drop or reorder them.
 */
export const defaultContextMenuItems: readonly ContextMenuItem[] = [
  { key: "cut", label: "Cut", run: clipboard("cut"), enabled: (s) => !s.selection.empty },
  { key: "copy", label: "Copy", run: clipboard("copy"), enabled: (s) => !s.selection.empty },
  {
    key: "paste",
    label: "Paste",
    run: () => void paste().catch(() => undefined),
    enabled: () => typeof navigator !== "undefined" && !!navigator.clipboard?.read,
  },
  {
    key: "link",
    label: "Link…",
    run: command(openLinkEditor),
    enabled: (s) => openLinkEditor(s),
    separator: true,
  },
  {
    key: "newComment",
    label: "New comment",
    run: command(addComment("")),
    enabled: (s) => wordContext(s) !== null && addComment("")(s),
  },
  ...(
    [
      ["rowAbove", "Insert row above", insertRow(-1)],
      ["rowBelow", "Insert row below", insertRow(1)],
      ["columnLeft", "Insert column left", insertColumn(-1)],
      ["columnRight", "Insert column right", insertColumn(1)],
      ["deleteRows", "Delete rows", deleteRows],
      ["deleteColumns", "Delete columns", deleteColumns],
      ["deleteTable", "Delete table", deleteTable],
      ["mergeCells", "Merge cells", mergeCells],
      ["splitCell", "Split cell", splitCell],
    ] as const
  ).map(
    ([key, label, run], i): ContextMenuItem => ({
      key,
      label,
      run: command(run),
      enabled: (s) => inTable(s) && run(s),
      separator: i === 0,
    }),
  ),
  {
    key: "acceptChange",
    label: "Accept change",
    run: command(acceptChange),
    enabled: (s) => acceptChange(s),
    separator: true,
  },
  {
    key: "rejectChange",
    label: "Reject change",
    run: command(rejectChange),
    enabled: (s) => rejectChange(s),
  },
];

export interface FoliContextMenuProps {
  editor: Editor;
  /** Where it opens, in viewport px (the pointer, or the caret for the keyboard). */
  at: { x: number; y: number };
  /**
   * Its entries: the built-in ones (default), or a function of them. Only entries that apply
   * now are shown (a table's out of a table, Accept off a change).
   */
  items?:
    | readonly ContextMenuItem[]
    | ((defaults: readonly ContextMenuItem[]) => readonly ContextMenuItem[])
    | undefined;
  messages?: ContextMenuMessages | undefined;
  /** It closes: a pick (after it ran), Escape, Tab, or the focus leaving it. */
  onClose: () => void;
  /** Gives the document the focus back (before the clipboard entries run, and on Escape). */
  onFocusDocument?: (() => void) | undefined;
}

/**
 * Word's right-click menu for the document: a WAI-ARIA menu at the pointer (`.foli-menu`, as the
 * toolbar's), the arrow keys, Home and End to move, Enter to pick, Escape to close. Entries that
 * do not apply now are left out, Word's way.
 */
export function FoliContextMenu({
  editor,
  at,
  items = defaultContextMenuItems,
  messages,
  onClose,
  onFocusDocument,
}: FoliContextMenuProps) {
  const t = (label: string) => messages?.[label] ?? label;
  const all = typeof items === "function" ? items(defaultContextMenuItems) : items;
  const state = editor.state;
  const shown = useRef(all.filter((item) => item.enabled?.(state) ?? true)).current;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    buttons.current[0]?.focus();
    // Kept inside the window.
    const element = menu.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    if (box.right > window.innerWidth) element.style.left = `${Math.max(0, at.x - box.width)}px`;
    if (box.bottom > window.innerHeight) element.style.top = `${Math.max(0, at.y - box.height)}px`;
  }, [at]);
  const pick = (item: ContextMenuItem) => {
    onFocusDocument?.();
    item.run(editor);
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const count = shown.length;
    const here = buttons.current.indexOf(event.target as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: (here + 1) % count,
      ArrowUp: (here - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    event.stopPropagation();
    if (next !== undefined) {
      event.preventDefault();
      buttons.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onFocusDocument?.();
      onClose();
    } else if (event.key === "Tab") onClose();
  };
  if (!shown.length) return null;
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={t("Document menu")}
      className="foli-menu foli-context-menu"
      style={{ position: "fixed", left: at.x, top: at.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
      }}
    >
      {shown.map((item, i) => (
        <div key={item.key} role="none">
          {item.separator && i > 0 && <hr className="foli-menu-separator" />}
          <button
            ref={(element) => {
              buttons.current[i] = element;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`foli-menu-item foli-context-${item.key}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(item)}
          >
            {t(item.label)}
          </button>
        </div>
      ))}
    </div>
  );
}
