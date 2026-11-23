import { createAuthority, type Snapshot } from "@folijs/collab";
import {
  collab,
  createEditor,
  type Editor,
  getVersion,
  presenceMessage,
  receivePresence,
  receiveTransaction,
  Step,
  type StepJSON,
  sendableSteps,
} from "@folijs/core";

interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: (string | number)[];
}

/** What the server's transport gives it: one connection, its id, a way to answer. */
export interface Connection {
  clientID: number;
  reply(message: unknown): void;
}

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
