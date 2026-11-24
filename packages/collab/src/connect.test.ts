import {
  collab,
  createDocument,
  createEditor,
  type Editor,
  type FoliDocument,
  getVersion,
  type NodeJSON,
  presence,
  SCHEMA_VERSION,
  sendableSteps,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import {
  type Authority,
  type AuthorityOptions,
  type ClientMessage,
  type Connection,
  connect,
  createAuthority,
  createHub,
  type Hub,
  type HubMessage,
  type Outgoing,
} from "./index.js";

const p = (text: string): NodeJSON => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

const DOCUMENT: FoliDocument = {
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  content: { type: "doc", content: [p("Hello world")] },
};

interface Peer {
  id: number;
  editor: Editor;
  connection: Connection;
  /** Messages from the hub not delivered yet. */
  inbox: HubMessage[];
  /** Messages to the hub not delivered yet. */
  outbox: ClientMessage[];
  errors: string[];
  snapshots: number;
  /** Hears nothing from the hub (a dropped connection): what it would get is lost. */
  deaf?: boolean;
}

/** A hub and its peers over queues the test delivers by hand, as text (a transport would). */
class Net {
  readonly authority: Authority;
  readonly hub: Hub;
  readonly peers: Peer[] = [];

  constructor(options: Omit<AuthorityOptions, "document"> = {}) {
    this.authority = createAuthority({ document: DOCUMENT, ...options });
    this.hub = createHub(this.authority);
  }

  join(id: number, authorize = true): Peer {
    const [first] = this.hub.join(id);
    const snapshot = first?.message as HubMessage & { type: "snapshot" };
    const editor = createEditor({
      document: snapshot.document,
      plugins: [collab({ version: snapshot.version, clientID: id })],
    });
    const peer = { id, editor, inbox: [], outbox: [], errors: [], snapshots: 0 } as unknown as Peer;
    peer.connection = connect(editor, {
      send: (message) => authorize && peer.outbox.push(JSON.parse(JSON.stringify(message))),
      name: `Peer ${id}`,
      color: "#123456",
      onError: (reason) => peer.errors.push(reason),
      onSnapshot: () => peer.snapshots++,
    });
    this.peers.push(peer);
    return peer;
  }

  route(from: Peer, out: Outgoing[]): void {
    for (const { to, message } of out)
      for (const peer of this.peers)
        if (!peer.deaf && (to === "everyone" || (to === "sender") === (peer === from)))
          peer.inbox.push(message);
  }

  /** The hub takes `peer`'s next message. */
  up(peer: Peer): void {
    const message = peer.outbox.shift();
    if (message) this.route(peer, this.hub.receive(JSON.stringify(message), peer.id));
  }

  /** `peer` takes its next message from the hub. */
  down(peer: Peer): void {
    const message = peer.inbox.shift();
    if (message) peer.connection.receive(JSON.stringify(message));
  }

  settle(): void {
    for (let i = 0; i < 200; i++) {
      const busy = this.peers.filter((p) => p.inbox.length || p.outbox.length);
      if (!busy.length) return;
      for (const peer of busy) {
        this.up(peer);
        this.down(peer);
      }
    }
    throw new Error("did not settle");
  }
}

const type = (peer: Peer, at: number, text: string) => {
  peer.editor.select(at);
  peer.editor.commands.insertText(text);
};

const text = (peer: Peer) => peer.editor.state.doc.textContent;

describe("connect and createHub (24.3)", () => {
  it("two peers type at once and end with the authority's document", () => {
    const net = new Net();
    const a = net.join(1);
    const b = net.join(2);
    type(a, 1, "A");
    type(b, 12, "B");
    type(a, 2, "a");
    net.settle();
    expect(text(a)).toBe("AaHello worldB");
    expect(text(b)).toBe(text(a));
    expect(net.authority.snapshot().document).toEqual(a.editor.getDocument());
    for (const peer of [a, b]) {
      expect(sendableSteps(peer.editor.state)).toBeNull();
      expect(getVersion(peer.editor.state)).toBe(net.authority.version);
    }
  });

  it("sends one batch at a time", () => {
    const net = new Net();
    const a = net.join(1);
    a.outbox.length = 0; // its first presence
    type(a, 1, "x");
    type(a, 2, "y");
    expect(a.outbox.filter((m) => m.type === "steps")).toHaveLength(1);
    net.settle();
    expect(text(a)).toBe("xyHello world");
  });

  it("a stale batch catches up and goes again, rebased", () => {
    const net = new Net();
    const a = net.join(1);
    const b = net.join(2);
    type(a, 1, "A");
    type(b, 1, "B");
    while (a.outbox.length) net.up(a); // a's steps first: b's are stale
    while (b.outbox.length) net.up(b);
    expect(b.inbox.some((m) => m.type === "refused" && m.reason === "stale")).toBe(true);
    net.settle();
    expect(text(b)).toBe(text(a));
    expect(text(a)).toMatch(/^(AB|BA)Hello world$/);
    expect(b.errors).toEqual([]);
  });

  it("a duplicate is applied once; a broadcast after a lost one is a gap, caught up", () => {
    const net = new Net();
    const a = net.join(1);
    const b = net.join(2);
    type(a, 1, "1");
    net.settle();
    // The same broadcast again (a reconnect's catch-up overlapping it): nothing applied twice.
    const all = net.authority.stepsSince(0);
    if ("snapshot" in all) throw new Error("log");
    b.connection.receive({ type: "steps", ...all });
    expect(text(b)).toBe("1Hello world");
    // b misses one broadcast, then gets the next: a gap, caught up from the hub.
    b.deaf = true;
    type(a, 1, "2");
    net.settle();
    b.deaf = false;
    type(a, 1, "3");
    net.settle();
    expect(text(b)).toBe("321Hello world");
    expect(getVersion(b.editor.state)).toBe(net.authority.version);
  });

  it("resume after a drop: what was missed comes, what was not sent goes", () => {
    const net = new Net();
    const a = net.join(1);
    const b = net.join(2);
    net.settle();
    a.deaf = true; // the connection dropped: a's steps and the hub's broadcasts lost
    type(a, 1, "A");
    a.outbox.length = 0;
    type(b, 1, "B");
    net.settle();
    a.deaf = false;
    a.connection.resume();
    net.settle();
    expect(text(a)).toBe(text(b));
    expect(text(a)).toMatch(/^(AB|BA)Hello world$/);
  });

  it("refused for good: stops sending and says why", () => {
    const net = new Net({ authorize: (id) => id !== 2 });
    const b = net.join(2);
    type(b, 1, "x");
    net.settle();
    expect(b.errors).toEqual(["unauthorized"]);
    type(b, 1, "y");
    expect(b.outbox.filter((m) => m.type === "steps")).toHaveLength(0);
  });

  it("a snapshot when the log no longer reaches back: the app is told", () => {
    const net = new Net({ limits: { log: 1 } });
    const a = net.join(1);
    const b = net.join(2);
    net.settle();
    b.deaf = true;
    type(a, 1, "abc");
    net.settle();
    type(a, 4, "def");
    net.settle();
    b.deaf = false;
    b.connection.resume();
    net.settle();
    expect(b.snapshots).toBe(1);
    expect(b.errors).toEqual([]);
  });

  it("presence: sent on selection, shown by the others, kept for those who join, gone on leave", () => {
    const net = new Net();
    const a = net.join(1);
    a.editor.select(3);
    net.settle();
    const b = net.join(2);
    for (const { message } of net.hub.join(2).slice(1)) b.inbox.push(message);
    net.settle();
    expect(presence(b.editor.state).map((x) => [x.name, x.selection?.head])).toEqual([
      ["Peer 1", 3],
    ]);
    net.route(a, net.hub.leave(1));
    net.settle();
    expect(presence(b.editor.state)).toEqual([]);
  });

  it("the hub relays presence under the connection's id, not the one claimed", () => {
    const net = new Net();
    const a = net.join(1);
    const b = net.join(2);
    net.settle();
    const out = net.hub.receive(
      {
        type: "presence",
        clientID: 2,
        name: "Impostor",
        color: "#000",
        selection: null,
        version: 0,
      },
      1,
    );
    expect(out).toEqual([{ to: "others", message: expect.objectContaining({ clientID: 1 }) }]);
    void a;
    void b;
  });

  it("the hub refuses what is not a message, without throwing", () => {
    const net = new Net();
    for (const bad of [
      "{",
      "null",
      "[]",
      { type: "nope" },
      { type: "steps" },
      { type: "presence", x: "y".repeat(5000) },
    ])
      expect(net.hub.receive(bad, 1)[0]?.message.type).toBe("refused");
  });
});
