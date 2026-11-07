# Examples

Two small apps that use Foli the way a project outside this repository does: they install the
packages from the tarballs `pnpm pack` makes (what `npm publish` would upload), with npm, outside
the pnpm workspace, and build for production.

| App            | Stack                                        | Also checks                                                           |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| [`vite`](vite) | Vite 8, React 18.3, TypeScript 5.9 (strict)  | the published types; server rendering with React 18 (`ssr-check.mjs`) |
| [`next`](next) | Next.js 16 (App Router, Turbopack), React 19 | server rendering and hydration                                        |

Both show `FoliEditor` with its toolbar and save the document to `localStorage` once typing
pauses.

## Run

From the repository root:

```bash
pnpm examples
```

It builds the packages, packs them into `.packs/`, installs the tarballs into each app (a fresh
`node_modules`, no lockfile), builds both apps, runs the React 18 server-rendering check, and then
the Playwright smoke test (`examples/e2e/success.spec.ts`, Chromium, Firefox and WebKit) against
`vite preview` (port 5180) and `next start` (port 5181): type, format with a shortcut, undo,
serialize, reload without loss, no console errors, and the editor's shell in the server HTML.

It is not part of `pnpm check` (it installs from the npm registry and takes a few minutes); run it
before a release and after changes to packaging, exports or the React package.

To try an app by hand after `pnpm examples`: `npm run dev` in its folder.
