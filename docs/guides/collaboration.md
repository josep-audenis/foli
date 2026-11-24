# Real-time collaboration

Several people edit one document at once: each sees the others' typing, carets and names within
a moment, and the document stays a lossless Word document. Foli ships the pieces that need the
document model; your app keeps the transport, authentication and storage
([ADR-0012](../decisions/ADR-0012-collaboration.md)).

| Piece             | Where                                                              | What it does                                                                      |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| The authority     | `@folijs/collab`, on your server                                   | Orders every step, validates it by applying it, gives what to broadcast and store |
| The client plugin | `collab`, `sendableSteps`, `receiveTransaction` in `@folijs/core`  | Sends its steps, rebases them over the others', keeps undo to its own changes     |
| Presence          | `presenceMessage`, `receivePresence`, `presence` in `@folijs/core` | Who else edits, in what colour and where; drawn by `EditorView`                   |
| The transport     | yours                                                              | WebSocket, SSE, HTTP, a queue: JSON messages                                      |
| Who may edit      | yours (`authorize`)                                                | A read-only user's steps refused                                                  |
| Storage           | yours                                                              | The authority's `snapshot()` (and the original `.docx` package beside it)         |

[`examples/collab`](https://github.com/josep-audenis/foli/tree/main/examples/collab) is a
complete app: a Node WebSocket server and a page.

## The server

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

## The client

```ts
export function join(snapshot: Snapshot, clientID: number, name: string, socket: WebSocket) {
  const editor = createEditor({
    document: snapshot.document,
    author: name,
    plugins: [collab({ version: snapshot.version, clientID })],
  });

  let inFlight = false;
  function send() {
    const sendable = sendableSteps(editor.state);
    if (!sendable || inFlight || stopped) return;
    inFlight = true;
    const steps = sendable.steps.map((step) => step.toJSON());
    socket.send(JSON.stringify({ type: "steps", version: sendable.version, steps }));
  }
  editor.subscribe(send);

  // Broadcasts that arrived before the ones before them.
  const early = new Map<number, Broadcast>();
  function receive(message: Broadcast) {
    early.set(message.version, message);
    for (
      let next = early.get(getVersion(editor.state));
      next;
      next = early.get(getVersion(editor.state))
    ) {
      early.delete(next.version);
      const steps = next.steps.map((json) => Step.fromJSON(editor.state.schema, json));
      editor.dispatch(receiveTransaction(editor.state, steps, next.clientIDs));
      if (next.clientIDs.includes(clientID)) inFlight = false;
    }
    send();
  }
  // Stale: what was missed comes first, then the steps go again, rebased. Any other reason
  // would come again with the same steps: stop sending and tell the user.
  let stopped = false;
  function refused(reason: string) {
    inFlight = false;
    if (reason === "stale")
      socket.send(JSON.stringify({ type: "catchup", version: getVersion(editor.state) }));
    else stopped = true;
  }
  return { editor, receive, refused };
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
that is how its steps are confirmed and its version moves. `receiveTransaction` does not check
the version: apply a broadcast only when it fits, keep one from later until those before it
arrive, and drop one from before (the editor has it).

## My edits stop

An editor whose version is off sends steps the authority refuses as `stale`, every time. It looks
like "the first character works, then nothing". What causes it:

- **The sender skips its own broadcast** (sending to the others only). Its steps stay
  unconfirmed and its version stays behind.
- **A broadcast applied twice**, or out of order: a reconnect or a catch-up overlapping a
  broadcast already received. Compare `broadcast.version` with `getVersion` first.
- **`received.version` sent as the broadcast's version.** It is the version after the steps.
- **Refusals dropped.** On `stale`, ask for `stepsSince(getVersion(editor.state))`, apply it,
  then send again (the steps are rebased). Any other reason comes back for the same steps: stop
  sending them and tell the user.
- **A new editor at version 0** for a document the authority has at another version: create it
  with `collab({ version: snapshot.version })`, the version of the snapshot it loads.

## Presence

```ts
export function presenceOf(editor: Editor, socket: WebSocket, name: string) {
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
