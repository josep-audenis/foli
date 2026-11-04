import { createDocument, type FoliDocument, parseDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";
import { useState } from "react";

const STORAGE_KEY = "foli-playground-document";

function loadSaved(): { doc: FoliDocument; error?: string } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { doc: sampleDocument() };
  try {
    return { doc: parseDocument(JSON.parse(raw)) };
  } catch (error) {
    // Back up the bad payload before autosave overwrites it, so it is never silently lost.
    localStorage.setItem(`${STORAGE_KEY}.invalid`, raw);
    return {
      doc: sampleDocument(),
      error: `${String(error)} (backed up to ${STORAGE_KEY}.invalid)`,
    };
  }
}

function sampleDocument(): FoliDocument {
  return createDocument({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Foli Playground" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Edit this text. Changes autosave to " },
          { type: "text", text: "localStorage", marks: [{ type: "code" }] },
          { type: "text", text: " and survive a reload." },
        ],
      },
    ],
  });
}

export function App() {
  const [{ doc, error }] = useState(loadSaved);
  const [version, setVersion] = useState(0);

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setVersion((v) => v + 1);
  };

  return (
    <main className="playground">
      <header className="playground-bar">
        <strong>Foli</strong>
        <span className="playground-hint">Walking skeleton — no toolbar or pagination yet</span>
        <button type="button" onClick={reset}>
          Reset to sample
        </button>
      </header>
      {error && <p role="alert">Saved document was invalid and was not loaded: {error}</p>}
      <DocumentEditor
        key={version}
        initialContent={version === 0 ? doc : sampleDocument()}
        onChange={(next) => localStorage.setItem(STORAGE_KEY, JSON.stringify(next))}
      />
    </main>
  );
}
