# Examples

Small apps that use Foli the way a project outside this repository does: they install the
packages from the tarballs `pnpm pack` makes (what `npm publish` would upload), with npm, outside
the pnpm workspace, and build for production. They import only the packages' public entries.

| App                      | Stack                                         | Shows                                                                                                                                                                                                          | Tests (Chromium, Firefox, WebKit)                                                                                                                                                                    |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`vite`](vite)           | Vite 8, React 18.3, TypeScript 5.9 (strict)   | `FoliEditor` with its toolbar, saved to `localStorage`                                                                                                                                                         | `success.spec.ts`; the published types; server rendering with React 18 (`ssr-check.mjs`); `@folijs/docx` in Node (`docx-check.mjs`)                                                                  |
| [`next`](next)           | Next.js 16 (App Router, Turbopack), React 19  | the same, rendered on the server and hydrated                                                                                                                                                                  | `success.spec.ts`, the editor's shell in the server HTML                                                                                                                                             |
| [`extension`](extension) | Vite 8, React 18.3, TypeScript 5.9 (strict)   | a custom inline node (a mention) and mark (a topic) with their views, a plugin (a command, Ctrl+Shift+M, decorations), two toolbar items, saved to `.docx` and opened again with `@folijs/docx` in the browser | `extension.spec.ts`: type, insert a mention by the toolbar item and by the key, undo, mark text, `.docx` out and in with node and mark kept, axe                                                     |
| [`vanilla`](vanilla)     | Vite 8, TypeScript 5.9 (strict), no framework | `EditorView` from `@folijs/view` on a `div`, buttons running commands, JSON saved to and loaded from a text box                                                                                                | `success.spec.ts`; `vanilla.spec.ts`: the buttons, JSON save and load, a bad document refused, axe                                                                                                   |
| [`collab`](collab)       | Node (`ws` 8.18, MIT), Vite 8, TypeScript 5.9 | two or more people editing one document: `@folijs/collab` as a WebSocket server with a JSON file as its store, `EditorView` with the `collab` plugin, presence, reconnecting, `.docx` export                   | `collab.spec.ts`: two browsers type in one paragraph and converge, see each other's carets and names, tracked changes in each one's name, one drops its connection and catches up, the `.docx` opens |

`success.spec.ts` is the success criterion: type, format with a shortcut, undo, serialize, reload
without loss, a document saved by 0.1.0 loads; the tests that open the page also fail on a console error or
an uncaught exception (the server-HTML one only fetches it). The
React apps list `@folijs/core` and `@folijs/view` in their dependencies beside `@folijs/react`
(as `docs/getting-started.md` says to install them), so they do not show npm installing those
peer dependencies itself for an app that lists `@folijs/react` alone. The vanilla app lists only
`@folijs/core` and `@folijs/view`, and styles the pages with a few rules of its own instead of
`@folijs/react`'s `styles.css`.

## Run

From the repository root:

```bash
pnpm examples
```

It builds the packages, packs them into `.packs/`, installs the tarballs into each app (a fresh
`node_modules`, no lockfile), builds the five apps (the TypeScript ones typechecked first), runs
the React 18 server-rendering check and the DOCX check (a corpus document imported, exported and
imported again in Node), and then the Playwright tests (`examples/e2e/`, config
`playwright.examples.config.ts`) against `vite preview` (vite 5180, extension 5182, vanilla
5183) and `next start` (5181).

It is not part of `pnpm check` (it installs from the npm registry and takes a few minutes); run it
before a release and after changes to packaging, exports or the public API.

To try an app by hand after `pnpm examples`: `npm run dev` in its folder.
