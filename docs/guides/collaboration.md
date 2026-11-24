# Real-time collaboration

Several people edit one document at once: each sees the others' typing, carets and names within
a moment, and the document stays a lossless Word document. Foli ships the pieces that need the
document model; your app keeps the transport, authentication and storage
([ADR-0012](../decisions/ADR-0012-collaboration.md)).

| Piece             | Where                                                              | What it does                                                                      |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| The authority     | `@folijs/collab`, on your server                                   | Orders every step, validates it by applying it, gives what to broadcast and store |
| The client plugin | `collab`, `sendableSteps`, `receiveBroadcast` in `@folijs/core`    | Sends its steps, rebases them over the others', keeps undo to its own changes     |
| The protocol      | `createHub`, `connect` in `@folijs/collab`                         | The messages both sides send, and the client loop: catch-up, retries, presence    |
| Presence          | `presenceMessage`, `receivePresence`, `presence` in `@folijs/core` | Who else edits, in what colour and where; drawn by `EditorView`                   |
| The transport     | yours                                                              | WebSocket, WebRTC, a Yjs channel, a queue: JSON text                              |
| Who may edit      | yours (`authorize`)                                                | A read-only user's steps refused                                                  |
| Storage           | yours                                                              | The authority's `snapshot()` (and the original `.docx` package beside it)         |

