/**
 * The client loop (24.3): an editor with the `collab` plugin kept in step with a hub, over any
 * transport. One batch of steps in flight at a time; broadcasts checked against the editor's
 * version (`receiveBroadcast`), a gap or a `stale` refusal caught up; presence sent and shown.
 */
import {
  type Editor,
  type FoliDocument,
  getVersion,
  presenceMessage,
  receiveBroadcast,
  receivePresence,
  removePresence,
  sendableSteps,
} from "@folijs/core";
import type { ClientMessage, HubMessage } from "./hub.js";
import type { ClientID, Refusal } from "./index.js";

export interface ConnectOptions {
  /** Sends a message to the hub (as JSON text, or the value: the transport's choice). */
  send(message: ClientMessage): void;
  /** Who this editor is to the others. `color`: `#rgb` or `#rrggbb`. */
  name: string;
  color: string;
  /**
   * The hub sent the whole document: this editor was too far behind for the log. Create the
   * editor again from it (`collab({ version })`) and connect that one; this one stops. Without
   * it, the connection stops and `onError` is told.
   */
  onSnapshot?(snapshot: { version: number; document: FoliDocument }): void;
  /** The hub refused this editor's steps for good (`invalid`, `unauthorized`…): they are not sent again. */
  onError?(reason: Refusal | "snapshot", message?: string): void;
}

export interface Connection {
  /** A message from the hub (its text, or the value it parses to). */
  receive(message: string | unknown): void;
  /** The transport is back after a drop: asks for what was missed, then sends again. */
  resume(): void;
  /** Stops: no more sending, nothing more received. */
  destroy(): void;
}

/**
 * Connects `editor` (made with `collab({ version, clientID })` from the hub's snapshot) to its
 * hub through `send` and `receive`: the app gives each message from the hub to `receive`.
 */
export function connect(editor: Editor, options: ConnectOptions): Connection {
  const who = { name: options.name, color: options.color };
  const clientID: ClientID = presenceMessage(editor.state, who).clientID;
  /** The version a batch was sent from, while it waits for its broadcast or refusal. */
  let inFlight: number | null = null;
  /** The version a catch-up was asked from, while it waits. */
  let asked: number | null = null;
  let stopped = false;

  const sendSteps = () => {
    if (stopped || inFlight !== null || asked !== null) return;
    const sendable = sendableSteps(editor.state);
    if (!sendable) return;
    inFlight = sendable.version;
    options.send({
      type: "steps",
      version: sendable.version,
      steps: sendable.steps.map((step) => step.toJSON()),
    });
  };
  const sendPresence = () => {
    if (!stopped) options.send({ type: "presence", ...presenceMessage(editor.state, who) });
  };
  const catchUp = () => {
    const version = getVersion(editor.state);
    if (asked === version) return;
    asked = version;
    options.send({ type: "catchup", version });
  };
  const stop = (reason: Refusal | "snapshot", message?: string) => {
    stopped = true;
    unsubscribe();
    options.onError?.(reason, message);
  };

  let selection = editor.state.selection;
  const unsubscribe = editor.subscribe((state) => {
    if (stopped) return;
    sendSteps();
    if (!state.selection.eq(selection)) {
      selection = state.selection;
      sendPresence();
    }
  });

  const receive = (raw: string | unknown) => {
    if (stopped) return;
    let message: unknown = raw;
    if (typeof raw === "string") {
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (typeof message !== "object" || message === null) return;
    const m = message as HubMessage;
    if (m.type === "steps") {
      let result: ReturnType<typeof receiveBroadcast>;
      try {
        result = receiveBroadcast(editor.state, m);
      } catch (error) {
        return stop("malformed", error instanceof Error ? error.message : undefined);
      }
      if (result.status === "gap") return catchUp();
      // A catch-up's answer is steps too: once some came, asking again is allowed.
      asked = null;
      if (result.status === "had") return sendSteps();
      editor.dispatch(result.transaction);
      // Its own steps confirmed: the next batch can go.
      if (m.clientIDs.some((id) => String(id) === String(clientID))) inFlight = null;
      sendSteps();
      sendPresence();
    } else if (m.type === "refused") {
      inFlight = null;
      if (m.reason === "stale") catchUp();
      else stop(m.reason, m.message);
    } else if (m.type === "snapshot") {
      // The editor was too far behind: what it had not sent is lost; the app starts again.
      const { version, document } = m;
      stopped = true;
      unsubscribe();
      if (options.onSnapshot) options.onSnapshot({ version, document });
      else options.onError?.("snapshot");
    } else if (m.type === "presence") editor.dispatch(receivePresence(editor.state, m));
    else if (m.type === "left") editor.dispatch(removePresence(editor.state, m.clientID));
  };

  sendSteps();
  sendPresence();
  return {
    receive,
    resume() {
      if (stopped) return;
      inFlight = null;
      asked = null;
      catchUp();
      sendPresence();
    },
    destroy() {
      stopped = true;
      unsubscribe();
    },
  };
}
