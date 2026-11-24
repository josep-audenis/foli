import {
  type AuthorityLimits,
  type Broadcast,
  type ClientID,
  connect,
  createAuthority,
  createHub,
  type Outgoing,
  type Connection as Session,
  type Snapshot,
} from "@folijs/collab";
import {
  collab,
  createEditor,
  type Editor,
  type EditorDocument,
  type FoliDocument,
  getVersion,
  presenceMessage,
  receiveBroadcast,
  receivePresence,
  sendableSteps,
} from "@folijs/core";

/** How to reach one client (a WebSocket, a WebRTC channel, a Yjs-backed channel…): text out. */
export interface Peer {
  send(text: string): void;
}

/**
 * One person hosts the document in their browser: the authority, the hub that speaks for it,
 * and their own editor, connected to the hub in memory. Everyone else joins over `Peer`s.
 */
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

/**
 * Joining a hosted document: the host's first message is the snapshot; the editor is made from it
 * (again when the host sends another: this one was too far behind). `show` puts it on screen.
 */
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
