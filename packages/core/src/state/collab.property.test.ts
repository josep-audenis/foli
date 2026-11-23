import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { Step, type StepJSON } from "../transform/steps.js";
import { TransformError } from "../transform/transform.js";
import {
  createDocument,
  type FoliDocument,
  parseDocument,
  SCHEMA_VERSION,
} from "../v3/document.js";
import { collab, getVersion, receiveTransaction, sendableSteps } from "./collab.js";
import { createEditor, type Editor } from "./editor.js";
import { insertNote } from "./notes.js";
import { remote } from "./state.js";
import { insertTable } from "./tablecommands.js";
import { setParagraphStyle } from "./wordformat.js";

const TIMEOUT = 600_000;

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  section: { headers: { default: "h1" } },
  content: { type: "doc", content: [p("Alpha beta gamma"), p("Delta epsilon"), p("Zeta")] },
  stories: { h1: { kind: "header", content: { type: "doc", content: [p("Head")] } } },
};

interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: number[];
}

/** An authority as small as the test needs: the order, the log, the check by applying. */
class Hub {
  readonly editor = createEditor({ document: DOCUMENT });
  readonly log: { step: StepJSON; clientID: number }[] = [];
  readonly clients: Client[] = [];
  refused = 0;

  receive(version: number, steps: StepJSON[], clientID: number): boolean {
    if (version !== this.log.length) return false;
    const before = this.editor.state;
    const tr = before.tr.setMeta(remote, true);
    for (const json of steps) tr.step(Step.fromJSON(before.schema, json));
    this.editor.dispatch(tr);
    if (this.editor.state === before) {
      this.refused++;
      return false;
    }
    for (const step of steps) this.log.push({ step, clientID });
    const message = { version, steps, clientIDs: steps.map(() => clientID) };
    for (const client of this.clients) client.inbox.push(message);
    return true;
  }
}

class Client {
  readonly editor: Editor;
  readonly inbox: Broadcast[] = [];
  private readonly early = new Map<number, Broadcast>();

  constructor(
    readonly id: number,
    readonly hub: Hub,
  ) {
    this.editor = createEditor({
      document: DOCUMENT,
      author: `Client ${id}`,
      plugins: [collab({ clientID: id })],
    });
    hub.clients.push(this);
  }

  send(): void {
    const sendable = sendableSteps(this.editor.state);
    if (!sendable) return;
    const json = sendable.steps.map((s) => JSON.parse(JSON.stringify(s.toJSON())) as StepJSON);
    this.hub.receive(sendable.version, json, this.id);
  }

  /** Takes message `index` of the inbox (out of order), applying what is next in version. */
  deliver(index: number): void {
    const [message] = this.inbox.splice(index % this.inbox.length, 1);
    if (!message) return;
    this.early.set(message.version, message);
    for (;;) {
      const next = this.early.get(getVersion(this.editor.state));
      if (!next) return;
      this.early.delete(next.version);
      const { schema } = this.editor.state;
      const steps = next.steps.map((json) => Step.fromJSON(schema, json));
      this.editor.dispatch(receiveTransaction(this.editor.state, steps, next.clientIDs));
    }
  }
}

const fraction = fc.noBias(fc.integer({ min: 0, max: 10_000 })).map((n) => n / 10_000);
const op = fc.record({
  kind: fc.constantFrom(
    "type",
    "type",
    "type",
    "delete",
    "bold",
    "list",
    "style",
    "table",
    "comment",
    "track",
    "header",
    "note",
    "undo",
    "send",
    "deliver",
    "deliver",
  ),
  client: fc.nat(),
  a: fraction,
  b: fraction,
});
type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

/** A text position near `f` of `editor`'s document. */
function near(editor: Editor, f: number): number {
  const size = editor.state.doc.content.size;
  let pos = Math.max(1, Math.min(size - 1, Math.round(f * size)));
  while (pos > 1 && !editor.state.doc.resolve(pos).parent.inlineContent) pos--;
  return pos;
}

/** `edit` on `editor`, an invalid selection or edit skipped. */
function attempt(edit: () => unknown): void {
  try {
    edit();
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TransformError)) throw error;
  }
}

