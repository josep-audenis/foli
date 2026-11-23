/**
 * Two editors of one document side by side (`/collab.html`, dev server only, 22.11): each has the
 * `collab` plugin, an in-memory authority (`@folijs/collab`) orders their steps, and every message
 * waits a random time up to the delay chosen, so they arrive late and out of order. The same loop
 * an app runs over WebSocket (`examples/collab`).
 */
import { createAuthority } from "@folijs/collab";
import {
  collab,
  createDocument,
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
import { EditorView } from "@folijs/view";

const document0 = createDocument({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Type in both editors." }] }],
});
const authority = createAuthority({ document: document0 });
const delay = document.getElementById("delay") as HTMLInputElement;
const later = (f: () => void) => setTimeout(f, Math.random() * Number(delay.value));

interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: (string | number)[];
}

const clients: {
  editor: Editor;
  inbox: (message: Broadcast) => void;
  id: number;
  name: string;
  color: string;
}[] = [];

function client(id: number, name: string, color: string, host: HTMLElement): void {
  const editor = createEditor({
    document: document0,
    author: name,
    plugins: [collab({ clientID: id })],
  });
  new EditorView(host, editor);
  const early = new Map<number, Broadcast>();
  let inFlight = false;
  const send = () => {
    const sendable = sendableSteps(editor.state);
    if (!sendable || inFlight) return;
    inFlight = true;
    const message = {
      version: sendable.version,
      clientID: id,
      steps: sendable.steps.map((s) => s.toJSON()),
    };
    later(() => {
      const result = authority.receive(JSON.stringify(message));
      inFlight = false;
      if (result.ok) for (const c of clients) later(() => c.inbox(result.broadcast));
      // Stale: sent again once what was missed is in; any other reason would come again.
      else if (result.reason === "stale") later(send);
    });
  };
  const presence = () => {
    const message = presenceMessage(editor.state, { name, color });
    for (const c of clients)
      if (c.editor !== editor)
        later(() => c.editor.dispatch(receivePresence(c.editor.state, message)));
  };
  const inbox = (message: Broadcast) => {
    early.set(message.version, message);
    for (
      let next = early.get(getVersion(editor.state));
      next;
      next = early.get(getVersion(editor.state))
    ) {
      early.delete(next.version);
      const steps = next.steps.map((json) => Step.fromJSON(editor.state.schema, json));
      editor.dispatch(receiveTransaction(editor.state, steps, next.clientIDs));
    }
    send();
    presence();
  };
  let selection = editor.state.selection;
  editor.subscribe((state) => {
    send();
    if (!state.selection.eq(selection)) {
      selection = state.selection;
      presence();
    }
  });
  clients.push({ editor, inbox, id, name, color });
}

client(1, "Ann", "#c2410c", document.getElementById("ann") as HTMLElement);
client(2, "Bob", "#1d4ed8", document.getElementById("bob") as HTMLElement);
