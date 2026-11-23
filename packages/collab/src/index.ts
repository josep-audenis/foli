/**
 * The authority of a shared Foli document (22.8, ADR-0012). It orders every step: a client sends
 * the steps it made since the version it knows; the authority accepts them only if they start
 * from its version, are steps of this schema, the app's `authorize` lets them through and they
 * apply, then gives what to broadcast. No transport and no storage: the app moves the messages
 * and persists what `snapshot` and the log give. Runs wherever `@folijs/core` runs.
 */
import {
  createEditor,
  type Editor,
  type EditorDocument,
  type Extension,
  type FoliDocument,
  FoliDocumentError,
  remote,
  Step,
  type StepJSON,
} from "@folijs/core";

/** A client's id: unique among the live clients of one document (a small integer is best). */
export type ClientID = string | number;

/** What a client sends: the steps it made since `version`. */
export interface StepsMessage {
  version: number;
  clientID: ClientID;
  steps: StepJSON[];
}

/** What everyone receives (the sender too): steps from `version`, each with its author. */
export interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: ClientID[];
}

/** Why a message changed nothing. `stale`: the client catches up, rebases and sends again. */
export type Refusal = "stale" | "malformed" | "invalid" | "too-large" | "unauthorized";

export type Received =
  | { ok: true; version: number; broadcast: Broadcast }
  | { ok: false; reason: Refusal; version: number; message?: string };

/** What a store keeps: the document at `version`, and the package it was imported from. */
export interface Snapshot<P = unknown> {
  version: number;
  document: FoliDocument;
  package?: P;
}

/** What a client that was away needs: the steps since its version, or the whole document. */
export type CatchUp<P = unknown> = Broadcast | { snapshot: Snapshot<P> };

export interface AuthorityLimits {
  /** A message's size, in characters of its JSON. Default 4 000 000. */
  messageSize?: number;
  /** Steps in one message. Default 1000. */
  steps?: number;
  /** Steps kept to catch clients up; older ones give way to a snapshot. Default 10 000. */
  log?: number;
}

export interface AuthorityOptions<P = unknown> {
  /** The document (a snapshot's, or a new one), as `createEditor` reads it. */
  document: EditorDocument;
  /** Its version (a stored snapshot's). Default 0. */
  version?: number;
  /** The package it was imported from (`DocxImport.package`), kept as it is for export. */
  package?: P;
  limits?: AuthorityLimits;
  /** The app's say: false refuses a client's steps (a read-only user) as `unauthorized`. */
  authorize?: (clientID: ClientID, steps: readonly Step[]) => boolean;
  /** The extensions the clients' editors have: their nodes, marks and steps. */
  extensions?: Extension[];
}

export interface Authority<P = unknown> {
  /** The number of steps accepted so far. */
  readonly version: number;
  /** A client's message (its JSON text, or the value it parses to). */
  receive(message: string | StepsMessage): Received;
  /** What a client at `version` misses: the steps since, or a snapshot when the log no longer has them. */
  stepsSince(version: number): CatchUp<P>;
  snapshot(): Snapshot<P>;
  /** The steps kept, from `version` on (`stepsSince`'s), for a store that keeps the log. */
  readonly log: Readonly<Broadcast>;
}

const DEFAULTS = { messageSize: 4_000_000, steps: 1000, log: 10_000 } as const;

const isClientID = (v: unknown): v is ClientID =>
  (typeof v === "string" && v.length > 0 && v.length <= 256) ||
  (typeof v === "number" && Number.isSafeInteger(v));

/** The authority of one document. */
export function createAuthority<P = unknown>(options: AuthorityOptions<P>): Authority<P> {
  const limits = { ...DEFAULTS, ...options.limits };
  const editor: Editor = createEditor({
    document: options.document,
    ...(options.extensions ? { extensions: options.extensions } : {}),
  });
  /** The version of the first step kept. */
  let base = options.version ?? 0;
  const steps: StepJSON[] = [];
  const clientIDs: ClientID[] = [];
  const version = () => base + steps.length;
  const refuse = (reason: Refusal, message?: string): Received => ({
    ok: false,
    reason,
    version: version(),
    ...(message ? { message } : {}),
  });
  const snapshot = (): Snapshot<P> => ({
    version: version(),
    document: editor.getDocument(),
    ...(options.package === undefined ? {} : { package: options.package }),
  });

  return {
    get version() {
      return version();
    },
    get log() {
      return { version: base, steps: [...steps], clientIDs: [...clientIDs] };
    },
    snapshot,
    receive(message) {
      let value: unknown = message;
      if (typeof message === "string") {
        if (message.length > limits.messageSize) return refuse("too-large");
        try {
          value = JSON.parse(message);
        } catch {
          return refuse("malformed", "not JSON");
        }
      } else if (JSON.stringify(message).length > limits.messageSize) return refuse("too-large");
      if (typeof value !== "object" || value === null) return refuse("malformed");
      const { version: from, clientID, steps: given } = value as Partial<StepsMessage>;
      if (!isClientID(clientID)) return refuse("malformed", "clientID");
      if (!Array.isArray(given) || !given.length) return refuse("malformed", "steps");
      if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 0)
        return refuse("malformed", "version");
      if (given.length > limits.steps) return refuse("too-large");
      if (from !== version()) return refuse("stale");
      const { schema } = editor.state;
      let parsed: Step[];
      try {
        parsed = given.map((json) => Step.fromJSON(schema, json));
      } catch (error) {
        if (error instanceof FoliDocumentError) return refuse("malformed", error.message);
        throw error;
      }
      if (options.authorize && !options.authorize(clientID, parsed)) return refuse("unauthorized");
      // Applied as clients apply it: the word plugin checks envelope and story steps.
      const before = editor.state;
      const tr = before.tr.setMeta(remote, true);
      for (const step of parsed) {
        const result = tr.maybeStep(step);
        if (result.failed) return refuse("invalid", result.failed);
      }
      editor.dispatch(tr);
      if (editor.state === before) return refuse("invalid", "refused by the document's rules");
      // The JSON as read back: what every client gets is what the authority applied.
      const json = parsed.map((step) => step.toJSON());
      const start = version();
      steps.push(...json);
      for (const _ of json) clientIDs.push(clientID);
      if (steps.length > limits.log) {
        const drop = steps.length - limits.log;
        steps.splice(0, drop);
        clientIDs.splice(0, drop);
        base += drop;
      }
      return {
        ok: true,
        version: version(),
        broadcast: { version: start, steps: json, clientIDs: json.map(() => clientID) },
      };
    },
    stepsSince(since) {
      if (!Number.isSafeInteger(since) || since < base || since > version())
        return { snapshot: snapshot() };
      const at = since - base;
      return { version: since, steps: steps.slice(at), clientIDs: clientIDs.slice(at) };
    },
  };
}
