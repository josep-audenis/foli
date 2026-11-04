import { createDocument } from "@foli/core";
import { DocumentEditor } from "@foli/react";

const sample = createDocument({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Foli Playground" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Rendered by Foli's own view from its own document model. " },
        { type: "text", text: "Read-only", marks: [{ type: "bold" }] },
        { type: "text", text: " until the editing engine lands (" },
        { type: "text", text: "see docs/roadmap.md", marks: [{ type: "italic" }] },
        { type: "text", text: ")." },
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

export function App() {
  return (
    <main>
      <header className="playground-bar">
        <strong>Foli</strong>
        <span className="playground-hint">Engine under construction — read-only render</span>
      </header>
      <DocumentEditor initialContent={sample} />
    </main>
  );
}
