import { createDocument, type FoliDocument, parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";
import { useState } from "react";

const STORAGE_KEY = "foli-playground-document";

const sample = createDocument({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Foli Playground" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Edited by Foli's own view and engine. Try " },
        { type: "text", text: "Ctrl/Cmd+B", marks: [{ type: "bold" }] },
        { type: "text", text: ", " },
        { type: "text", text: "Ctrl/Cmd+I", marks: [{ type: "italic" }] },
        { type: "text", text: ", Enter, Backspace and undo. Changes are saved in this browser." },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Marks: " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: ", " },
        { type: "text", text: "italic", marks: [{ type: "italic" }] },
        { type: "text", text: ", " },
        { type: "text", text: "underline", marks: [{ type: "underline" }] },
        { type: "text", text: ", " },
        { type: "text", text: "strike", marks: [{ type: "strike" }] },
        { type: "hardBreak" },
        { type: "text", text: "after a hard break." },
      ],
    },
  ],
});

/** The saved document, or the sample if there is none or it no longer parses. */
function load(): FoliDocument {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved playground document:", error);
  }
  return sample;
}

let pending: FoliDocument | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  if (!pending) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch (error) {
    console.warn("Could not save the playground document:", error);
  }
  pending = null;
}

/** Saves once changes pause for 300 ms; leaving the page saves anything still pending. */
function save(document: FoliDocument): void {
  pending = document;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
addEventListener("pagehide", flush);

function reset(): void {
  pending = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was saved either.
  }
  location.reload();
}

export function App() {
  const [initial] = useState(load);
  const [readOnly, setReadOnly] = useState(false);
  return (
    <main>
      <header className="playground-bar">
        <strong>Foli</strong>
        <span
          className="playground-hint"
          title="Foli playground: typing, marks, undo, IME, paste, read-only mode, placeholder, pages"
        >
          Real pages: blocks flow onto A4 pages and paragraphs split across them; Ctrl/Cmd+Enter
          inserts a page break; prints one sheet per page. Typing, marks, undo, paste, read-only.
        </span>
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />{" "}
          Read-only
        </label>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </header>
      <DocumentEditor
        initialContent={initial}
        onChange={save}
        readOnly={readOnly}
        placeholder="Start writing…"
      />
    </main>
  );
}
