# @folijs/agent

Agent editing for [Foli](https://github.com/josep-audenis/foli): a session over a document whose
edits are tracked changes in the agent's name, for a person to accept or reject in Foli or in
Word. No DOM and no Node built-ins: runs in Node, browsers, workers and sandboxes. Its only
dependency is `@folijs/core`, a peer at an exact version.

> **Unstable (0.x), unreleased.** In development (roadmap, Phase 13): reading by block handles
> and the editing operations are not built yet. Outside the 1.0 promise of the other packages.

```ts
import { openSession } from "@folijs/agent";
import { exportDocx, importDocx } from "@folijs/docx";

const { document, package: pkg } = await importDocx(bytes);
const session = openSession(document, { author: "Agent" });
// session.editor is the headless editor: tracking is on, the author is the session's.
const out = await exportDocx(session.document(), pkg);
```
