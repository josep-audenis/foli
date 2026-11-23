---
"@folijs/collab": minor
---

`@folijs/collab`, the authority of a shared document (22.8, ADR-0012): `createAuthority({ document, version?, package?, limits?, authorize?, extensions? })` with `receive(message)` (accepted with what to broadcast, or refused: `stale`, `malformed`, `invalid`, `too-large`, `unauthorized`, changing nothing), `stepsSince(version)` (the steps since, or a snapshot once the log is compacted), `snapshot()` (version, document, package) and `log`. It validates every step by applying it with `@folijs/core`. No transport, no storage.
