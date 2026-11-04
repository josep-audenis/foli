import { createDocument, type FoliDocument, parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";

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

function save(document: FoliDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch (error) {
    console.warn("Could not save the playground document:", error);
  }
}

function reset(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was saved either.
  }
  location.reload();
}

export function App() {
  return (
    <main>
      <header className="playground-bar">
        <strong>Foli</strong>
        <span className="playground-hint">
          Editor view in progress (Phase 4): typing, Enter, Backspace, marks, undo. No paste or IME
          yet.
        </span>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </header>
      <DocumentEditor initialContent={load()} onChange={save} />
    </main>
  );
}
