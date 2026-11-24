/**
 * The messages between an authority and its clients, and the hub that answers them (24.3): what
 * an app would otherwise design itself. Transport-neutral: every message is JSON, carried as text
 * by whatever the app has (a WebSocket, a Yjs channel, WebRTC, BroadcastChannel, a queue).
 */
import type { FoliDocument, StepJSON } from "@folijs/core";
import type { Authority, Broadcast, ClientID, Refusal } from "./index.js";

/** What a client sends. */
export type ClientMessage =
  /** Its steps since `version` (`sendableSteps`). */
  | { type: "steps"; version: number; steps: StepJSON[] }
  /** What it missed since `version`: after a gap, a `stale` refusal or a reconnect. */
  | { type: "catchup"; version: number }
  /** Its name, colour and selection at `version` (`presenceMessage`). */
  | { type: "presence"; [key: string]: unknown };

/** What a client receives. */
export type HubMessage =
  /** Steps from `version` (the version before them), each with its author. */
  | ({ type: "steps" } & Broadcast)
  /** Its message changed nothing (`Received`): `stale` catches up and sends again. */
  | { type: "refused"; reason: Refusal; version: number; message?: string }
  /**
   * The whole document, for a client joining or too far behind for the log; `clientID`: the one
   * the connection is (an editor made from it takes `collab({ version, clientID })`).
   */
  | { type: "snapshot"; version: number; document: FoliDocument; clientID: ClientID }
  /** Another client's presence. */
  | { type: "presence"; [key: string]: unknown }
  /** A client left: its presence goes. */
  | { type: "left"; clientID: ClientID };

/** One message to send: to `everyone` (the sender too), the `sender` only, or the `others`. */
export interface Outgoing {
  to: "everyone" | "sender" | "others";
  message: HubMessage;
}

export interface Hub {
  /** A client joins: its snapshot, and the others' last presence. */
  join(clientID: ClientID): Outgoing[];
  /**
   * A client's message (its text, or the value it parses to), from the connection the app
   * authenticated as `clientID`: what to send, and to whom. Never throws on what a client sent.
   */
  receive(message: string | unknown, clientID: ClientID): Outgoing[];
  /** A client left (or its connection closed): the others stop showing it. */
  leave(clientID: ClientID): Outgoing[];
}

/** A presence message's size, in characters of its JSON. */
const PRESENCE_SIZE = 4000;

/**
 * The hub of `authority`: turns each client's message into what to send. The authority checks
 * steps (`receive`); presence is relayed with the sender's id as the connection gives it, and
 * each client's last one kept for clients that join later.
 */
export function createHub(authority: Authority): Hub {
  const presence = new Map<string, Outgoing["message"]>();
  const snapshot = (clientID: ClientID): Outgoing => {
    const { version, document } = authority.snapshot();
    // The package (the .docx's parts) stays on the server: clients need the document only.
    return { to: "sender", message: { type: "snapshot", version, document, clientID } };
  };
  const catchUp = (version: unknown, clientID: ClientID): Outgoing => {
    if (typeof version !== "number") return snapshot(clientID);
    const missed = authority.stepsSince(version);
    if ("snapshot" in missed) return snapshot(clientID);
    return { to: "sender", message: { type: "steps", ...missed } };
  };
  return {
    join: (clientID) => [
      snapshot(clientID),
      ...[...presence.values()].map((message) => ({ to: "sender" as const, message })),
    ],
    receive(message, clientID) {
      let value: unknown = message;
      if (typeof message === "string") {
        try {
          value = JSON.parse(message);
        } catch {
          value = null;
        }
      }
      const type =
        typeof value === "object" && value !== null
          ? (value as { type?: unknown }).type
          : undefined;
      const refused = (reason: Refusal, version: number, text?: string): Outgoing[] => [
        {
          to: "sender",
          message: { type: "refused", reason, version, ...(text ? { message: text } : {}) },
        },
      ];
      if (type === "steps") {
        const { version, steps } = value as { version?: unknown; steps?: unknown };
        let result: ReturnType<Authority["receive"]>;
        try {
          result = authority.receive({ version, steps, clientID } as never, clientID);
        } catch (error) {
          // A step's own code throwing (an extension's): refused, not the app's server down.
          return refused(
            "invalid",
            authority.version,
            error instanceof Error ? error.message : undefined,
          );
        }
        if (result.ok) return [{ to: "everyone", message: { type: "steps", ...result.broadcast } }];
        return refused(result.reason, result.version, result.message);
      }
      if (type === "catchup") return [catchUp((value as { version?: unknown }).version, clientID)];
      if (type === "presence") {
        let size: number;
        try {
          size = JSON.stringify(value).length;
        } catch {
          return [];
        }
        // Dropped, not refused: a refusal is about steps, and its client would stop sending them.
        if (size > PRESENCE_SIZE) return [];
        // Who it is is the connection's to say; the receiving editors check the rest.
        const relayed: HubMessage = { ...(value as object), type: "presence", clientID };
        presence.set(String(clientID), relayed);
        return [{ to: "others", message: relayed }];
      }
      return refused("malformed", authority.version, "type");
    },
    leave(clientID) {
      presence.delete(String(clientID));
      return [{ to: "others", message: { type: "left", clientID } }];
    },
  };
}
