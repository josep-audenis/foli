# ADR-0012: Collaboration: a central authority over steps, not a CRDT

- **Status:** Accepted when merged, task 22.1 (2026-11-23), by an agent's review, as the owner
  asked for Phase 22 (real-time editing by several people, planned in #218).
- **Context:** several people edit one document at once and each sees the others' changes
  within a moment. The document stays a lossless Word document (ADR-0005): what the editor
  holds beside its tree (styles, numbering, comments, stories, controls, resources) changes too,
  and the schema refuses trees Word would not open. Foli already describes every edit as steps
  that map positions (`Mapping`) and invert (history); what it lacks is listed under "Starts
  from" in Phase 22 of the roadmap.

## Decision

**A central authority orders every step.** One process per document (the app's server, a
worker, a Durable Object) holds the document and a version: the number of steps it has
accepted. A client sends the steps it made since the version it knows; the authority accepts
them only if they start from its current version and apply, and broadcasts them with their
authors' client ids. Each client keeps its own steps not yet confirmed on top of what it
received: when steps of others arrive, it takes its own back, applies the others' and applies
its own again, mapped over them (`Mapping` with mirrored maps, as history already does). Google
Docs works the same way.

**Not a CRDT.** A Yjs binding was weighed and left out:

- It bypasses steps: the server cannot validate a change, only merge it. Foli's authority
  applies every step with `packages/core` and refuses one that does not apply, or one the app's
  `authorize` callback refuses (a read-only user).
- A merge can leave a document the schema refuses: two people adding a cell to one row each
  make a row with the wrong number of cells; deleting a paragraph while another person splits
  it leaves content with no block. Steps refuse such a change at the authority instead.
- Word's envelope and stories would each need their own mapping into Yjs types, and every
  command that changes them a second implementation.
- Offline editing over days, a CRDT's strength, is not in this phase (below).

**The protocol.** Plain JSON, over whatever the app uses (WebSocket, SSE, HTTP, a queue):

| Message         | From → to            | Body                                                     |
| --------------- | -------------------- | -------------------------------------------------------- |
| steps           | client → authority   | `{ version, clientID, steps: StepJSON[] }`               |
| accepted        | authority → sender   | `{ version }` (the version after them)                   |
| refused         | authority → sender   | `{ reason, version }`, nothing changed                   |
| broadcast       | authority → everyone | `{ version, steps, clientIDs }` (`version`: before them) |
| catch up        | client → authority   | `stepsSince(version)`: the steps since, or a snapshot    |
| presence (22.9) | client → everyone    | `{ clientID, name, color, selection, version }`          |

A refusal's reason is `stale` (the version is behind: the client receives what it missed,
rebases and sends again), `malformed` (not JSON steps of this schema), `invalid` (a step does
not apply), `too-large` (over a limit) or `unauthorized` (the app's callback said no). The
sender's own steps come back in the broadcast like everyone's: a client knows its steps are
confirmed when it receives them with its own client id, and needs no reply to stay correct.

Messages may arrive late or out of order. A client applies a broadcast only when its `version`
is the client's own; one from later is kept until the ones before it arrive, or the client asks
to catch up. Catching up is the authority's `stepsSince(version)`, whose answer is
`{ version, steps, clientIDs }` (the steps since `version`) or `{ snapshot }` when the log was
compacted past it. After a `stale` refusal the client asks for what it missed the same way,
rebases its own steps over it and sends them again. Client ids are strings or integers, unique
among the live clients of one document (below: ids).

**What Foli ships, what the app keeps.** Foli ships:

- the client plugin in `@folijs/core` (headless, beside history): `collab({ version,
  clientID })`, `sendableSteps(state)`, `receiveTransaction(state, steps, clientIDs)`,
  `getVersion(state)`;
- `@folijs/collab`, the authority, which runs wherever `packages/core` runs (Node, workers,
  Durable Objects): `createAuthority({ document, package?, limits, authorize? })`, `receive`,
  `stepsSince`, `snapshot`, compaction of the log;
- presence (remote carets and selections drawn by the view) and an example over WebSocket.

The app keeps the transport, authentication and permissions (`authorize` is its callback),
storage (the authority gives what to persist, a snapshot and the log, and persists nothing
itself), client ids, and any hosted service.

**Envelope changes are steps.** `withEnvelope` keeps its signature and adds an `EnvelopeStep`
for each part of the envelope it changes, with the value before and after, so the change
travels, is validated and undone like any other. The parts and the unit a step changes:

| Envelope key | One step changes                                       |
| ------------ | ------------------------------------------------------ |
| `section`    | the whole last-section setup                           |
| `settings`   | one setting (`evenAndOddHeaders`, `trackRevisions`, …) |
| `defaults`   | the whole document defaults                            |
| `theme`      | the whole theme                                        |
| `styles`     | one style, by id                                       |
| `numbering`  | one abstract definition or one instance, by id         |
| `resources`  | one resource, by key                                   |
| `controls`   | one control's properties, by id                        |

Comments keep their `CommentStep` and stories their story steps; `schemaVersion` is computed.
Changing one entry, not the whole value, keeps messages small (a document's styles can weigh
hundreds of kilobytes) and lets two people change two styles at once. A step changed from a
stale value is refused: `EnvelopeStep.apply` sees only the tree, so the word plugin's
`filterTransaction` compares each step's `before` with the envelope's entry and refuses the
transaction (the authority's `invalid`). A client rebasing its own envelope step over another
person's change of the same entry merges the two property by property, its own change winning
where both changed one property: the collab plugin does it when it applies its own steps again,
where the envelope is known (`Step.map` has none). Undo now takes a style or numbering change back
with the edit it came with (it stayed before): a change of behaviour the changeset and
limitations.md state.

**The tracking switch is in the document.** Whether edits are tracked becomes a setting,
`settings.trackRevisions`, changed by a step: every client and the authority's snapshot have
it, `exportDocx` writes it when not told otherwise. A document that has the key needs schema 7
(the settings check refuses keys it does not know, so 1.5 could not read it); one without it
stays at what its trees need (5, or 6 for a rotated or cropped picture): `schemaVersionOf` reads
the settings and returns 6 for later nodes explicitly. Turning tracking off removes the key only
when the document never had it (an imported `.docx` that said on keeps `false`, so export turns
it off in the package). `importDocx` puts the key in for a Word file that tracks changes: such a
document is schema 7, which 1.5 cannot read; the changeset says so. Who makes the changes stays
each client's own (`author`).

**Stories merge.** A change inside an existing header, footer or note is a `StoryEditStep`: the
story's id and the story's own steps, mapped through the story's own positions, so two people
typing in one footer rebase like two people typing in the body. `StoryStep` stays for creating,
removing or replacing a story whole. A `StoryEditStep`'s map (`getMap`) is empty for the body but
carries the story's id and its inner steps' maps, so it sits at the body step's index in a
`Mapping`: `slice`, `invert` and mirror pairs keep working per step, and `Mapping.story(id)`
gives the story's positions mapped through every story step of that id. History's
`RebaseMapping` answers `story(id)` the same way. A remote story step maps the open story
editor's selection through it instead of taking the sender's selection.

**Ids are unique across clients.** Revision, comment, note, control and numbering ids and the
numbers of generated bookmark names are still the next free number after the largest in the
document, but with the collab plugin on, only numbers of the client's own class are taken:
`id ≡ slot (mod 256)`, where the slot is the client id when it is an integer (its remainder),
or a hash of it (a string). Allocators that take several ids at once (a tracked edit's
revisions, `track.ts`; generated bookmark names, `fieldupdate.ts`) step by 256 too. Ids grow by
up to 256 per allocation, far inside Word's 32-bit ids. Apps give the live clients of one
document distinct small integers; two clients in one slot can still collide. Without the plugin nothing changes: a single editor's
export is the same as before.

**Received transactions are applied as they are.** They carry the meta `remote`: kept out of
history and of tracking, let through the clients' filters, and the plugins that append transactions (comments, controls, fields,
notes) add nothing, since the sender already sent the steps they appended. The authority does
not trust them that way: it reads each step as untrusted JSON, asks the app's `authorize`, and
applies them to its own editor of the document: a step that does not apply, or an envelope or
story step that no longer finds what it changes (the word plugin's filter), is refused as
`invalid`. Clients then apply only what the authority accepted. (Built in 22.8: the locked
content controls' rules are not run again there. They depend on the command that made the edit
(filling a control's placeholder, updating a field), which steps do not carry; an app that must
enforce locks against a hostile client checks the steps in `authorize`.)

**History.** Received steps are not undoable. The user's own events are mapped over them (the
existing rebase, which drops steps that no longer apply one by one). Undo of an event whose
envelope step's `before` no longer holds, after someone else changed the same entry, drops the
event whole, as an envelope changed outside history does today (`storedStepsApply`); 22.7 adds
the story steps' check.

**What a snapshot holds.** `{ version, document, package? }`: the document as JSON (content,
envelope, comments, stories and resources), and the package it was imported from, which the
authority keeps opaque and the app stores beside it (export needs it for the parts Foli does not
edit, ADR-0005). A picture's bytes travel in a step only as a `data:` URL, within the message
limit; an app with large pictures stores the bytes and gives resources a `url`.

## Consequences

- The authority is the bottleneck of one document, by design: one process orders its steps.
  Scaling is per document, not per step.
- A client that is offline keeps its steps and sends them when it reconnects, rebased over
  what it missed; long offline sessions (days) and peer-to-peer are not supported.
- Two clients editing one style property at once: the last confirmed wins. Two clients in one id
  slot can produce duplicate ids; the app avoids it by numbering its live clients.
- The agent library and the MCP server do not edit a shared document in this phase.
