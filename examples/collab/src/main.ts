// The collab example's page (22.11, 24.4): an editor of the document the server's authority
// holds, over a WebSocket. What an app writes: the transport (connect, reconnect) and its UI;
// `connect` from @folijs/collab does the rest (steps one batch at a time, broadcasts checked
// against the editor's version, catching up, presence).
import { type Connection, connect } from "@folijs/collab";
import {
  collab,
  createEditor,
  type Editor,
  type FoliDocument,
  presence,
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

let socket: WebSocket | null = null;
let editor: Editor | null = null;
let view: EditorView | null = null;
let connection: Connection | null = null;
/** What the server gave this page to come back as itself (kept for the page's life). */
let token: string | null = null;
let online = true;

const send = (message: unknown) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

/** An editor of `snapshot`, connected: on the first one, and when the server sends another. */
function start(snapshot: { version: number; document: FoliDocument; clientID: string | number }) {
  // The whole document again (the server's log no longer reaches back): what this page had not
  // sent is lost, and it says so.
  if (editor && sendableSteps(editor.state))
    $<HTMLElement>("#who").textContent = "Your last changes could not be sent and were lost.";
  else $<HTMLElement>("#who").textContent = `You are ${name}.`;
  connection?.destroy();
  view?.destroy();
  editor = createEditor({
    document: snapshot.document,
    author: name,
    plugins: [collab({ version: snapshot.version, clientID: snapshot.clientID })],
  });
  const host = $<HTMLElement>("#editor");
  host.setAttribute("aria-label", "Document");
  view = new EditorView(host, editor);
  editor.subscribe(() => {
    showPeople();
    $<HTMLButtonElement>("#track").setAttribute("aria-pressed", String(editor?.trackingChanges));
  });
  connection = connect(editor, {
    send,
    name,
    color: COLORS[Number(snapshot.clientID) % COLORS.length] as string,
    onSnapshot: start,
    onError: (reason) => {
      $<HTMLElement>("#who").textContent = `The server refused your changes (${reason}).`;
    },
  });
  showPeople();
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

function open(): void {
  const own = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket = own;
  // Back with its token: the server knows it again, and `resume` asks for what it missed.
  own.addEventListener("open", () =>
    send(token !== null ? { type: "hello", token } : { type: "hello" }),
  );
  own.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "hello") {
      token = message.token;
      connection?.resume();
    } else if (message.type === "snapshot" && !connection) start(message);
    else connection?.receive(message);
  });
  own.addEventListener("close", () => {
    // An older socket closing late does not take the new one's place.
    if (socket !== own) return;
    socket = null;
    // Dropped, not disconnected by the button: tried again.
    if (online) setTimeout(open, 1000);
  });
}

$<HTMLButtonElement>("#connection").addEventListener("click", (event) => {
  online = !online;
  (event.currentTarget as HTMLButtonElement).textContent = online ? "Disconnect" : "Reconnect";
  if (online) open();
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

open();
