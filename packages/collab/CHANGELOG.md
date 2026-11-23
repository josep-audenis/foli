# @folijs/collab

## 0.1.0

### Minor Changes

- e8f2152: `@folijs/collab`, the authority of a shared document (22.8, ADR-0012): `createAuthority({ document, version?, package?, limits?, authorize?, extensions? })` with `receive(message, clientID?)` (the client id the app's connection authenticated; a message claiming another, or `AUTHORITY`, is refused; accepted with what to broadcast, or refused: `stale`, `malformed`, `invalid`, `too-large`, `unauthorized`, changing nothing), `stepsSince(version)` (the steps since, or a snapshot once the log is compacted), `snapshot()` (version, document, package) and `log` (restored with `options.log`). It restores Word's table rules concurrent edits break, as steps under `AUTHORITY`. It validates every step by applying it with `@folijs/core`. No transport, no storage.

### Patch Changes

- Updated dependencies [70f9683]
- Updated dependencies [74c437a]
- Updated dependencies [42fae0f]
- Updated dependencies [fdd1ea8]
- Updated dependencies [fb9277f]
- Updated dependencies [eb3818a]
  - @folijs/core@1.6.0
