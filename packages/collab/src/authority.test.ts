import { readFileSync } from "node:fs";
import {
  collab,
  createDocument,
  createEditor,
  type Editor,
  type FoliDocument,
  getVersion,
  insertTable,
  type NodeJSON,
  parseDocument,
  receiveTransaction,
  SCHEMA_VERSION,
  Step,
  sendableSteps,
} from "@folijs/core";
import { exportDocx, importDocx, readPackage } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY,
  type Authority,
  type Broadcast,
  type CatchUp,
  createAuthority,
} from "./index.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  content: { type: "doc", content: [p("Hello world"), p("Second")] },
};

function client(document: FoliDocument, clientID: number, version = 0): Editor {
  return createEditor({
    document,
    author: `C${clientID}`,
    plugins: [collab({ clientID, version })],
  });
}

/** `editor`'s unconfirmed steps as the message a client sends. */
function message(editor: Editor) {
  const sendable = sendableSteps(editor.state);
  if (!sendable) throw new Error("nothing to send");
  return {
    version: sendable.version,
    clientID: sendable.clientID,
    steps: sendable.steps.map((s) => s.toJSON()),
  };
}

function apply(editor: Editor, broadcast: Broadcast): void {
  const { schema } = editor.state;
  const steps = broadcast.steps.map((json) => Step.fromJSON(schema, json));
  editor.dispatch(receiveTransaction(editor.state, steps, broadcast.clientIDs));
}