[`examples/collab`](https://github.com/josep-audenis/foli/tree/main/examples/collab) is a
complete app: a Node WebSocket server and a page, on `createHub` and `connect`.

## A host in a browser

No server of yours: one person's browser holds the authority, and the others join it over
whatever carries text between browsers (WebRTC, a relay, a Yjs-backed channel used only as the
pipe). `createHub` answers each message; `connect` runs every editor, the host's own included,
connected in memory.

```ts
export interface Peer {
  send(text: string): void;
}
```

```ts
export function host(document: EditorDocument, name: string, limits?: AuthorityLimits) {
  const authority = createAuthority({ document, ...(limits ? { limits } : {}) });
  const hub = createHub(authority);
  const HOST = 1; // the others get 2, 3…: small integers keep their new ids apart
  const peers = new Map<ClientID, Peer>();
  const snapshot = authority.snapshot();
  const editor = createEditor({
    document: snapshot.document,
    author: name,
    plugins: [collab({ version: snapshot.version, clientID: HOST })],
  });
  // The host's messages arrive after the current dispatch, as a socket's would.
  const self: Peer = { send: (text) => queueMicrotask(() => session.receive(text)) };
  const deliver = (from: ClientID, out: Outgoing[]) => {
    for (const { to, message } of out) {
      const text = JSON.stringify(message);
      for (const [id, peer] of [[HOST, self] as const, ...peers])
        if (to === "everyone" || (to === "sender") === (id === from)) peer.send(text);
    }
  };
  const session = connect(editor, {
    send: (message) => deliver(HOST, hub.receive(message, HOST)),
    name,
    color: "#c2410c",
  });
  return {
    editor,
    authority,
    joined(clientID: ClientID, peer: Peer) {
      peers.set(clientID, peer);
      deliver(clientID, hub.join(clientID)); // its snapshot and who else is here
    },
    received: (clientID: ClientID, text: string) => deliver(clientID, hub.receive(text, clientID)),
    left(clientID: ClientID) {
      peers.delete(clientID);
      deliver(clientID, hub.leave(clientID));
    },
  };
}
```

Each person joining gives the host a `Peer` to answer them by and an id (2, 3…, unique while they
are connected); `received` takes their messages, `left` their leaving. On their side:

```ts
export function joinHost(
  send: (text: string) => void,
  name: string,
  color: string,
  show: (editor: Editor) => void,
) {
  let session: Session | null = null;
  const start = (snapshot: { version: number; document: FoliDocument; clientID: ClientID }) => {
    const editor = createEditor({
      document: snapshot.document,
      author: name,
      plugins: [collab({ version: snapshot.version, clientID: snapshot.clientID })],
    });
    show(editor);
    session = connect(editor, {
      send: (message) => send(JSON.stringify(message)),
      name,
      color,
      onSnapshot: start,
      onError: (reason) => console.warn(`Your changes were refused (${reason}).`),
    });
  };
  return {
    received(text: string) {
      const message = JSON.parse(text);
      if (!session && message.type === "snapshot") start(message);
      else session?.receive(message);
    },
    /** The connection is back after a drop: what was missed comes, what was not sent goes. */
    resumed: () => session?.resume(),
  };
}
```

`connect` sends one batch at a time, checks every broadcast against the editor's version
(`receiveBroadcast`), catches up after a gap or a `stale` refusal, sends presence and shows the
others'. A drop that outlasts the authority's log brings a new snapshot: `onSnapshot` makes the
editor again, and what it had not sent is lost. When the host leaves, the session ends: its
document is the one to keep (`authority.snapshot()`). This code runs in the guide's tests, over a
channel that reorders, repeats and drops messages
([`collab.test.ts`](https://github.com/josep-audenis/foli/blob/main/apps/site/src/guides/collab.test.ts)).

With a server, the same two calls: `createHub(authority)` where the authority lives, each
connection's messages to `hub.receive`, and `connect` in every page.

## By hand: the server

What `createHub` does, written out: for an app with a protocol of its own.

```ts
export function serve(
  stored: Snapshot & { log?: Broadcast },
  canEdit: (clientID: string | number) => boolean,
  save: (stored: Snapshot & { log: Broadcast }) => void,
  broadcast: (message: unknown) => void,
) {
  const authority = createAuthority({
    document: stored.document,
    version: stored.version,
    package: stored.package, // DocxImport.package, kept for export
    ...(stored.log ? { log: stored.log } : {}), // clients behind catch up after a restart
    authorize: (clientID) => canEdit(clientID),
  });

  return (connection: Connection, text: string) => {
    const message = JSON.parse(text);
    if (message.type === "steps") {
      // The client id is the connection's, never what the message claims.
      const result = authority.receive(message, connection.clientID);
      if (result.ok) {
        // The snapshot and the log (or only the log's new steps, appended, on a big document).
        save({ ...authority.snapshot(), log: authority.log });
        broadcast({ type: "steps", ...result.broadcast }); // to everyone, the sender too
      } else connection.reply({ type: "refused", ...result });
    } else if (message.type === "catchup") {
      const missed = authority.stepsSince(message.version);
      connection.reply(
        "snapshot" in missed ? { type: "init", ...missed } : { type: "steps", ...missed },
      );
    }
  };
}
```

Give each live connection of a document a small integer client id (1, 2, 3…): it also keeps the
ids of their new tracked changes, comments and notes apart. Keep one authority per document in
one process (a Durable Object, a single worker, a lock in your store). `receive` refuses a
message that is not JSON steps of the document's schema, a step that does not apply, a stale
version and a message over its `limits`, changing nothing.

## By hand: the client

```ts
export function join(snapshot: Snapshot, clientID: number, name: string, socket: Peer) {
  const editor = createEditor({
    document: snapshot.document,
    author: name,
    plugins: [collab({ version: snapshot.version, clientID })],
  });

  let inFlight = false;
  let stopped = false;
  function send() {
    const sendable = sendableSteps(editor.state);
    if (!sendable || inFlight || stopped) return;
    inFlight = true;
    const steps = sendable.steps.map((step) => step.toJSON());
    socket.send(JSON.stringify({ type: "steps", version: sendable.version, steps }));
  }
  editor.subscribe(send);
  const catchUp = () =>
    socket.send(JSON.stringify({ type: "catchup", version: getVersion(editor.state) }));

  function receive(message: Broadcast) {
    const result = receiveBroadcast(editor.state, message);
    if (result.status === "gap") return catchUp(); // one was lost or overtaken
    if (result.status === "applied") {
      editor.dispatch(result.transaction);
      if (message.clientIDs.includes(clientID)) inFlight = false;
    }
    send();
  }
  // Stale: what was missed comes first, then the steps go again, rebased. Any other reason
  // would come again with the same steps: stop sending and tell the user.
  function refused(reason: string) {
    inFlight = false;
    if (reason === "stale") catchUp();
    else stopped = true;
  }
  // The connection is back: what was missed first, then the steps again.
  function resumed() {
    inFlight = false;
    catchUp();
  }
  return { editor, receive, refused, resumed };
}
```

Received steps are not undoable: undo takes back only the user's own changes, mapped over everyone
else's. A client that loses its connection keeps editing; when it comes back it asks for the steps
since its version and sends its own, rebased. When the authority's log no longer has them, it gets
a snapshot and starts from it.

## Versions

A version is a count of steps: the authority's is the number it has accepted, an editor's
(`getVersion`) the number of the authority's steps it has applied. Three numbers, and which is
which:

| Number                         | Means                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| `sendableSteps(state).version` | The editor's version: the steps it sends start from it                   |
| `broadcast.version`            | The version **before** the broadcast's steps: an editor applies it there |
| `received.version` (`ok`)      | The authority's version **after** them: not for the clients              |

So a broadcast fits an editor when `broadcast.version === getVersion(editor.state)`; after it the
editor is at `broadcast.version + broadcast.steps.length`. The sender gets its own broadcast too:
that is how its steps are confirmed and its version moves. `receiveBroadcast(state, broadcast)`
checks it: it applies the part the editor lacks (`applied`, with the transaction to dispatch),
says `had` for one it has, and `gap` for one from later (ask for `stepsSince` the editor's
version). `receiveTransaction` checks only when given the broadcast's version as its fourth
argument, and throws when it does not fit.

## My edits stop

An editor whose version is off sends steps the authority refuses as `stale`. One that catches up on
`stale` recovers; one that also drops the refusal, or is ahead of the authority (only a snapshot
brings it back), stops for good. It looks like "the first character works, then nothing". What
causes it:

- **The sender skips its own broadcast** (sending to the others only). Its steps stay
  unconfirmed and its version stays behind.
- **A broadcast applied twice**, or out of order: a reconnect or a catch-up overlapping a
  broadcast already received. Compare `broadcast.version` with `getVersion` first.
- **`received.version` sent as the broadcast's version.** It is the version after the steps.
- **Refusals dropped.** On `stale`, ask for `stepsSince(getVersion(editor.state))`, apply it,
  then send again (the steps are rebased). When it gives `{ snapshot }` (the log no longer has the
  steps, or the editor is ahead: a broadcast applied twice), create the editor again from it. Any other reason comes back for the same steps: stop
  sending them and tell the user.
- **A new editor at version 0** for a document the authority has at another version: create it
  with `collab({ version: snapshot.version })`, the version of the snapshot it loads.

## Presence

```ts
export function presenceOf(editor: Editor, socket: Peer, name: string) {
  const sendPresence = () =>
    socket.send(
      JSON.stringify({
        type: "presence",
        ...presenceMessage(editor.state, { name, color: "#c2410c" }),
      }),
    );
  const received = (message: unknown) => editor.dispatch(receivePresence(editor.state, message));
  return { sendPresence, received };
}
```

Send it when the selection changes and after receiving steps. `EditorView` marks the others'
selections and draws their carets with their names; `presence(editor.state)` lists them for your
own UI. Nothing of it goes into the document or its undo.

## Tracked changes and export

The tracking switch is the document's (`settings.trackRevisions`): one person turning it on turns
it on for everyone, each change in its own author's name. Export from the authority's snapshot and
the package the document was imported from: `exportDocx(snapshot.document, snapshot.package)`.

## Limits

No CRDT and no long offline editing; one authority orders a document's steps; locked content
controls are enforced by each editor, not re-checked by the authority (check them in `authorize`
if a client may be hostile); presence is drawn in the body only. See
[limitations](../limitations.md#collaboration).
