import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import {
  collab,
  presence,
  presenceMessage,
  receivePresence,
  receiveTransaction,
  removePresence,
  sendableSteps,
} from "./collab.js";
import { createEditor, type Editor } from "./editor.js";
import { undoDepth } from "./history.js";

const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  content: { type: "doc", content: [p("Hello world")] },
};
const client = (clientID: number): Editor =>
  createEditor({ document: DOCUMENT, plugins: [collab({ clientID })] });

describe("presence (22.9)", () => {
  it("shows another client's selection, mapped through changes, never in the document or undo", () => {
    const a = client(1);
    const b = client(2);
    b.select(7, 12);
    a.dispatch(receivePresence(a.state, presenceMessage(b.state, { name: "Bob", color: "#c33" })));
    expect(presence(a.state)).toEqual([
      { clientID: 2, name: "Bob", color: "#c33", selection: { type: "text", anchor: 7, head: 12 } },
    ]);
    expect(undoDepth(a.state)).toBe(0);
    a.select(1);
    a.commands.insertText("Oh, ");
    expect(presence(a.state)[0]?.selection).toMatchObject({ anchor: 11, head: 16 });
    expect(a.getDocument().content).not.toEqual(DOCUMENT.content.content?.[0]);
    expect(JSON.stringify(a.getDocument())).not.toContain("Bob");
    a.dispatch(removePresence(a.state, 2));
    expect(presence(a.state)).toEqual([]);
  });

  it("sends the selection at the authority's version, and refuses what is not a presence", () => {
    const a = client(1);
    const b = client(2);
    b.select(1);
    b.commands.insertText("XY");
    b.select(5);
    // B's caret behind its unconfirmed "XY": at 3 in what the authority has.
    const message = presenceMessage(b.state, { name: "Bob", color: "#3c3" });
    expect(message.selection).toMatchObject({ anchor: 3, head: 3 });
    for (const bad of [
      null,
      { ...message, color: "red;background:url(x)" },
      { ...message, clientID: 1 },
      { ...message, name: 5 },
    ]) {
      a.dispatch(receivePresence(a.state, bad));
      expect(presence(a.state)).toEqual([]);
    }
    // One sent from a version not reached yet waits for it.
    a.dispatch(
      receivePresence(a.state, {
        ...message,
        version: 1,
        selection: { type: "text", anchor: 5, head: 5 },
      }),
    );
    expect(presence(a.state)).toEqual([]);
    const sent = sendableSteps(b.state);
    if (!sent) throw new Error("nothing sent");
    a.dispatch(
      receiveTransaction(
        a.state,
        sent.steps,
        sent.steps.map(() => 2),
      ),
    );
    expect(presence(a.state)[0]?.selection).toMatchObject({ anchor: 5, head: 5 });
  });
});
