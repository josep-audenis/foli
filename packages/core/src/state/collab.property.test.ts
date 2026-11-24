import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { Step, type StepJSON } from "../transform/steps.js";
import { TransformError } from "../transform/transform.js";
import {
  createDocument,
  type FoliDocument,
  parseDocument,
  SCHEMA_VERSION,
} from "../v3/document.js";
import {
  collab,
  getVersion,
  receiveBroadcast,
  receiveTransaction,
  sendableSteps,
} from "./collab.js";
import { createEditor, type Editor } from "./editor.js";
import { insertNote } from "./notes.js";
import { remote } from "./state.js";
import { insertTable } from "./tablecommands.js";
import { keepTablesApart } from "./tables.js";
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
    const clientIDs = steps.map(() => clientID);
    // Word's rules the schema does not hold (two tables inserted at one place by two people):
    // restored by the hub, its steps sent with the client's (as `@folijs/collab` does).
    const fix = this.editor.state.tr.setMeta(remote, true);
    keepTablesApart(fix);
    if (fix.docChanged) {
      this.editor.dispatch(fix);
      for (const step of fix.steps) {
        const json = JSON.parse(JSON.stringify(step.toJSON())) as StepJSON;
        steps.push(json);
        clientIDs.push(0);
        this.log.push({ step: json, clientID: 0 });
      }
    }
    const message = { version, steps, clientIDs };
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

/** How many times each kind of edit changed a client's document, over all runs. */
const changed = new Map<string, number>();

function run(client: Client, o: Op, serial: number): void {
  const { editor } = client;
  const before = editor.state.doc;
  const stories = editor.getDocument().stories;
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
  if (editor.state.doc !== before || editor.getDocument().stories !== stories)
    changed.set(o.kind, (changed.get(o.kind) ?? 0) + 1);
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
  // A clock the run sets: each op 0 to 900 ms after the last (undo groups typing closer than
  // 500 ms), the same on every run of these ops.
  let now = Date.UTC(2026, 10, 23);
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const hub = new Hub();
    for (let id = 1; id <= count; id++) new Client(id, hub);
    ops.forEach((o, serial) => {
      now += Math.floor(o.b * 900);
      run(hub.clients[o.client % count] as Client, o, serial);
    });
    settle(hub);
    return hub;
  } finally {
    clock.mockRestore();
  }
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
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.array(op, { minLength: 10, maxLength: 40 }),
          (n, ops) => {
            const hub = simulate(n, ops);
            const expected = hub.editor.getDocument();
            for (const client of hub.clients) expect(client.editor.getDocument()).toEqual(expected);
            expect(() => parseDocument(structuredClone(expected))).not.toThrow();
            expect(hub.refused).toBe(0);
            logged.push(hub.log.length);
          },
        ),
        { numRuns: 1000 },
      );
      // The runs did collaborate: most made steps the hub ordered, with every kind of edit.
      expect(logged.filter((n) => n > 5).length).toBeGreaterThan(500);
      for (const kind of [
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
      ])
        expect(changed.get(kind) ?? 0, kind).toBeGreaterThan(50);
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

/**
 * A client over a channel that reorders, repeats and loses broadcasts, taking each as it comes
 * with `receiveBroadcast` and catching up from the hub's log on a gap or a refusal (24.2).
 */
class Lossy extends Client {
  /** What the editors found while the ops ran (not while settling): `overlap` is applied with a part already had. */
  static readonly seen = { applied: 0, had: 0, gap: 0, overlap: 0 };
  static counting = false;

  override send(): void {
    const sendable = sendableSteps(this.editor.state);
    if (!sendable) return;
    const json = sendable.steps.map((s) => JSON.parse(JSON.stringify(s.toJSON())) as StepJSON);
    if (!this.hub.receive(sendable.version, json, this.id)) this.catchUp();
  }

  override deliver(index: number): void {
    const [message] = this.inbox.splice(index % this.inbox.length, 1);
    if (message) this.take(message);
  }

  /** A broadcast delivered and kept, to come again. */
  repeat(index: number): void {
    const message = this.inbox[index % this.inbox.length];
    if (message) this.take(message);
  }

  drop(index: number): void {
    this.inbox.splice(index % this.inbox.length, 1);
  }

  take(message: Broadcast): void {
    const had = getVersion(this.editor.state) - message.version;
    const result = receiveBroadcast(this.editor.state, message);
    if (Lossy.counting) {
      Lossy.seen[result.status]++;
      if (result.status === "applied" && had > 0) Lossy.seen.overlap++;
    }
    if (result.status === "applied") this.editor.dispatch(result.transaction);
    else if (result.status === "gap") {
      // Lost or overtaken: what is missing comes from the log.
      this.catchUp();
    }
  }

  /**
   * The hub's `stepsSince`: everything from this editor's version, or from `back` steps before it
   * (a catch-up that overlaps what the editor has), to the log's end or `short` steps before it
   * (a reply cut short, ending inside another client's batch: the rest comes later).
   */
  catchUp(back = 0, short = 0): void {
    const version = Math.max(0, getVersion(this.editor.state) - back);
    const all = this.hub.log.slice(version);
    const missed = all.slice(0, Math.max(1, all.length - short));
    if (!missed.length) return;
    this.take({
      version,
      steps: missed.map((m) => m.step),
      clientIDs: missed.map((m) => m.clientID),
    });
  }
}

