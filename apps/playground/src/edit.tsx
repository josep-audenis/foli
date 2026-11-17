/**
 * The Word editing page (`/edit.html`, dev server only, 8.7a): a schema v3 document, imported
 * from a .docx or the sample below, edited in `EditorView` with `FoliToolbar` (8.7b) and saved
 * back as a .docx. The editing tests on schema v3 drive it (`e2e/word-editing.spec.ts`,
 * `e2e/word-format.spec.ts`).
 */
import { createEditor, type Editor, type FoliDocument, parseDocument } from "@folijs/core";
import {
  type DocxPackage,
  exportDocx,
  importDocx,
  type PackageImages,
  packageImages,
} from "@folijs/docx";
import { FoliComments, FoliToolbar } from "@folijs/react";
import "@folijs/react/styles.css";
import { EditorView } from "@folijs/view";
import { createRoot } from "react-dom/client";

/** A short A4 document with Word's Normal and Heading 1 styles. */
export const SAMPLE: FoliDocument = {
  schemaVersion: 4,
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
/** Pasted and dropped images: kept in the document as data: URLs (the playground has no server). */
const upload = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
let editor: Editor = createEditor({ document: SAMPLE, author: "Foli user" });
let view = new EditorView(host, editor, { upload });
const toolbar = createRoot(document.getElementById("toolbar") as HTMLElement);
const commentsPane = createRoot(document.getElementById("comments") as HTMLElement);
/**
 * The formatting toolbar for the current editor (a click puts the focus back in the document)
 * and the comments pane.
 */
const showToolbar = () => {
  toolbar.render(
    <FoliToolbar editor={editor} comments upload={upload} onClickCommand={() => view.focus()} />,
  );
  commentsPane.render(<FoliComments editor={editor} />);
};
showToolbar();
/** The package the document came from: export writes what Foli does not edit back from it. */
let original: DocxPackage | undefined;
/** Object URLs for its pictures' images. */
let images: PackageImages | undefined;

/** Shows a v3 document in a new editor (and view), with a fresh history. */
function load(document: FoliDocument, from?: DocxPackage, trackChanges = false): void {
  view.destroy();
  images?.revoke();
  images = from ? packageImages(from) : undefined;
  editor = createEditor({ document: parseDocument(document), author: "Foli user", trackChanges });
  view = new EditorView(host, editor, { upload, ...(images ? { resource: images.url } : {}) });
  original = from;
  showToolbar();
}

(document.getElementById("file") as HTMLInputElement).addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const imported = await importDocx(new Uint8Array(await file.arrayBuffer()));
    load(imported.document, imported.package, imported.trackRevisions);
  } catch (error) {
    alert(`Could not open ${file.name}: ${(error as Error).message}`);
  }
});

(document.getElementById("save") as HTMLButtonElement).addEventListener("click", async () => {
  const bytes = await exportDocx(editor.getDocument(), original, {
    trackRevisions: editor.trackingChanges,
  });
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
      readonly editor: Editor;
      /** The view, for tests that map DOM points (`posFromDOM`). */
      readonly view: EditorView;
      load(document: FoliDocument): void;
      /** Opens a .docx (base64), as the file input does. */
      loadDocx(base64: string): Promise<void>;
      sample: FoliDocument;
      /** Whether the editor's document passes validation (throws the error if not). */
      validate(): true;
    };
  }
}

window.foliEdit = {
  get editor() {
    return editor;
  },
  get view() {
    return view;
  },
  load: (document) => load(document),
  loadDocx: async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const imported = await importDocx(bytes);
    load(imported.document, imported.package, imported.trackRevisions);
  },
  sample: SAMPLE,
  validate: () => {
    parseDocument(editor.getDocument());
    return true;
  },
};
