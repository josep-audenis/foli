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
  type Node,
  remote,
  Step,
  type StepJSON,
} from "@folijs/core";
import { keepTablesApart } from "@folijs/core/internal";

/**
 * The client id of the steps the authority adds itself: Word's rules that concurrent edits can
 * break and the schema does not hold (two tables inserted at one place by two people meet; a
 * table ends the body), restored by a paragraph, broadcast with the client's steps.
 */
export const AUTHORITY: ClientID = "@folijs/collab";

/** A client's id: unique among the live clients of one document (a small integer is best). */
export type ClientID = string | number;

/** What a client sends: the steps it made since `version`. */
export interface StepsMessage {
  version: number;
  clientID: ClientID;
  steps: StepJSON[];
}

/**
 * What everyone receives (the sender too: it confirms its steps): steps from `version`, each with
 * its author. `version` is the version before these steps: a client applies the broadcast when
 * it is `getVersion(state)`, and is at `version + steps.length` after it.
 */
export interface Broadcast {
  version: number;
  steps: StepJSON[];
  clientIDs: ClientID[];
}

/** Why a message changed nothing. `stale`: the client catches up, rebases and sends again. */
export type Refusal = "stale" | "malformed" | "invalid" | "too-large" | "unauthorized";

/** A message's outcome. `version`: the authority's, after the steps when `ok`. */
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
  /** The kept steps' size, in characters of their JSON. Default 50 000 000. */
  logSize?: number;
}

export interface AuthorityOptions<P = unknown> {
  /** The document (a snapshot's, or a new one), as `createEditor` reads it. */
  document: EditorDocument;
  /** Its version (a stored snapshot's). Default 0. */
  version?: number;
  /** A stored log (`authority.log`) ending at `version`: clients behind are caught up from it. */
  log?: Broadcast;
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
  /**
   * A client's message (its JSON text, or the value it parses to). `clientID`: who sent it, as
   * the app's connection knows (authenticated); a message claiming another is refused. Without
   * it the message's own `clientID` is taken. The authority's own id (`AUTHORITY`) is refused.
   */
  receive(message: string | StepsMessage, clientID?: ClientID): Received;
  /** What a client at `version` misses: the steps since, or a snapshot when the log no longer has them. */
  stepsSince(version: number): CatchUp<P>;
  snapshot(): Snapshot<P>;
  /** The steps kept, from `version` on (`stepsSince`'s), for a store that keeps the log. */
  readonly log: Readonly<Broadcast>;
}

const DEFAULTS = { messageSize: 4_000_000, steps: 1000, log: 10_000, logSize: 50_000_000 } as const;

/** How deep the document may nest (core reads JSON up to 300 levels; a little under). */
const MAX_DEPTH = 250;

const isClientID = (v: unknown): v is ClientID =>
  (typeof v === "string" && v.length > 0 && v.length <= 256) ||
  (typeof v === "number" && Number.isSafeInteger(v));

