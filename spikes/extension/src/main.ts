import { createEditor, type FoliDocument } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { EditorView } from "@folijs/view";
import { fromWord, toWord } from "./docx.js";
import { extensionPlugin, installViews } from "./extension.js";
import { mentionText } from "./spec.js";

installViews();
const host = document.getElementById("editor") as HTMLElement;
host.setAttribute("aria-label", "Document");
const editor = createEditor({ plugins: [extensionPlugin] });
new EditorView(host, editor);

/** What the e2e tests drive: save and load as JSON, and through `.docx`. */
const spike = {
  editor,
  save: (): FoliDocument => editor.getDocument(),
  load: (document: FoliDocument) => editor.setDocument(document),
  toDocx: async (): Promise<number[]> =>
    Array.from(await exportDocx(toWord(editor.getDocument(), (n) => mentionText(n.attrs ?? {})))),
  fromDocx: async (bytes: number[]): Promise<void> =>
    editor.setDocument(fromWord((await importDocx(new Uint8Array(bytes))).document)),
};
Object.assign(window, { __spike: spike });
export type Spike = typeof spike;
