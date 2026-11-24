import { describe, expect, it } from "vitest";
import type { StepJSON } from "../transform/steps.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import {
  type BroadcastJSON,
  collab,
  getVersion,
  receiveBroadcast,
  receiveTransaction,
  sendableSteps,
} from "./collab.js";
import { createEditor, type Editor } from "./editor.js";

const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
  },
};

const client = (clientID: number, version = 0): Editor =>
  createEditor({ document: DOCUMENT, plugins: [collab({ clientID, version })] });

/** What client `id` typed (`text` at 1), as the authority would broadcast it from `version`. */
function typed(id: number, text: string, version = 0): BroadcastJSON {
  const editor = client(id, version);
  editor.select(1);
  editor.commands.insertText(text);
  const steps = (sendableSteps(editor.state)?.steps ?? []).map(
    (s) => JSON.parse(JSON.stringify(s.toJSON())) as StepJSON,
  );
  return { version, steps, clientIDs: steps.map(() => id) };
}

/** Applies `broadcast` to `editor` when it says so; gives the status. */
function receive(editor: Editor, broadcast: BroadcastJSON): string {
  const result = receiveBroadcast(editor.state, broadcast);
  if (result.status === "applied") editor.dispatch(result.transaction);
  return result.status;
}

describe("receiveBroadcast (24.2)", () => {
  it("applies a broadcast at the editor's version and moves the version by its steps", () => {
    const editor = client(1);
    const b = typed(2, "x");
    expect(receive(editor, b)).toBe("applied");
    expect(getVersion(editor.state)).toBe(b.steps.length);
    expect(editor.state.doc.textContent).toBe("xab");
  });

  it("applies nothing twice: a duplicate is `had`", () => {
    const editor = client(1);
    const b = typed(2, "x");
    receive(editor, b);
    expect(receive(editor, b)).toBe("had");
    expect(editor.state.doc.textContent).toBe("xab");
  });

  it("applies only the part an overlapping broadcast adds", () => {
    const editor = client(1);
    const first = typed(2, "x");
    receive(editor, first);
    const second = typed(2, "y", first.steps.length);
    const both: BroadcastJSON = {
      version: 0,
      steps: [...first.steps, ...second.steps],
      clientIDs: [...first.clientIDs, ...second.clientIDs],
    };
    expect(receive(editor, both)).toBe("applied");
    expect(editor.state.doc.textContent).toBe("yxab");
    expect(getVersion(editor.state)).toBe(both.steps.length);
  });

  it("says a gap, with both versions, and changes nothing", () => {
    const editor = client(1);
    const later = typed(2, "x", 3);
    expect(receiveBroadcast(editor.state, later)).toEqual({ status: "gap", version: 0, from: 3 });
    expect(editor.state.doc.textContent).toBe("ab");
  });

  it("confirms the editor's own steps", () => {
    const editor = client(1);
    editor.select(3);
    editor.commands.insertText("!");
    const sendable = sendableSteps(editor.state);
    const steps = (sendable?.steps ?? []).map((s) => s.toJSON() as StepJSON);
    expect(receive(editor, { version: 0, steps, clientIDs: steps.map(() => 1) })).toBe("applied");
    expect(sendableSteps(editor.state)).toBeNull();
  });

  it("throws on what is not a broadcast", () => {
    const editor = client(1);
    const b = typed(2, "x");
    expect(() => receiveBroadcast(editor.state, { ...b, version: -1 })).toThrow(RangeError);
    expect(() => receiveBroadcast(editor.state, { ...b, version: 0.5 })).toThrow(RangeError);
    expect(() => receiveBroadcast(editor.state, { ...b, clientIDs: [] })).toThrow(RangeError);
    expect(() =>
      receiveBroadcast(editor.state, { version: 0, steps: [{ stepType: "nope" }], clientIDs: [2] }),
    ).toThrow();
  });
});

describe("receiveTransaction's version check (24.2)", () => {
  it("throws naming both versions when given one that is not the editor's", () => {
    const editor = client(1);
    expect(() => receiveTransaction(editor.state, [], [], 4)).toThrow(
      "receiveTransaction: steps from version 4, the editor is at 0",
    );
    expect(() => receiveTransaction(editor.state, [], [], 0)).not.toThrow();
    expect(() => receiveTransaction(editor.state, [], [])).not.toThrow();
  });
});
