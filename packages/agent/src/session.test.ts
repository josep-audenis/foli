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
});