function run(client: Client, o: Op, serial: number): void {
  const { editor } = client;
  const from = near(editor, Math.min(o.a, o.b));
  const to = near(editor, Math.max(o.a, o.b));
  attempt(() => {
    if (o.kind === "send") client.send();
    else if (o.kind === "deliver") client.deliver(Math.floor(o.a * 1000));
    else if (o.kind === "type") {
      editor.select(from);
      editor.commands.insertText(`c${client.id}.${serial} `);
    } else if (o.kind === "delete" && from < to) {
      editor.select(from, to);
      editor.commands.deleteSelection();
    } else if (o.kind === "bold" && from < to) {
      editor.select(from, to);
      editor.commands.toggleMark("bold");
    } else if (o.kind === "list") {
      editor.select(from);
      editor.commands.toggleList(o.b < 0.5 ? "bulletList" : "orderedList");
    } else if (o.kind === "style") {
      editor.select(from);
      editor.run(setParagraphStyle(o.b < 0.5 ? "Heading1" : "Heading2"));
    } else if (o.kind === "table") {
      editor.select(from);
      editor.run(insertTable(2, 2));
    } else if (o.kind === "comment" && from < to) {
      editor.select(from, to);
      editor.commands.addComment(`note ${client.id}`);
    } else if (o.kind === "track") editor.commands.setTrackChanges(!editor.trackingChanges);
    else if (o.kind === "header") {
      const head = editor.story("h1");
      if (!head) return;
      head.select(Math.max(1, Math.min(head.state.doc.content.size - 1, Math.round(o.a * 5))));
      head.commands.insertText(`h${client.id}`);
    } else if (o.kind === "note") {
      editor.select(from);
      editor.run(insertNote("footnote"));
    } else if (o.kind === "undo") editor.commands.undo();
  });
}

/** Everyone sends and receives until nothing is left. */
function settle(hub: Hub): void {
  for (let round = 0; round < 50; round++) {
    for (const client of hub.clients) {
      while (client.inbox.length) client.deliver(0);
      client.send();
    }
    const quiet = hub.clients.every((c) => !c.inbox.length && !sendableSteps(c.editor.state));
    if (quiet) return;
  }
  throw new Error("the clients did not settle");
}

function simulate(count: number, ops: readonly Op[]): Hub {
  const hub = new Hub();
  for (let id = 1; id <= count; id++) new Client(id, hub);
  ops.forEach((o, serial) => run(hub.clients[o.client % count] as Client, o, serial));
  settle(hub);
  return hub;
}

describe("undo in a shared document (22.7)", () => {
  it("undoes only the user's own changes, mapped over everyone else's", () => {
    const hub = new Hub();
    const a = new Client(1, hub);
    const b = new Client(2, hub);
    a.editor.select(1);
    a.editor.commands.insertText("Mine ");
    b.editor.select(6);
    b.editor.commands.insertText("THEIRS ");
    a.send();
    b.send();
    settle(hub);
    b.editor.select(1);
    b.editor.commands.insertText("More ");
    settle(hub);
    expect(a.editor.state.doc.firstChild?.textContent).toBe("More Mine AlphaTHEIRS  beta gamma");
    expect(a.editor.commands.undo()).toBe(true);
    settle(hub);
    for (const client of [a, b])
      expect(client.editor.state.doc.firstChild?.textContent).toBe("More AlphaTHEIRS  beta gamma");
    // Received steps are no one's to undo but their author's.
    expect(a.editor.commands.undo()).toBe(false);
    expect(b.editor.commands.undo()).toBe(true);
    settle(hub);
    expect(hub.editor.state.doc.firstChild?.textContent).toBe("AlphaTHEIRS  beta gamma");
  });
});

describe("collaboration converges (22.7, 1000 runs)", () => {
  it(
    "2–5 clients, random edits, messages delayed and reordered: identical valid documents",
    () => {
      const logged: number[] = [];
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 5 }), fc.array(op, { maxLength: 30 }), (n, ops) => {
          const hub = simulate(n, ops);
          const expected = hub.editor.getDocument();
          for (const client of hub.clients) expect(client.editor.getDocument()).toEqual(expected);
          expect(() => parseDocument(structuredClone(expected))).not.toThrow();
          expect(hub.refused).toBe(0);
          logged.push(hub.log.length);
        }),
        { numRuns: 1000 },
      );
      // The runs did collaborate: most made steps the hub ordered.
      expect(logged.filter((n) => n > 5).length).toBeGreaterThan(500);
    },
    TIMEOUT,
  );

  it(
    "loses no client's text: what each typed is in the document everyone ends with",
    () => {
      const typing = fc.record({
        kind: fc.constantFrom("type", "type", "header", "bold", "send", "deliver", "deliver"),
        client: fc.nat(),
        a: fraction,
        b: fraction,
      });
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.array(typing, { maxLength: 30 }),
          (n, ops) => {
            // Typed at paragraph ends only: no one types inside another's text.
            const atEnds = ops.map((o) => ({ ...o, a: o.a < 0.5 ? 0 : 1, b: o.a < 0.5 ? 0 : 1 }));
            const typed: string[] = [];
            const hub = simulate(n, atEnds);
            atEnds.forEach((o, serial) => {
              if (o.kind === "type") typed.push(`c${(o.client % n) + 1}.${serial} `);
            });
            const text = hub.editor.state.doc.textContent;
            for (const marker of typed) expect(text).toContain(marker);
          },
        ),
        { numRuns: 300 },
      );
    },
    TIMEOUT,
  );
});