/** `ops` on `n` lossy clients, settled: every editor as the hub, nothing refused. */
function lossyRun(n: number, ops: readonly (Omit<Op, "kind"> & { kind: string })[]): void {
  let now = Date.UTC(2026, 10, 24);
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const hub = new Hub();
    const clients: Lossy[] = [];
    for (let id = 1; id <= n; id++) clients.push(new Lossy(id, hub));
    Lossy.counting = true;
    ops.forEach((o, serial) => {
      now += Math.floor(o.b * 900);
      const c = clients[o.client % n] as Lossy;
      const at = Math.floor(o.a * 1000);
      const kind: string = o.kind;
      if (kind === "repeat") c.repeat(at);
      else if (kind === "drop") c.drop(at);
      else if (kind === "catchup") c.catchUp(Math.floor(o.a * 4), Math.floor(o.b * 4));
      else run(c, o as Op, serial);
    });
    Lossy.counting = false;
    // Settled: what is left delivered, then each catches up and sends until quiet.
    for (let round = 0; round < 50; round++) {
      for (const c of clients) {
        // Newest first, each twice: overtaken and repeated to the end.
        while (c.inbox.length) {
          c.repeat(c.inbox.length - 1);
          c.deliver(c.inbox.length - 1);
        }
        c.catchUp();
        c.send();
      }
      if (clients.every((c) => !c.inbox.length && !sendableSteps(c.editor.state))) break;
    }
    const expected = hub.editor.getDocument();
    for (const c of clients) {
      expect(sendableSteps(c.editor.state)).toBeNull();
      expect(getVersion(c.editor.state)).toBe(hub.log.length);
      expect(c.editor.getDocument()).toEqual(expected);
    }
    expect(hub.refused).toBe(0);
  } finally {
    clock.mockRestore();
  }
}

describe("a bold mark left apart, fixed (limitations.md, Collaboration)", () => {
  // Found by 24.2's property run and shrunk: two clients bolding overlapping text, deletions and
  // an undo close together; client 2 ended with a bold mark the hub did not have. A mark step's
  // inverse built node by node read the marks of a node starting before the step outside it, so
  // taking the step back left its mark on that node's part.
  it("two clients end with the same document", () => {
    const ops = (
      [
        ["type", 0, 0.4744, 0.4744],
        ["type", 0, 0, 0],
        ["type", 1, 0, 0],
        ["send", 0, 0, 0],
        ["send", 0, 0, 0],
        ["type", 0, 0.5613, 0.5613],
        ["type", 0, 0, 0],
        ["type", 0, 0, 0],
        ["type", 0, 0.5547, 0.5547],
        ["type", 1, 0, 0],
        ["catchup", 1, 0, 0],
        ["type", 1, 0.195, 0.195],
        ["undo", 1, 0, 0],
        ["bold", 0, 0.5725, 0.587],
        ["type", 0, 0, 0],
        ["drop", 0, 0, 0],
        ["send", 0, 0, 0],
        ["type", 0, 0, 0],
        ["send", 0, 0, 0],
        ["bold", 1, 0.5848, 0.6526],
        ["type", 1, 0, 0],
        ["type", 1, 0, 0],
        ["send", 0, 0, 0],
        ["deliver", 1, 0.328, 0],
        ["type", 0, 0.5865, 0.5865],
        ["delete", 0, 0.0863, 0.546],
        ["type", 0, 0, 0],
        ["type", 0, 0, 0],
        ["type", 0, 0, 0],
        ["delete", 0, 0.7, 0.5],
      ] as const
    ).map(([kind, client, a, b]) => ({ kind, client, a, b }));
    lossyRun(2, ops);
  });
});

describe("receiveBroadcast over an unreliable channel (24.2, 300 runs)", () => {
  it(
    "broadcasts reordered, repeated and lost: every editor ends as the hub, none applied twice",
    () => {
      const lossy = fc.record({
        kind: fc.constantFrom(
          "type",
          "type",
          "delete",
          "bold",
          "undo",
          "send",
          "deliver",
          "deliver",
          "repeat",
          "drop",
          "catchup",
          "catchup",
        ),
        client: fc.nat(),
        a: fraction,
        b: fraction,
      });
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 4 }),
          fc.array(lossy, { minLength: 30, maxLength: 60 }),
          lossyRun,
        ),
        // A fixed seed: `pnpm check` gives the same runs every time.
        { numRuns: 300, seed: 24 },
      );
      // The channel did misbehave while the ops ran: duplicates, gaps and partial overlaps.
      expect(Lossy.seen.had).toBeGreaterThan(50);
      expect(Lossy.seen.gap).toBeGreaterThan(20);
      expect(Lossy.seen.overlap).toBeGreaterThan(50);
    },
    TIMEOUT,
  );
});
