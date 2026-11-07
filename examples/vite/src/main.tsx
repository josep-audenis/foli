import { createDocument, type FoliDocument, parseDocument } from "@foli/core";
import { type FoliChange, FoliEditor } from "@foli/react";
import "@foli/react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const KEY = "foli-example";

/** The saved document, or a new one. */
function load(): FoliDocument {
  const saved = localStorage.getItem(KEY);
  return saved ? parseDocument(JSON.parse(saved)) : createDocument();
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
