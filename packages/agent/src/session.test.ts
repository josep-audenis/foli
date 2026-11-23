import { readFileSync } from "node:fs";
import { insertText, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { openSession } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);

describe("openSession", () => {
  it("tracks edits in the author's name and gives the document back", async () => {
    const { document } = await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)));
    const session = openSession(document, { author: "Agent" });
    expect(session.editor.trackingChanges).toBe(true);
    const before = trackedChanges(session.editor.state.doc).length;

    session.editor.select(1);
    expect(session.editor.run(insertText("Draft. "))).toBe(true);

    const changes = trackedChanges(session.editor.state.doc);
    expect(changes.length).toBe(before + 1);
    expect(changes.some((c) => c.kind === "insertion" && c.author === "Agent")).toBe(true);
    expect(JSON.stringify(session.document().content)).toContain("Draft. ");
  });

  it("tracks a document whose own setting is off, leaving the setting as it is (22.3)", async () => {
    const { document } = await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)));
    const off = {
      ...document,
      schemaVersion: 7 as const,
      settings: { ...document.settings, trackRevisions: false },
    };
    const session = openSession(off, { author: "Agent" });
    expect(session.editor.trackingChanges).toBe(true);
    session.editor.select(1);
    session.editor.run(insertText("Draft. "));
    expect(trackedChanges(session.editor.state.doc).some((c) => c.author === "Agent")).toBe(true);
    expect(session.document().settings?.trackRevisions).toBe(false);
  });

  it("refuses an empty author", async () => {
    const { document } = await importDocx(readFileSync(new URL("01-mutual-nda.docx", CORPUS)));
    expect(() => openSession(document, { author: " " })).toThrow(/author/);
  });
});
