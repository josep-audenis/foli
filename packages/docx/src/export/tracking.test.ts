import { createDocument, createEditor, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "../index.js";

const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("the tracking switch in the document (22.3)", () => {
  it("is read from a .docx, written back when not told otherwise, and changed by the editor", async () => {
    const editor = createEditor({ document: createDocument({ type: "doc", content: [p("x")] }) });
    editor.commands.setTrackChanges(true);
    const on = await exportDocx(editor.getDocument());
    expect((await readPackage(on)).text("/word/settings.xml")).toContain("<w:trackRevisions/>");

    const imported = await importDocx(on);
    expect(imported.document.settings?.trackRevisions).toBe(true);
    expect(imported.document.schemaVersion).toBe(7);
    // Untouched: the package's settings come back byte for byte.
    const again = await exportDocx(imported.document, imported.package);
    expect((await readPackage(again)).text("/word/settings.xml")).toBe(
      (await readPackage(on)).text("/word/settings.xml"),
    );

    const reopened = createEditor({ document: imported.document });
    expect(reopened.trackingChanges).toBe(true);
    reopened.commands.setTrackChanges(false);
    const off = await exportDocx(reopened.getDocument(), imported.package);
    expect((await readPackage(off)).text("/word/settings.xml")).not.toContain("trackRevisions");
    // The option says otherwise: it wins.
    const forced = await exportDocx(reopened.getDocument(), imported.package, {
      trackRevisions: true,
    });
    expect((await readPackage(forced)).text("/word/settings.xml")).toContain("trackRevisions");
  });

  it("leaves a document that never said at schema 5, switched off or not", () => {
    const editor = createEditor({ document: createDocument({ type: "doc", content: [p("x")] }) });
    editor.commands.setTrackChanges(false);
    expect(editor.getDocument().schemaVersion).toBe(5);
    expect(editor.getDocument().settings?.trackRevisions).toBeUndefined();
  });
});
