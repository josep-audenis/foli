import {
  createDocument,
  createEditor,
  type EditorDocument,
  parseDocument,
  redo,
  undo,
} from "@folijs/core";
import { EditorView } from "@folijs/view";
import "./style.css";

const KEY = "foli-example";
function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} missing`);
  return element;
}

/** The saved document, or a new one (also when the saved one no longer parses). */
function load(): EditorDocument {
  try {
    // Storage may be blocked (private windows, site settings): then a new document.
    const saved = localStorage.getItem(KEY);
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved document:", error);
  }
  return createDocument();
}

const editor = createEditor({ document: load() });
const host = $<HTMLElement>("#editor");
host.classList.add("foli-content"); // the selection color above
host.setAttribute("aria-label", "Document"); // the view does not name its textbox
const view = new EditorView(host, editor, { placeholder: "Start writing…" });

// The buttons run commands on the editor; the view draws the result.
const commands: Record<string, () => boolean> = {
  bold: () => editor.commands.toggleMark("bold"),
  italic: () => editor.commands.toggleMark("italic"),
  bullets: () => editor.commands.toggleList("bulletList"),
  undo: () => editor.commands.undo(),
  redo: () => editor.commands.redo(),
};
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-command]")];
for (const button of buttons) {
  // Keep the document's focus and selection when the button is pressed.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    commands[button.dataset.command ?? ""]?.();
    view.focus();
  });
}
function update(): void {
  for (const button of buttons) {
    const name = button.dataset.command;
    if (name === "bold" || name === "italic")
      button.setAttribute("aria-pressed", String(editor.isMarkActive(name)));
    if (name === "undo") button.disabled = !editor.can(undo);
    if (name === "redo") button.disabled = !editor.can(redo);
  }
}
update();

// Save once typing pauses: getDocument() serializes the whole document.
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
function save(): void {
  if (dirty) localStorage.setItem(KEY, JSON.stringify(editor.getDocument()));
  dirty = false;
}
editor.subscribe((_state, transactions) => {
  update();
  if (!transactions.some((tr) => tr.docChanged)) return; // a selection change
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(save, 300);
});
addEventListener("pagehide", save);

// Save and load JSON by hand: the document as the app would store it.
const json = $<HTMLTextAreaElement>("#json");
const status = $<HTMLElement>("#status");
$<HTMLButtonElement>("#save").addEventListener("click", () => {
  json.value = JSON.stringify(editor.getDocument(), null, 2);
  status.textContent = "Saved.";
});
$<HTMLButtonElement>("#load").addEventListener("click", () => {
  try {
    // Validated (and an older format migrated): a bad document throws, the editor keeps its own.
    editor.setDocument(parseDocument(JSON.parse(json.value)));
    status.textContent = "Loaded.";
  } catch (error) {
    status.textContent = `Not loaded: ${error instanceof Error ? error.message : String(error)}`;
  }
});
