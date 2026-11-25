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
  onlyCommentSteps,
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

  it("gives `authorize` its document: a commenter comments and edits nothing (26.1)", () => {
    const authority = createAuthority({
      document: DOCUMENT,
      authorize: (clientID, steps, doc) =>
        clientID !== 3 || onlyCommentSteps(doc, steps, { author: "C3" }),
    });
    const commenter = client(DOCUMENT, 3);
    commenter.select(1, 6);
    commenter.commands.addComment("Why?");
    const commented = authority.receive(message(commenter));
    expect(commented.ok).toBe(true);
    if (!commented.ok) return;
    apply(commenter, commented.broadcast);
    expect(authority.snapshot().document.comments).toHaveLength(1);
    commenter.commands.insertText("x");
    const before = authority.snapshot();
    expect(authority.receive(message(commenter))).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(authority.snapshot()).toEqual(before);
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

describe("a hostile client (22.8 review)", () => {
  const text = (s: string) => ({
    stepType: "replace",
    from: 1,
    to: 1,
    slice: { content: [{ type: "text", text: s }], openStart: 0, openEnd: 0 },
  });

  it("cannot speak for another client or for the authority", () => {
    const authority = createAuthority({ document: DOCUMENT });
    const steps = [text("x")];
    expect(authority.receive({ version: 0, clientID: 2, steps }, 1)).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(authority.receive({ version: 0, clientID: AUTHORITY, steps })).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    const accepted = authority.receive({ version: 0, steps } as never, 1);
    expect(accepted.ok && accepted.broadcast.clientIDs).toEqual([1]);
  });

  it("refuses what it cannot measure or nest, and its log stays its document's", () => {
    const authority = createAuthority({ document: DOCUMENT, limits: { logSize: 2000 } });
    const cyclic: Record<string, unknown> = { version: 0, clientID: 1 };
    cyclic.steps = [cyclic];
    expect(authority.receive(cyclic as never)).toMatchObject({ ok: false, reason: "malformed" });
    // A table in a table's cell, deeper each message: refused before it is too deep to handle.
    let refused = 0;
    for (let i = 0; i < 40 && !refused; i++) {
      const cell = (inner: unknown): unknown => ({
        type: "table",
        content: [{ type: "tableRow", content: [{ type: "tableCell", content: [inner] }] }],
      });
      let node: unknown = { type: "paragraph" };
      for (let d = 0; d < 30; d++) node = cell(node);
      const step = {
        stepType: "replace",
        from: 0,
        to: 0,
        slice: { content: [node, { type: "paragraph" }], openStart: 0, openEnd: 0 },
      };
      const result = authority.receive({ version: authority.version, clientID: 1, steps: [step] });
      if (!result.ok) refused++;
    }
    expect(refused).toBe(1);
    expect(() => authority.snapshot()).not.toThrow();
    // Grown past `logSize`: the oldest steps gave way, the log ends at the version.
    const { log } = authority;
    expect(log.version + log.steps.length).toBe(authority.version);
    expect(JSON.stringify(log.steps).length).toBeLessThan(2000 + 4000);
  });

  it("starts again from a stored snapshot and log, catching clients up from it", () => {
    const first = createAuthority({ document: DOCUMENT });
    for (const s of ["a", "b", "c"]) {
      const result = first.receive({ version: first.version, clientID: 1, steps: [text(s)] });
      expect(result.ok).toBe(true);
    }
    const stored = first.snapshot();
    const again = createAuthority({
      document: stored.document,
      version: stored.version,
      log: first.log,
    });
    expect(again.stepsSince(1)).toEqual(first.stepsSince(1));
    expect(() => createAuthority({ document: DOCUMENT, version: -1 })).toThrow(RangeError);
  });
});

describe("authorship (22.10)", () => {
  it("each client's tracked changes and comments carry its user's name, received or not", async () => {
    const authority = createAuthority({ document: DOCUMENT });
    const ann = createEditor({
      document: DOCUMENT,
      author: "Ann",
      plugins: [collab({ clientID: 1 })],
    });
    const bob = createEditor({
      document: DOCUMENT,
      author: "Bob",
      plugins: [collab({ clientID: 2 })],
    });
    ann.commands.setTrackChanges(true);
    const on = authority.receive(message(ann));
    if (!on.ok) throw new Error(on.reason);
    apply(ann, on.broadcast);
    apply(bob, on.broadcast);
    // The switch is the document's: Bob tracks too, in his own name.
    expect(bob.trackingChanges).toBe(true);
    ann.select(1);
    ann.commands.insertText("Ann's ");
    ann.select(15, 20);
    ann.commands.addComment("Ann asks");
    bob.select(20);
    bob.commands.insertText(" Bob's");
    for (const editor of [ann, bob]) {
      // Each sends after receiving what the other sent first.
      for (const other of [ann, bob]) {
        const missed = authority.stepsSince(getVersion(other.state));
        if ("snapshot" in missed) throw new Error("compacted");
        if (missed.steps.length) apply(other, missed);
      }
      const result = authority.receive(message(editor));
      if (!result.ok) throw new Error(result.reason);
    }
    for (const editor of [ann, bob]) {
      const missed = authority.stepsSince(getVersion(editor.state));
      if (!("snapshot" in missed) && missed.steps.length) apply(editor, missed);
    }
    const document = authority.snapshot().document;
    expect(ann.getDocument()).toEqual(document);
    expect(bob.getDocument()).toEqual(document);
    const authors = (json: unknown): string[] =>
      [...JSON.stringify(json).matchAll(/"author":"(\w+)"/g)].map((m) => m[1] as string);
    expect(new Set(authors(document.content))).toEqual(new Set(["Ann", "Bob"]));
    expect(document.comments.map((c) => c.author)).toEqual(["Ann"]);
    const xml = (await readPackage(await exportDocx(document))).text("/word/document.xml");
    expect(xml).toContain('w:author="Ann"');
    expect(xml).toContain('w:author="Bob"');
  });
});