/** The deepest nesting of `doc`, walked without recursion; stops past `limit`. */
function depthOf(doc: Node, limit: number): number {
  let deepest = 0;
  const stack: [Node, number][] = [[doc, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop() as [Node, number];
    if (depth > deepest) deepest = depth;
    if (deepest > limit) return deepest;
    node.forEach((child) => {
      if (!child.isLeaf) stack.push([child, depth + 1]);
    });
  }
  return deepest;
}

/** The authority of one document. */
export function createAuthority<P = unknown>(options: AuthorityOptions<P>): Authority<P> {
  const limits = { ...DEFAULTS, ...options.limits };
  const editor: Editor = createEditor({
    document: options.document,
    ...(options.extensions ? { extensions: options.extensions } : {}),
  });
  const given = options.version ?? 0;
  if (!Number.isSafeInteger(given) || given < 0)
    throw new RangeError("createAuthority: version must be a non-negative integer");
  /** The version of the first step kept. */
  let base = given;
  const steps: StepJSON[] = [];
  const clientIDs: ClientID[] = [];
  /** Each kept step's size (characters of its JSON) and their sum. */
  const sizes: number[] = [];
  let logSize = 0;
  const version = () => base + steps.length;
  const refuse = (reason: Refusal, message?: string): Received => ({
    ok: false,
    reason,
    version: version(),
    ...(message ? { message: message.slice(0, 500) } : {}),
  });
  let cached: { state: unknown; snapshot: Snapshot<P> } | null = null;
  const snapshot = (): Snapshot<P> => {
    if (cached?.state !== editor.state)
      cached = {
        state: editor.state,
        snapshot: {
          version: version(),
          document: editor.getDocument(),
          ...(options.package === undefined ? {} : { package: options.package }),
        },
      };
    // A copy of the document (the caller may change it); the package as it was given.
    return { ...cached.snapshot, document: JSON.parse(JSON.stringify(cached.snapshot.document)) };
  };
  const keep = (json: readonly StepJSON[], authors: readonly ClientID[]) => {
    json.forEach((step, i) => {
      const size = JSON.stringify(step).length;
      steps.push(step);
      clientIDs.push(authors[i] as ClientID);
      sizes.push(size);
      logSize += size;
    });
    // Over either limit: the oldest steps give way (a client behind them gets a snapshot).
    let drop = 0;
    while (steps.length - drop > limits.log || (logSize > limits.logSize && drop < steps.length)) {
      logSize -= sizes[drop] as number;
      drop++;
    }
    if (drop) {
      steps.splice(0, drop);
      clientIDs.splice(0, drop);
      sizes.splice(0, drop);
      base += drop;
    }
  };
  // A stored log, to catch clients up after a restart: it must end at the version given.
  if (options.log) {
    const { version: from, steps: logged, clientIDs: ids } = options.log;
    if (from + logged.length !== base || ids.length !== logged.length)
      throw new RangeError("createAuthority: the log does not end at the document's version");
    base = from;
    keep(logged, ids);
  }

  return {
    get version() {
      return version();
    },
    get log() {
      return { version: base, steps: [...steps], clientIDs: [...clientIDs] };
    },
    snapshot,
    receive(message, connection) {
      let value: unknown = message;
      if (typeof message === "string") {
        if (message.length > limits.messageSize) return refuse("too-large");
        try {
          value = JSON.parse(message);
        } catch {
          return refuse("malformed", "not JSON");
        }
      } else {
        let size: number;
        try {
          size = JSON.stringify(message).length;
        } catch {
          return refuse("malformed", "not JSON");
        }
        if (size > limits.messageSize) return refuse("too-large");
      }
      if (typeof value !== "object" || value === null) return refuse("malformed");
      const { version: from, steps: sent } = value as Partial<StepsMessage>;
      // Who sent it is the connection's to say (authenticated by the app), not the message's.
      const clientID = connection ?? (value as Partial<StepsMessage>).clientID;
      if (!isClientID(clientID) || String(clientID) === String(AUTHORITY))
        return refuse("malformed", "clientID");
      const claimed = (value as Partial<StepsMessage>).clientID;
      if (
        connection !== undefined &&
        claimed !== undefined &&
        String(claimed) !== String(connection)
      )
        return refuse("unauthorized", "clientID is not the connection's");
      if (!Array.isArray(sent) || !sent.length) return refuse("malformed", "steps");
      if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 0)
        return refuse("malformed", "version");
      if (sent.length > limits.steps) return refuse("too-large");
      if (from !== version()) return refuse("stale");
      const { schema } = editor.state;
      let parsed: Step[];
      try {
        parsed = sent.map((json) => Step.fromJSON(schema, json));
      } catch (error) {
        if (error instanceof FoliDocumentError) return refuse("malformed", error.message);
        throw error;
      }
      if (options.authorize && !options.authorize(clientID, parsed)) return refuse("unauthorized");
      // Applied as clients apply it (the word plugin checks envelope and story steps), with
      // Word's rules concurrent edits can break and the schema does not hold restored, in one
      // transaction: a step that would break the document changes nothing.
      const before = editor.state;
      const tr = before.tr.setMeta(remote, true);
      try {
        for (const step of parsed) {
          const result = tr.maybeStep(step);
          if (result.failed) return refuse("invalid", result.failed);
        }
        if (depthOf(tr.doc, MAX_DEPTH) > MAX_DEPTH) return refuse("too-large", "nested too deep");
        keepTablesApart(tr);
        editor.dispatch(tr);
      } catch (error) {
        if (error instanceof RangeError) return refuse("invalid", error.message);
        throw error;
      }
      if (editor.state === before) return refuse("invalid", "refused by the document's rules");
      // The JSON as read back: what every client gets is what the authority applied.
      const json = tr.steps.map((step) => step.toJSON());
      const authors: ClientID[] = json.map((_, i) => (i < parsed.length ? clientID : AUTHORITY));
      const start = version();
      keep(json, authors);
      return {
        ok: true,
        version: version(),
        broadcast: { version: start, steps: json, clientIDs: authors },
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
