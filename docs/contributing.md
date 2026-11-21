# Contributing

## Setup

Requirements: Node ≥ 20.19, pnpm 10 (`corepack enable`). The Word harnesses also need Windows
with desktop Word.

```bash
pnpm install
pnpm exec playwright install   # Chromium, Firefox and WebKit, for the browser tests
pnpm dev                       # playground at http://localhost:5173
```

`pnpm install` also installs a git pre-push hook that runs `pnpm check` on the working tree
(uncommitted edits count). There is no GitHub CI; the only workflow publishes releases
([Releasing](#releasing)). Skip once with `git push --no-verify`. The hook
is not installed when `core.hooksPath` is set or a foreign `pre-push` hook exists.

Packages import each other by name; the `@folijs/source` export condition maps the names to
`src/` in dev, tests and typecheck, so nothing needs building first. `pnpm build` writes each
package's `dist/`: what is published, and what `pnpm api`, `pnpm size`, `pnpm examples` and the
corpus scripts read.

## Where things live

[architecture.md](architecture.md) describes the design and every subsystem; this is the map.

| Path                           | What                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/model/`     | Schema, immutable nodes, fragments, marks, positions, slices, JSON. No DOM, no Word                                                                                                                         |
| `packages/core/src/transform/` | Steps, mapping, `Transform`                                                                                                                                                                                 |
| `packages/core/src/state/`     | `EditorState`, `Transaction`, plugins, `createEditor` (`editor.ts`), history, commands, Word's editing features                                                                                             |
| `packages/core/src/v3/`        | The saved document: Word's schema, `parseDocument`, migrations, the formatting resolver, custom types (`extensions.ts`)                                                                                     |
| `packages/view/src/view.ts`    | `EditorView`: input, keys, selection, stories, the drawing and layout passes                                                                                                                                |
| `packages/view/src/word/`      | Word's blocks, tables, headers, notes and fields drawn on pages; `renderDocument` (`pages.ts`)                                                                                                              |
| `packages/view/src/layout/`    | The page flow (`flow.ts`): blocks and lines onto pages                                                                                                                                                      |
| `packages/view/src/`           | Also the clipboard (`clipboard.ts`), print rules (`print.ts`), view extensions (`extension.ts`)                                                                                                             |
| `packages/react/`              | Components, hooks, the toolbar and its items (`src/`); the default theme (`styles.css`)                                                                                                                     |
| `packages/docx/src/`           | Zip, XML, the package, `import/`, `export/`, custom types (`custom.ts`)                                                                                                                                     |
| `packages/pdf/src/`            | `exportPdf` and the page script it runs (`renderer.ts`)                                                                                                                                                     |
| `packages/agent/src/`          | `openSession`: reading by block handles (`read.ts`, `handles.ts`), operations (`operations.ts`, `templates.ts`)                                                                                             |
| `packages/mcp/src/`            | The MCP server: the stdio protocol (`protocol.ts`), file rules (`files.ts`), documents, `tools.ts`, the `bin`; code mode (`code.ts`, `sandbox.ts`, `sandbox-worker.mjs`, plain JavaScript copied to `dist`) |
| `apps/playground/`             | Pages the e2e tests drive (`e2e/`), benchmarks (`bench/`), the Word corpus pages (`word/`). No engine logic                                                                                                 |
| `apps/site/`                   | The landing page, `/test/`, the docs site (`src/docs/`), its live examples and the guides' samples (`src/guides/`)                                                                                          |
| `corpus/`, `scripts/corpus/`   | Word-written documents, Word's reference data, the harnesses that compare Foli with Word                                                                                                                    |
| `examples/`                    | Vite, Next.js, extension and framework-free apps that install the packed packages (`pnpm examples`)                                                                                                         |
| `spikes/two-page/`             | Phase 1's spike; never published                                                                                                                                                                            |

### How a keystroke flows

Typing a letter, end to end:

1. **Key.** `EditorView`'s keydown handler names the key (`keyName`) and asks the plugins'
   keymaps in order. The view's overridable keys run where the `viewKeys` marker plugin stands,
   the reserved ones before every keymap ([keyboard.md](keyboard.md)). A plain letter has no
   binding, so the event goes on.
2. **Input.** The view prevents `beforeinput` (`insertText`): the browser never edits the DOM,
   except during IME composition, which the view reads back when it ends. It reads the DOM
   selection into the model and runs the `insertText(text)` command.
3. **Transaction.** A command (`(state, dispatch?) => boolean`) builds a `Transaction` from the
   state: steps, the mapped selection, stored marks, metadata.
4. **Editor.** `editor.dispatch` rebuilds it as tracked changes when tracking is on
   (`trackTransaction`). `EditorState.applyTransaction` runs the plugins' filters, computes their
   states (history keeps the inverted steps there) and lets them append transactions. The
   stories' editors are synced, then the listeners called.
5. **View.** The view, a listener, draws again only the blocks that changed (or whose
   decorations changed) and measures them; the flow re-paginates from the first change, reusing
   the pages before it. Then the selection is written back to the DOM.
6. **App.** React's `useEditorState` selectors run and re-render what changed; `FoliEditor`'s
   `onChange` gets the transactions.

The document is never read from the DOM: the model is the truth.

## Tests and harnesses

| What                     | Run                                                                        | Where                                                                                                |
| ------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unit and property tests  | `pnpm test` (in `pnpm check`)                                              | `*.test.ts[x]` next to the code; jsdom per file (`// @vitest-environment jsdom`); `fast-check`       |
| Browser tests            | `pnpm test:e2e`, one project: `pnpm test:e2e --project=playground-firefox` | `apps/playground/e2e/`, `apps/site/e2e/`, `apps/site/e2e-build/`, `spikes/two-page/e2e/`             |
| Visual regression        | in `pnpm test:e2e` (`visual.spec.ts`)                                      | [testing/visual-regression.md](testing/visual-regression.md)                                         |
| Examples from tarballs   | `pnpm examples`                                                            | [examples/README.md](../examples/README.md)                                                          |
| API reports, sizes       | `pnpm api`, `pnpm size` (in `pnpm check`, after build)                     | [API reports](#api-reports); budgets in `scripts/size.mjs`                                           |
| Benchmarks               | `pnpm bench`, `pnpm bench:layout`                                          | [benchmarks.md](benchmarks.md)                                                                       |
| Pages against Word       | `pnpm corpus:pages` (`FOLI_WORD_PDF=<folder>` adds Word's PDFs)            | [corpus/README.md](../corpus/README.md#page-agreement-with-word)                                     |
| Round trips through Word | `node scripts/corpus/<feature>-roundtrip.mjs`, then its PowerShell script  | [corpus/README.md](../corpus/README.md#checking-folis-writing-with-word) (Windows with desktop Word) |
| Import coverage          | `node scripts/corpus/import-report.mjs [folder]` (after build)             | [corpus/README.md](../corpus/README.md#import-coverage)                                              |
| IME, screen readers      | by hand                                                                    | [testing/ime.md](testing/ime.md)                                                                     |

The e2e projects are `<app>-<engine>`: `spike`, `playground`, `site` and `site-build` (the built
site under `vite preview`) in `chromium`, `firefox` and `webkit` (`playwright.config.ts`), each
app on its own dev server port. The whole suite takes a while: run the projects and files your
change touches, in the three engines. The guides' code samples are files of
`apps/site/src/guides/`: `pnpm typecheck` compiles them, `pnpm test` runs most of them and fails
when a `ts` or `tsx` block of `docs/guides/*.md` is not found in one of them.

## Commands

| Command                            | What it does                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Playground with HMR, packages consumed from source                                                                   |
| `pnpm test` / `pnpm test:watch`    | Vitest (all packages)                                                                                                |
| `pnpm test:e2e`                    | Playwright, every project (`--project=<app>-<engine>` for one)                                                       |
| `pnpm typecheck`                   | `tsc --noEmit` in every workspace project                                                                            |
| `pnpm lint` / `pnpm format`        | Biome check / auto-fix                                                                                               |
| `pnpm build`                       | Build the packages to `dist/`, the playground and the site                                                           |
| `pnpm check`                       | lint + typecheck + test + build + package checks (`publint`) + API reports + bundle sizes; the pre-push hook         |
| `pnpm api` / `pnpm api:update`     | Check each package's built types against its API report / rewrite the reports (after build)                          |
| `pnpm size`                        | Bundle size per package against its budget (after `pnpm build`)                                                      |
| `pnpm bench`                       | Benchmarks against this machine's baseline; fails on a regression (minutes; not in `pnpm check`; `--update` records) |
| `pnpm bench:layout`                | The pagination benchmarks alone (`playwright.bench.config.ts`)                                                       |
| `pnpm corpus:pages`                | The Word corpus laid out and compared with Word's pages, in Chromium (`playwright.word.config.ts`)                   |
| `pnpm changeset`                   | Record a change to a published package (bump type and changelog line)                                                |
| `pnpm --filter @folijs/site build` | Build the site (landing, `/test/`, docs) to `apps/site/dist/` ([The site](#the-site))                                |
| `pnpm examples`                    | Pack the packages, install them into the four `examples/` apps, build, Playwright smoke test                         |

## API reports

What each package publishes is its API ([ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md)):
the names its entry lists by name (`src/index.ts`; core also `src/internal.ts`, published as
`@folijs/core/internal`, with no promise). The published types are kept in a report,
`packages/<name>/api-report.d.ts`: the package's built `dist/**/*.d.ts` joined in path order,
source-map comments removed. `pnpm api` (`scripts/api.mjs`, in `pnpm check`; build first) fails when

- the built types differ from the committed report (the new one is written to a temporary file,
  named in the message, to diff against);
- a module exports a name that no entry exports and that is not tagged `@internal` (a
  forgotten export: export it from the index, or tag it);
- an entry uses `export *`;
- a type reachable from a package's public entry imports `@folijs/core/internal` (an unpromised
  type in a stable signature: give the public function its own options type);
- the published types do not compile on their own (`skipLibCheck` off): for example a public
  type that uses a name tagged `@internal`.

Names only one package uses are tagged `@internal` (a JSDoc tag) and left out of the published
types by `stripInternal`. TypeScript drops a declaration whose leading comment contains the tag
anywhere, so never write it in the prose of a public declaration's comment (a stripped public
name fails the last check). Names other packages need from core without promising them go on
`@folijs/core/internal`. A change to a report (a new export, a changed signature, an edited doc
comment) is a change to the API: run `pnpm build && pnpm api:update`, review the report's diff
with the change and commit both; a changeset says what changed for users.

## The site

`apps/site` is the site at `foli.josepaudenis.com`: the landing page, the editor at `/test/` and
the docs at `/docs/`, built from `docs/*.md`, the API reports and the changelogs at build time
([architecture.md](architecture.md#docs-site-appssite-128)). To add a docs page, add the
markdown file and one entry in `apps/site/src/docs/nav.ts`; a link to a heading that does not
exist fails the build.

```bash
pnpm --filter @folijs/site dev      # http://localhost:5173, the pages rewritten on save
pnpm --filter @folijs/site build    # static files in apps/site/dist/
pnpm --filter @folijs/site preview  # serve the build locally
```

It is published at [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/) and
**deploys itself: every push builds it.** Known (2026-11-20, 12.12): a Cloudflare Pages project
named `foli`, connected to the repository through Cloudflare's GitHub app
(`cloudflare-workers-and-pages`), builds every pushed commit and reports a "Cloudflare Pages"
check on it: on `main`'s commits "Deployed successfully" (a production deployment on
`foli-8c6.pages.dev`), on other branches a preview at `<branch>.foli-8c6.pages.dev` (for
example `phase-12-ecosystem.foli-8c6.pages.dev`). foli.josepaudenis.com serves the same files as
`main`'s deployment. Inferred, not visible from the repository: the production branch is `main`
and the custom domain points at it; the build command and output directory (presumably the
site's build into `apps/site/dist/`) are set in Cloudflare's dashboard, as nothing in the
repository configures them (no `wrangler.toml`, no workflow). So merging to `main` publishes the
docs; nothing else is needed. Pages are folders with an `index.html` (`/docs/styling/` →
`docs/styling/index.html`); an unknown path gets the landing page with status 200 (there is no
`404.html`), so check a page by its title, not its status.

## Known flaky tests

Seen failing now and then on `main`, passing when run again; not hidden with retries. A failure
of one of these alone is noise; anything else is a real failure.

- `toolbar.spec.ts` "a click while the document is not focused focuses it and shows the change"
  (Chromium, about 1 run in 6).
- Under a full three-engine run's load (4 workers): `word-tables.spec.ts` "the table menu
  inserts a row from the keyboard; the menu, dialog and table pass axe" (Chromium) and
  `lists.spec.ts` "a click on a link does not navigate" (WebKit) failed once each on
  2026-11-17; both passed 3 times in a row in every engine when rerun.
- Under a full three-engine e2e run beside other work (2026-11-20, 12.11; 993 passed, 5 failed):
  `print.spec.ts` "short" and "lists" (Firefox: the browser context hung on closing, with
  graphics errors in Firefox's log), `word-headers.spec.ts` "page numbers in letters…" (WebKit,
  a 30 s timeout) and the site's `docs.spec.ts` "every nav entry opens its page…" (WebKit, 90 s);
  all passed 3 times in a row when rerun.
- Under a full three-engine run beside Word harnesses (2026-11-20, 12.12; 997 passed, 2 failed):
  `word-tables.spec.ts` "T5 in a table: cells selected across the page break…" (Firefox:
  `NS_ERROR_CONNECTION_REFUSED` on `page.goto`, the dev server not answering for a moment) and
  `word-navigation.spec.ts` "typing in the document with a search open…" (WebKit: its timing
  check, 8.4 s against 6.6 s allowed); both passed 3 times in a row when rerun.
- Under a full three-engine run beside other sessions' work (2026-11-21, after the bug sweeps of
  #151, #157 and #166; 998 passed, 19 failed), every failure a timeout or a lost connection,
  none an assertion: in WebKit, `caret.spec.ts` "the caret scrolls into view…" and "T1: typing
  and formatting…", `lists.spec.ts` "list editing with the keyboard…", `pages.spec.ts` "typing
  that grows page 1…", "a heading never ends a page…", "a split paragraph leaves at least two
  lines…" and "typing on page 1 of a long document…", `visual.spec.ts` "short" and
  "multi-page", `word-navigation.spec.ts` "the panel goes to a page and a heading…" and the
  site's `docs.spec.ts` "every nav entry opens its page…"; in Firefox, `word-fields.spec.ts`
  "what is typed after a trailing field…" (`NS_ERROR_CONNECTION_REFUSED`, then the context
  hanging on closing), the site's `docs.spec.ts` "search finds headings and API names",
  "/docs/api/react/ is axe-clean", "/docs/api/core/ is axe-clean" and "the plugin example's
  key…", and `build.spec.ts` for `/docs/`, `/docs/api/core/` and `/docs/examples/custom-node/`.
  Run again with 2 workers, 17 passed; the other two (`caret.spec.ts` "the caret scrolls into
  view…", WebKit; `word-fields.spec.ts`, Firefox) passed 3 times in a row alone. The caret test
  runs close to its 30 s under load (29.0 s once) and takes 11 to 15 s alone, as it did before
  the sweeps (timed on both).

Fixed in #166 (it failed in pre-push runs about one time in four, from #151 on): the handles
property test (`packages/agent/src/read.test.ts`, "after any tracked edits…"), a real defect in
accepting a paragraph deleted before a table, not noise.

Fixed in 12.11 (they failed in pre-push runs now and then): the tracked-changes property test
(`track.test.ts`, a random seed about one run in five hit a known difference it did not leave
out), `import.test.ts` "many open moves and many hyperlinks" (two imports under the default 5 s
timeout) and `export.test.ts` "round-trips the model's values for any content" (20 s under
load). A property test that fails prints its seed: rerun it with `{ seed, path }` before
calling it flaky.

## Rules

- TypeScript strict; no `any` without a comment explaining why.
- Tests next to code (`*.test.ts[x]`). DOM tests opt in with `// @vitest-environment jsdom`.
- Editing logic belongs in `packages/*`, never in `apps/playground`.
- Never silently drop or "repair" document content; throw `FoliDocumentError`.
- No editor-engine dependencies (ProseMirror, Tiptap, Lexical, Slate, Quill, CKEditor, …) in
  published packages — see [ADR-0002](decisions/ADR-0002-own-editing-engine.md).
- Studying other engines is encouraged; prefer reimplementing. If you copy code, it must be
  permissively licensed and recorded in `THIRD_PARTY_NOTICES.md` (source URL, commit, license,
  what changed), with the original notices kept.
- New dependency: check license (MIT/Apache/ISC/BSD preferred; no AGPL/GPL/commercial), size,
  and whether an existing dependency already covers it.
- Never use `innerHTML` (or equivalents) with document content or pasted data.
- Changes to the persisted format bump `SCHEMA_VERSION` and add a migration.
- Significant architectural decisions get an ADR in `docs/decisions/`.
- Keep docs truthful: never document planned behavior as implemented.

## Releasing

`@folijs/core`, `@folijs/view`, `@folijs/react`, `@folijs/docx` and `@folijs/pdf` always share one
version (a
Changesets `fixed` group, [`.changeset/config.json`](../.changeset/config.json)); the
playground, site, spike and examples are never published. `@folijs/agent` (Phase 13) is
outside the group and versions on its own as 0.x, with `@folijs/core` as an exact peer: a
release that bumps core bumps it too (a patch, by Changesets, as core's dependant), so that it
asks for the new core: every release of the five republishes it, and a major of core gives it
a patch too, unless it has a changeset of its own. `@folijs/mcp` (Phase 14) is 0.x on its
own as well, with agent, core and docx as exact dependencies: it is republished with any of
them, the same way.

1. **With each change to a published package**, run `pnpm changeset`: pick the bump (before
   1.0: `minor` for breaking changes and features, `patch` for fixes; from 1.0 the rules of
   [versions and deprecation](deprecation.md), a removal deprecated first) and write the
   changelog line for users. Commit the `.changeset/*.md` file with the change.
2. **Before each release**, run `pnpm bench` on a quiet machine on mains power
   ([benchmarks.md](benchmarks.md#performance-tracking-127)): it compares the layout,
   keystroke, find, `.docx` and PDF benchmarks with the committed baseline of the machine
   (`bench/baselines/<machine>.json`) and exits non-zero on a regression past a threshold or a
   baseline metric not measured. Rerun once before believing a regression; explain a real one in
   the release PR, or fix it. With no baseline for the machine it compares nothing and fails:
   `pnpm bench --update` records one, commit it.
   Run it too on a change meant to be faster, then `--update` to keep the new numbers.
3. **To release**, on a branch: `pnpm changeset version` applies every pending changeset (new
   version in each `package.json`, `CHANGELOG.md` entries) and deletes the changeset files.
   Review, commit ("Version packages"), PR, merge to `main`.
4. **Publish**: GitHub → Actions → **Release** → Run workflow (on `main`). It installs from the
   lockfile, refuses to run while unapplied changesets exist or a package is still at the
   `0.0.0` placeholder, runs `pnpm check`, publishes every version not yet on npm with
   [provenance](https://docs.npmjs.com/generating-provenance-statements), then tags every
   current version that is on npm and has no tag yet (`@folijs/core@0.1.0`…) and pushes the
   tags. A failed run can be re-run: published versions are skipped, and their missing tags
   are added.

The owner set up, once (done before 0.1.0; repeat when a token expires or moves):

- The npm org `folijs` (npmjs.com → Add Organization, free plan for public packages), owning
  the `@folijs` scope.
- An npm **granular access token** (npmjs.com → Access Tokens → Generate New Token →
  Granular): packages and scopes **Read and write**, limited to the `@folijs` scope; tick
  **Bypass two-factor authentication**, since CI cannot answer a 2FA prompt (the publish
  would fail with `EOTP`). Write tokens expire: renew it before a release if needed. Keep it
  out of the repository (a local `.env` is ignored by git).
- The GitHub environment `npm` (repository Settings → Environments → New environment `npm`):
  - **Deployment branches and tags: Selected branches → `main`**. The workflow's own `main`
    check can be removed on another branch by anyone who can push, so this setting is what
    keeps the token on `main`. Without the environment, the first run creates it unprotected.
  - Secret `NPM_TOKEN`: the token above.
  - Optional: required reviewers, to approve each publish.
- After the first publish, optionally switch to npm
  [trusted publishing](https://docs.npmjs.com/trusted-publishers) (each package's settings on
  npmjs.com → Trusted publisher: GitHub Actions, this repository, workflow `release.yml`,
  environment `npm`) and delete the token: the workflow then authenticates through OIDC.
  Then consider splitting the workflow into a check job and a publish job, so the OIDC
  permission (`id-token: write`) is not available to the install and check steps.
