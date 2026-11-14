/**
 * The Word editing page (`/edit.html`, dev server only, 8.7a): a schema v3 document, imported
 * from a .docx or the sample below, edited in `EditorView` with `FoliToolbar` (8.7b) and saved
 * back as a .docx. The editing tests on schema v3 drive it (`e2e/word-editing.spec.ts`,
 * `e2e/word-format.spec.ts`).
 */
import { createEditor, type Editor, type FoliDocumentV3, parseDocumentV3 } from "@folijs/core";
import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import { FoliToolbar } from "@folijs/react";
import "@folijs/react/styles.css";
import { EditorView } from "@folijs/view";
import { createRoot } from "react-dom/client";

/** A short A4 document with Word's Normal and Heading 1 styles. */
export const SAMPLE: FoliDocumentV3 = {
  schemaVersion: 3,
  section: {
    pageSize: { width: 11906, height: 16838 },
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  },
  defaults: {
    paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" } },
    run: [
      { type: "font", attrs: { ascii: "Calibri", hAnsi: "Calibri" } },
      { type: "fontSize", attrs: { value: 22 } },
    ],
  },
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    {
      id: "Heading1",
      type: "paragraph",
      name: "heading 1",
      basedOn: "Normal",
      next: "Normal",
      paragraph: { keepNext: true, spacing: { before: 240, after: 0 }, outlineLevel: 0 },
      run: [
        { type: "bold" },
        { type: "fontSize", attrs: { value: 32 } },
        { type: "color", attrs: { value: "2F5496" } },
      ],
    },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { style: "Heading1" },
        content: [{ type: "text", text: "Editing a Word document" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Open a .docx above, or edit this one. " },
          { type: "text", text: "Bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: " work as in Word; Save writes the .docx back." },
        ],
      },
    ],
  },
};

const host = document.getElementById("editor") as HTMLElement;
let editor: Editor<FoliDocumentV3> = createEditor({ document: SAMPLE });
let view = new EditorView(host, editor);
const toolbar = createRoot(document.getElementById("toolbar") as HTMLElement);
/** The formatting toolbar for the current editor; a click puts the focus back in the document. */
const showToolbar = () =>
  toolbar.render(<FoliToolbar editor={editor} onClickCommand={() => view.focus()} />);
showToolbar();
/** The package the document came from: export writes what Foli does not edit back from it. */
let original: DocxPackage | undefined;

/** Shows a v3 document in a new editor (and view), with a fresh history. */
function load(document: FoliDocumentV3, from?: DocxPackage): void {
  view.destroy();
  editor = createEditor({ document: parseDocumentV3(document) });
  view = new EditorView(host, editor);
  original = from;
  showToolbar();
}

(document.getElementById("file") as HTMLInputElement).addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const imported = await importDocx(new Uint8Array(await file.arrayBuffer()));
    load(imported.document, imported.package);
  } catch (error) {
    alert(`Could not open ${file.name}: ${(error as Error).message}`);
  }
});

(document.getElementById("save") as HTMLButtonElement).addEventListener("click", async () => {
  const bytes = await exportDocx(editor.getDocument(), original);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "document.docx";
  a.click();
  // Revoked once the download has started (at once, Firefox and Safari may cancel it).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

declare global {
  interface Window {
    /** For the e2e tests: the editor, and loading a document into it. */
    foliEdit: {
      readonly editor: Editor<FoliDocumentV3>;
      load(document: FoliDocumentV3): void;
      sample: FoliDocumentV3;
      /** Whether the editor's document passes validation (throws the error if not). */
      validate(): true;
    };
  }
}

window.foliEdit = {
  get editor() {
    return editor;
  },
  load: (document) => load(document),
  sample: SAMPLE,
  validate: () => {
    parseDocumentV3(editor.getDocument());
    return true;
  },
};
