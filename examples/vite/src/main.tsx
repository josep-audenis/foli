import { createDocument, type FoliDocument, parseDocument } from "@folijs/core";
import { type FoliChange, FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const KEY = "foli-example";

/** The saved document, or a new one (also when the saved one no longer parses). */
function load(): FoliDocument {
  const saved = localStorage.getItem(KEY);
  try {
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved document:", error);
  }
  return createDocument();
}

// Save once typing pauses: `change.document` is serialized only when read.
let latest: FoliChange | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  if (latest) localStorage.setItem(KEY, JSON.stringify(latest.document));
  latest = undefined;
}
function onChange(change: FoliChange): void {
  latest = change;
  clearTimeout(timer);
  timer = setTimeout(save, 300);
}
addEventListener("pagehide", save);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <FoliEditor initialContent={load()} onChange={onChange} placeholder="Start writing…" />
  </StrictMode>,
);