describe("the authority (22.8)", () => {
  it("orders steps, broadcasts them, and refuses a stale version until the client rebases", () => {
    const authority = createAuthority({ document: DOCUMENT });
    const a = client(DOCUMENT, 1);
    const b = client(DOCUMENT, 2);
    a.select(1);
    a.commands.insertText("A ");
    b.select(12);
    b.commands.insertText(" B");
    const first = authority.receive(JSON.stringify(message(a)));
    expect(first.ok).toBe(true);
    const stale = authority.receive(message(b));
    expect(stale).toMatchObject({ ok: false, reason: "stale", version: 1 });
    if (!first.ok) return;
    apply(a, first.broadcast);
    apply(b, first.broadcast);
    const second = authority.receive(message(b));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    apply(a, second.broadcast);
    apply(b, second.broadcast);
    const document = authority.snapshot().document;
    expect(a.getDocument()).toEqual(document);
    expect(b.getDocument()).toEqual(document);
    expect(document.content.content?.[0]).toEqual(p("A Hello world B"));
    expect(sendableSteps(a.state)).toBeNull();
  });

  it("refuses what it cannot take, changing nothing", () => {
    const authority = createAuthority({
      document: DOCUMENT,
      limits: { messageSize: 2000, steps: 3 },
      authorize: (clientID) => clientID !== "reader",
    });
    const before = authority.snapshot();
    const step = {
      stepType: "replace",
      from: 1,
      to: 1,
      slice: { content: [{ type: "text", text: "x" }], openStart: 0, openEnd: 0 },
    };
    const cases: [unknown, string][] = [
      ["{not json", "malformed"],
      [{ version: 0, clientID: 1, steps: [{ stepType: "nope" }] }, "malformed"],
      [{ version: 0, clientID: 1, steps: [] }, "malformed"],
      [{ version: -1, clientID: 1, steps: [step] }, "malformed"],
      [{ version: 0, steps: [step] }, "malformed"],
      [{ version: 5, clientID: 1, steps: [step] }, "stale"],
      [{ version: 0, clientID: 1, steps: [{ ...step, from: 900, to: 900 }] }, "invalid"],
      [{ version: 0, clientID: 1, steps: [step, step, step, step] }, "too-large"],
      [{ version: 0, clientID: 1, steps: [step], pad: "x".repeat(3000) }, "too-large"],
      [{ version: 0, clientID: "reader", steps: [step] }, "unauthorized"],
      [
        {
          version: 0,
          clientID: 1,
          steps: [
            {
              stepType: "envelope",
              key: "settings",
              path: ["evenAndOddHeaders"],
              before: true,
              after: false,
            },
          ],
        },
        "invalid",
      ],
    ];
    for (const [input, reason] of cases) {
      const result = authority.receive(input as never);
      expect(result, JSON.stringify(input).slice(0, 80)).toMatchObject({ ok: false, reason });
    }
    expect(authority.snapshot()).toEqual(before);
    expect(authority.version).toBe(0);
  });

  it("catches a client up from its version, or from a snapshot once the log is compacted", () => {
    const authority = createAuthority({ document: DOCUMENT, limits: { log: 4 } });
    const a = client(DOCUMENT, 1);
    const away = client(DOCUMENT, 2);
    const sent: Broadcast[] = [];
    for (const text of ["1", "2", "3"]) {
      a.select(1);
      a.commands.insertText(text);
      const result = authority.receive(message(a));
      if (!result.ok) throw new Error(result.reason);
      apply(a, result.broadcast);
      sent.push(result.broadcast);
    }
    const missed = authority.stepsSince(getVersion(away.state)) as Broadcast;
    expect(missed.steps).toHaveLength(3);
    apply(away, missed);
    expect(away.getDocument()).toEqual(authority.snapshot().document);

    for (const text of ["4", "5"]) {
      a.select(1);
      a.commands.insertText(text);
      const result = authority.receive(message(a));
      if (!result.ok) throw new Error(result.reason);
      apply(a, result.broadcast);
    }
    // The log keeps 4 steps: a client at 0 gets the document instead.
    const behind: CatchUp = authority.stepsSince(0);
    expect("snapshot" in behind).toBe(true);
    if (!("snapshot" in behind)) return;
    const fresh = client(behind.snapshot.document, 3, behind.snapshot.version);
    expect(fresh.getDocument()).toEqual(a.getDocument());
    expect(getVersion(fresh.state)).toBe(authority.version);
  });

  it("exports from its snapshot and package what one editor making the same edits exports", async () => {
    const bytes = readFileSync(new URL("../../../corpus/word/01-mutual-nda.docx", import.meta.url));
    const imported = await importDocx(bytes);
    const authority: Authority<typeof imported.package> = createAuthority({
      document: imported.document,
      package: imported.package,
    });
    const editors = [1, 2, 3].map((id) => client(imported.document, id));
    const single = createEditor({ document: imported.document, author: "C1" });
    const edits: ((e: Editor) => void)[] = [
      (e) => {
        e.select(1);
        e.commands.insertText("First. ");
      },
      (e) => {
        e.select(3, 8);
        e.commands.toggleMark("bold");
      },
      (e) => {
        e.select(20);
        e.commands.insertText(" third");
      },
    ];
    edits.forEach((edit, i) => {
      const editor = editors[i] as Editor;
      edit(editor);
      edit(single);
      const result = authority.receive(message(editor));
      if (!result.ok) throw new Error(result.reason);
      for (const e of editors) apply(e, result.broadcast);
    });
    const snapshot = authority.snapshot();
    expect(snapshot.document).toEqual(single.getDocument());
    const shared = await exportDocx(snapshot.document, snapshot.package);
    const alone = await exportDocx(single.getDocument(), imported.package);
    const [x, y] = [await readPackage(shared), await readPackage(alone)];
    expect(x.text("/word/document.xml")).toBe(y.text("/word/document.xml"));
    const original = await readPackage(bytes);
    for (const name of ["/word/styles.xml", "/word/numbering.xml", "/word/fontTable.xml"])
      if (original.part(name)) expect(x.text(name), name).toBe(original.text(name));
  });
});

describe("Word's rules the authority restores (22.8)", () => {
  it("puts a paragraph between two tables two people inserted at one place", () => {
    const authority = createAuthority({ document: DOCUMENT });
    const a = client(DOCUMENT, 1);
    const b = client(DOCUMENT, 2);
    for (const editor of [a, b]) {
      editor.select(1);
      editor.run(insertTable(2, 2));
    }
    const first = authority.receive(message(a));
    if (!first.ok) throw new Error(first.reason);
    for (const editor of [a, b]) apply(editor, first.broadcast);
    const second = authority.receive(message(b));
    if (!second.ok) throw new Error(second.reason);
    expect(second.broadcast.clientIDs).toContain(AUTHORITY);
    for (const editor of [a, b]) apply(editor, second.broadcast);
    const document = authority.snapshot().document;
    expect(() => parseDocument(structuredClone(document))).not.toThrow();
    expect(a.getDocument()).toEqual(document);
    expect(b.getDocument()).toEqual(document);
  });
});
