import { createEditor, type Editor, parseDocument } from "@folijs/core";
import { type DocxPackage, exportDocx, importDocx } from "@folijs/docx";
import { acme } from "./commands.js";

/** JSON: custom nodes and marks are ordinary node and mark JSON, by type name. */
export const save = (editor: Editor): string => JSON.stringify(editor.getDocument());

/** Validated against the Word schema and the extensions' types and attributes. */
export const load = (json: string): Editor =>
  createEditor({
    document: parseDocument(JSON.parse(json), { extensions: acme }),
    extensions: acme,
  });

/** .docx: each custom node and marked run becomes a content control tagged with its JSON. */
export const toDocx = (editor: Editor, original?: DocxPackage): Promise<Uint8Array> =>
  exportDocx(editor.getDocument(), original, { extensions: acme });

/** The tagged controls are read back as the same nodes and marks. */
export async function fromDocx(bytes: Uint8Array) {
  const { document, package: original } = await importDocx(bytes);
  return { editor: createEditor({ document, extensions: acme }), original };
}
