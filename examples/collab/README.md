# Collab example

Two or more people edit one document at once (Phase 22, ADR-0012). `server.mjs` is a Node
WebSocket server (`ws`): the authority of the document (`@folijs/collab`), a JSON file as its
store, and the built page. The page (`src/main.ts`) is an `EditorView` with the `collab` plugin:
it sends its steps one batch at a time, applies broadcasts in version order, sends its presence,
reconnects with its client id and version to catch up, and exports the shared document as
`.docx`.

```bash
npm install && npm run build && npm start   # http://localhost:5184/?name=Ann
```

Open it in two windows with different names. `pnpm examples` at the repository root builds it
from the packed packages and runs `examples/e2e/collab.spec.ts` against it.
