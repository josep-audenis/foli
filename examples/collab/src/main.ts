// The collab example's page (22.11): an editor of the document the server's authority holds,
// over a WebSocket. What an app writes: the transport (connect, reconnect, catch up), sending
// its steps one batch at a time, applying broadcasts in version order, presence.
import {
  collab,
  createEditor,
  type Editor,
  type FoliDocument,
  getVersion,
  presence,
  presenceMessage,
  receivePresence,
  receiveTransaction,
  removePresence,
  Step,
  type StepJSON,
  sendableSteps,
} from "@folijs/core";
import { exportDocx } from "@folijs/docx";
import { EditorView } from "@folijs/view";
import "./style.css";

function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} missing`);
  return element;
}

const COLORS = ["#c2410c", "#1d4ed8", "#15803d", "#7e22ce", "#be123c", "#0f766e"];
const params = new URL(location.href).searchParams;
const name = params.get("name") || "Guest";

interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: number[];
}

let socket: WebSocket | null = null;
let editor: Editor | null = null;
let view: EditorView | null = null;
let clientID: number | null = null;
/** What the server gave this page to come back as itself (kept for the page's life). */
let token: string | null = null;
/** Set when the server refused this page's steps for good: they are not sent again. */
let stopped = false;
let color = COLORS[0] as string;
/** A batch sent and not answered yet: one at a time, as the authority orders them. */
let inFlight = false;
/** Broadcasts from a version not reached yet (messages can overtake each other). */
const early = new Map<number, Broadcast>();
let online = true;

const send = (message: unknown) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

function sendSteps(): void {
  // Offline: kept until the connection is back (the reply to `hello` sends them).
  if (!editor || inFlight || stopped || socket?.readyState !== WebSocket.OPEN) return;
  const sendable = sendableSteps(editor.state);
  if (!sendable) return;
  inFlight = true;
  send({ type: "steps", version: sendable.version, steps: sendable.steps.map((s) => s.toJSON()) });
}

function sendPresence(): void {
  if (editor) send({ type: "presence", ...presenceMessage(editor.state, { name, color }) });
}

function receive(message: Broadcast): void {
  if (!editor) return;
  early.set(message.version, message);
  // From before what this page has (catch-ups that overlap): nothing to apply.
  for (const version of early.keys()) if (version < getVersion(editor.state)) early.delete(version);
  for (;;) {
    const next = early.get(getVersion(editor.state));
    if (!next) break;
    early.delete(next.version);
    const { schema } = editor.state;
    const steps = next.steps.map((json) => Step.fromJSON(schema, json));
    const ours = next.clientIDs.includes(clientID as number);
    editor.dispatch(receiveTransaction(editor.state, steps, next.clientIDs));
    if (ours) inFlight = false;
  }
  sendSteps();
  sendPresence();
}

function start(document: FoliDocument, version: number): void {
  view?.destroy();
  editor = createEditor({
    document,
    author: name,
    plugins: [collab({ version, clientID: clientID as number })],
  });
  const host = $<HTMLElement>("#editor");
  host.setAttribute("aria-label", "Document");
  view = new EditorView(host, editor);
  let selection = editor.state.selection;
  editor.subscribe((state) => {
    sendSteps();
    if (!state.selection.eq(selection)) {
      selection = state.selection;
      sendPresence();
    }
    showPeople();
    $<HTMLButtonElement>("#track").setAttribute("aria-pressed", String(editor?.trackingChanges));
  });
  showPeople();
  sendPresence();
}

function showPeople(): void {
  const list = $<HTMLUListElement>("#people");
  list.replaceChildren(
    ...(editor ? presence(editor.state) : []).map((peer) => {
      const item = document.createElement("li");
      item.textContent = peer.name;
      item.style.background = peer.color;
      return item;
    }),
  );
}

function connect(): void {
  const own = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket = own;
  own.addEventListener("open", () => {
    // Back with what it had: its token and version, so the server sends only what it missed.
    send(
      editor && token !== null
        ? { type: "hello", token, version: getVersion(editor.state) }
        : { type: "hello" },
    );
  });
  own.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "init") {
      // The whole document again (a new client, or the server's log no longer reaches back):
      // what this page had not sent is lost, and it says so.
      if (editor && sendableSteps(editor.state))
        $<HTMLElement>("#who").textContent = "Your last changes could not be sent and were lost.";
      clientID = message.clientID;
      if (message.token) token = message.token;
      color = COLORS[(clientID as number) % COLORS.length] as string;
      if (!editor) $<HTMLElement>("#who").textContent = `You are ${name}.`;
      inFlight = false;
      early.clear();
      start(message.snapshot.document, message.snapshot.version);
    } else if (message.type === "steps") receive(message);
    else if (message.type === "refused") {
      inFlight = false;
      // Stale: what was missed comes, then the steps go again, rebased. Any other reason would
      // come again with the same steps: they stop, and the page says so.
      if (message.reason === "stale") {
        if (editor) send({ type: "catchup", version: getVersion(editor.state) });
      } else {
        stopped = true;
        $<HTMLElement>("#who").textContent = `The server refused your changes (${message.reason}).`;
      }
    } else if (message.type === "presence" && editor)
      editor.dispatch(receivePresence(editor.state, message));
    else if (message.type === "leave" && editor)
      editor.dispatch(removePresence(editor.state, message.clientID));
  });
  own.addEventListener("close", () => {
    // An older socket closing late does not take the new one's place.
    if (socket !== own) return;
    socket = null;
    inFlight = false;
    // Dropped, not disconnected by the button: tried again.
    if (online) setTimeout(connect, 1000);
  });
}

$<HTMLButtonElement>("#connection").addEventListener("click", (event) => {
  online = !online;
  (event.currentTarget as HTMLButtonElement).textContent = online ? "Disconnect" : "Reconnect";
  if (online) connect();
  else socket?.close();
});
$<HTMLButtonElement>("#track").addEventListener("click", () => {
  editor?.commands.setTrackChanges(!editor.trackingChanges);
  view?.focus();
});
$<HTMLButtonElement>("#export").addEventListener("click", async () => {
  if (!editor) return;
  const bytes = await exportDocx(editor.getDocument());
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  link.download = "shared.docx";
  link.click();
  URL.revokeObjectURL(link.href);
});

connect();
