import {
  createDocument,
  type Editor,
  type FoliDocument,
  presence,
  sendableSteps,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { host, join, joinHost, serve } from "./collab.js";

// The guide's own code (24.4): a host in a browser and a person joining, and the by-hand server
// and client, each over a channel that reorders and repeats messages and drops the connection
// (everything in flight lost, then the client resumes), for many rounds of edits from both sides.

const DOCUMENT: FoliDocument = createDocument({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Edit this together." }] }],
});

/** A small seeded random source (mulberry32): the same rounds on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Messages in flight one way: taken in any order, sometimes twice. */
class Lane {
  readonly queue: string[] = [];
  constructor(readonly to: (text: string) => void) {}
  push = (text: string) => void this.queue.push(text);
  take(r: () => number): void {
    if (!this.queue.length) return;
    const at = Math.floor(r() * this.queue.length);
    const text = this.queue[at] as string;
    if (r() > 0.15) this.queue.splice(at, 1); // otherwise it comes again later
    this.to(text);
  }
  flushInOrder(): void {
    while (this.queue.length) this.to(this.queue.shift() as string);
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** An edit at a random place: typing mostly, sometimes a deletion. */
function edit(editor: Editor, r: () => number, label: string): void {
  const size = editor.state.doc.content.size;
  const at = (f: number) => {
    let pos = Math.max(1, Math.min(size - 1, Math.round(f * size)));
    while (pos > 1 && !editor.state.doc.resolve(pos).parent.inlineContent) pos--;
    return pos;
  };
  const a = at(r());
  if (r() < 0.8) {
    editor.select(a);
    editor.commands.insertText(label);
  } else {
    const b = at(r());
    if (a === b) return;
    editor.select(Math.min(a, b), Math.max(a, b));
    editor.commands.deleteSelection();
  }
}

async function settle(lanes: Lane[], editors: () => Editor[]): Promise<void> {
  for (let i = 0; i < 100; i++) {
    for (const lane of lanes) lane.flushInOrder();
    await flush();
    const quiet =
      lanes.every((lane) => !lane.queue.length) && editors().every((e) => !sendableSteps(e.state));
    if (quiet) return;
  }
  throw new Error("did not settle");
}

describe("a host in a browser and a person joining (24.4)", () => {
  for (const [seed, limits] of [
    [1, undefined],
    [2, undefined],
    [3, { log: 4 }], // a drop that outlasts the log: the joiner starts again from a snapshot
  ] as const)
    it(`seed ${seed}: both end with the host's document and see each other`, async () => {
      const r = random(seed);
      const h = host(DOCUMENT, "Host", limits);
      let joined: Editor | null = null;
      let starts = 0;
      const toHost = new Lane((text) => h.received(2, text));
      const j = joinHost(toHost.push, "Joiner", "#1d4ed8", (editor) => {
        joined = editor;
        starts++;
      });
      const toJoiner = new Lane((text) => j.received(text));
      h.joined(2, { send: toJoiner.push });
      toJoiner.flushInOrder(); // the snapshot first: an editor is made from it
      const lanes = [toHost, toJoiner];
      let drops = 0;
      for (let round = 0; round < 150; round++) {
        const roll = r();
        if (roll < 0.25) edit(h.editor, r, `h${round} `);
        else if (roll < 0.5 && joined) edit(joined, r, `j${round} `);
        else if (roll < 0.7) toHost.take(r);
        else if (roll < 0.9) toJoiner.take(r);
        else if (roll < 0.95) await flush();
        else {
          // The connection drops: what was in flight is lost; then it is back.
          toHost.queue.length = 0;
          toJoiner.queue.length = 0;
          drops++;
          j.resumed();
        }
      }
      await settle(lanes, () => [h.editor, joined as unknown as Editor]);
      const joiner = joined as unknown as Editor;
      const expected = h.authority.snapshot().document;
      expect(h.editor.getDocument()).toEqual(expected);
      expect(joiner.getDocument()).toEqual(expected);
      expect(expected.content).not.toEqual(DOCUMENT.content);
      expect(drops).toBeGreaterThan(0);
      // Past the log, the joiner started again from a snapshot; otherwise it never had to.
      expect(starts > 1).toBe(limits !== undefined);
      // Each shows the other (presence goes out after every received batch).
      edit(h.editor, r, "!");
      edit(joiner, r, "?");
      await settle(lanes, () => [h.editor, joiner]);
      expect(presence(h.editor.state).map((p) => p.name)).toEqual(["Joiner"]);
      expect(presence(joiner.state).map((p) => p.name)).toEqual(["Host"]);
    });
});

describe("the by-hand server and client (24.4)", () => {
  it("two clients over lossy connections end with the server's document", async () => {
    const r = random(7);
    let stored: { document: FoliDocument; version: number } = { document: DOCUMENT, version: 0 };
    const lanes: Lane[] = [];
    const down = new Map<number, Lane>();
    const handle = serve(
      { document: DOCUMENT, version: 0 },
      () => true,
      (s) => {
        stored = s;
      },
      (message) => {
        for (const lane of down.values()) lane.push(JSON.stringify(message));
      },
    );
    const clients = [1, 2].map((id) => {
      const up = new Lane((text) =>
        handle({ clientID: id, reply: (m) => down.get(id)?.push(JSON.stringify(m)) }, text),
      );
      const client = join({ document: DOCUMENT, version: 0 }, id, `Client ${id}`, {
        send: up.push,
      });
      const lane = new Lane((text) => {
        const message = JSON.parse(text);
        if (message.type === "steps") client.receive(message);
        else if (message.type === "refused") client.refused(message.reason);
      });
      down.set(id, lane);
      lanes.push(up, lane);
      return { id, client, up, lane };
    });
    for (let round = 0; round < 200; round++) {
      const c = clients[Math.floor(r() * 2)] as (typeof clients)[number];
      const roll = r();
      if (roll < 0.4) edit(c.client.editor, r, `c${c.id}.${round} `);
      else if (roll < 0.65) c.up.take(r);
      else if (roll < 0.95) c.lane.take(r);
      else {
        c.up.queue.length = 0;
        c.lane.queue.length = 0;
        c.client.resumed();
      }
    }
    await settle(lanes, () => clients.map((c) => c.client.editor));
    for (const { client } of clients) expect(client.editor.getDocument()).toEqual(stored.document);
    expect(stored.version).toBeGreaterThan(20);
  });
});
