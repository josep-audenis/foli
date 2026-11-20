import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import {
  defaultToolbarItems,
  FoliEditor,
  type FoliEditorHandle,
  type ToolbarButton,
} from "@folijs/react";
import "@folijs/react/styles.css";
import { type ChangeEvent, StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { acme, insertMention, toggleTopic } from "./acme.js";
import "./style.css";

/** Toolbar items of the app's own, a group after the built-in ones. */
const mentionButton: ToolbarButton = {
  key: "acme-mention",
  label: "Mention Ada Lovelace",
  text: "@Ada",
  command: insertMention("u-42", "Ada Lovelace"),
};
const topicButton: ToolbarButton = {
  key: "acme-topic",
  label: "Topic: finance",
  text: "Finance",
  command: toggleTopic("finance"),
  pressed: (_state, editor) => editor.isMarkActive("acme:topic"),
};
const toolbar = [...defaultToolbarItems, [mentionButton, topicButton]];

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function App() {
  const ref = useRef<FoliEditorHandle>(null);
  // The package the open .docx came from: exporting again keeps what Foli does not model.
  const original = useRef<DocxPackage | undefined>(undefined);
  const [status, setStatus] = useState("");

  async function save(): Promise<void> {
    const editor = ref.current?.editor;
    if (!editor) return;
    try {
      // Each mention and topic run becomes a content control tagged with its JSON.
      const bytes = await exportDocx(editor.getDocument(), original.current, { extensions: acme });
      const url = URL.createObjectURL(new Blob([bytes], { type: DOCX }));
      Object.assign(document.createElement("a"), { href: url, download: "acme.docx" }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Saved acme.docx.");
    } catch (error) {
      setStatus(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function open(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    const editor = ref.current?.editor;
    if (!file || !editor) return;
    try {
      // The tagged controls are read back as the same nodes and marks.
      const imported = await importDocx(new Uint8Array(await file.arrayBuffer()));
      editor.setDocument(imported.document);
      original.current = imported.package;
      setStatus(`Opened ${file.name}.`);
    } catch (error) {
      setStatus(`Not opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <main>
      <h1>Foli with an extension</h1>
      <div className="files">
        <button type="button" onClick={save}>
          Save .docx
        </button>
        <label>
          Open .docx <input type="file" accept={`.docx,${DOCX}`} onChange={open} />
        </label>
        <span role="status">{status}</span>
      </div>
      <FoliEditor
        ref={ref}
        extensions={acme}
        toolbar={toolbar}
        placeholder="Type, then @Ada or Ctrl+Shift+M…"
      />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
