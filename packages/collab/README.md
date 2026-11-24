# @folijs/collab

The authority for real-time editing of a [Foli](https://github.com/josep-audenis/foli) document
by several people (ADR-0012). It orders every step: a client sends the steps it made since the
version it knows; the authority accepts them only if they start from its version, are steps of
the document's schema, the app's `authorize` lets them through and they apply, and gives what to
broadcast. No transport, no storage, no DOM and no Node built-ins: it runs in Node, workers and
Durable Objects; the app moves the messages and stores what it gives. Its only dependency is
`@folijs/core`, a peer at an exact version.

> **Unstable (0.x).** Outside the 1.0 promise of the other packages: its API may change in any
> 0.x release. `npm install @folijs/collab @folijs/core`.

```ts
import { createAuthority } from "@folijs/collab";

const authority = createAuthority({
  document,
  package: pkg,
  authorize: (clientID) => canEdit(clientID),
});

// A client's message (`{ version, steps }`, from `sendableSteps` in @folijs/core), with the
// client id your connection authenticated (never the one the message claims):
const result = authority.receive(text, connection.clientID);
if (result.ok)
  broadcastToEveryone(result.broadcast); // the sender too: it confirms its steps
else reply(result); // `stale`: the client catches up (`stepsSince`), rebases, sends again

authority.stepsSince(version); // { version, steps, clientIDs } or { snapshot } when compacted
authority.snapshot(); // { version, document, package }: what to store
```

The client side is `collab`, `sendableSteps`, `receiveBroadcast` and `getVersion` in
`@folijs/core`. Refusals: `stale`, `malformed`, `invalid` (a step does not apply, or an envelope
or story step no longer finds what it changes), `too-large` (`limits`: message size, steps per
message) and `unauthorized`. The log keeps `limits.log` steps (default 10 000); a client further
behind gets a snapshot. Pass `log` (`authority.log`, stored) and `version` to start again after a
restart. Locked content controls are not checked again by the authority (their rules depend on
the command that made an edit): an app whose clients may be hostile checks them in `authorize`.

**Versions.** A version counts steps. `broadcast.version` is the version _before_ the
broadcast's steps: a client applies it when `broadcast.version === getVersion(editor.state)`, keeps
one from later until those before it arrive, and drops one it already has. `received.version` is
the authority's version _after_ them. Broadcast to everyone, the sender too: its own broadcast is
how its steps are confirmed. A client that skips it, applies a broadcast twice or drops a `stale`
refusal is refused as `stale` until it catches up, or for good: see the guide's
[My edits stop](https://github.com/josep-audenis/foli/blob/main/docs/guides/collaboration.md#my-edits-stop).
