import type { Editor, FoliDocument, Plugin, Transaction } from "@foli/core";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { FoliEditorProvider, useFoliEditor } from "./editor.js";
import { FoliCanvas, type FoliCanvasProps } from "./FoliCanvas.js";

/** A change to the document's content, as `FoliEditor` reports it. */
export interface FoliChange {
  readonly editor: Editor;
  /** The transactions of this change (several when plugins append their own). */
  readonly transactions: readonly Transaction[];
  /** The whole document, serialized on first read (keep it out of the hot path of typing). */
  readonly document: FoliDocument;
}

export interface FoliEditorProps extends Omit<FoliCanvasProps, "editor"> {
  /** Read once on mount. To load another document later: `editor.setDocument()` or a new `key`. */
  initialContent?: FoliDocument;
  /** Read once on mount. */
  plugins?: readonly Plugin[];
  /** Called after every change to the document's content (not for selection changes). */
  onChange?: (change: FoliChange) => void;
  /** Rendered above the pages, inside the editor's context (e.g. a toolbar). */
  children?: ReactNode;
}

/**
 * An editable document on real pages: creates its editor, provides it to `children` and shows
 * it. Uncontrolled: the editor owns the document; React observes it through `onChange`.
 */
export function FoliEditor({
  initialContent,
  plugins,
  onChange,
  children,
  ...canvas
}: FoliEditorProps) {
  const editor = useFoliEditor({ initialContent, plugins });
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useLayoutEffect(
    () =>
      editor.subscribe((_state, transactions) => {
        const listener = onChangeRef.current;
        if (!listener || !transactions.some((tr) => tr.docChanged)) return;
        let document: FoliDocument | undefined;
        listener({
          editor,
          transactions,
          get document() {
            document ??= editor.getDocument();
            return document;
          },
        });
      }),
    [editor],
  );

  return (
    <FoliEditorProvider editor={editor}>
      {children}
      <FoliCanvas editor={editor} {...canvas} />
    </FoliEditorProvider>
  );
}
