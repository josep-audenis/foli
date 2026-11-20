# Contributing

## Setup

Requirements: Node ≥ 20.19, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # playground at http://localhost:5173
```

`pnpm install` also installs a git pre-push hook that runs `pnpm check` on the working tree
(uncommitted edits count). There is no GitHub CI; the only workflow publishes releases
([Releasing](#releasing)). Skip once with `git push --no-verify`. The hook
is not installed when `core.hooksPath` is set or a foreign `pre-push` hook exists.

## Commands

| Command                         | What it does                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                      | Playground with HMR, packages consumed from source                                                                   |
| `pnpm test` / `pnpm test:watch` | Vitest (all packages)                                                                                                |
| `pnpm typecheck`                | `tsc --noEmit` in every workspace project                                                                            |
| `pnpm lint` / `pnpm format`     | Biome check / auto-fix                                                                                               |
| `pnpm build`                    | Build packages to `dist/` and the playground                                                                         |
| `pnpm check`                    | lint + typecheck + test + build + package checks (`publint`) + API reports + bundle sizes; the pre-push hook         |
| `pnpm api` / `pnpm api:update`  | Check each package's built types against its API report / rewrite the reports (after build)                          |
| `pnpm size`                     | Bundle size per package against its budget (after `pnpm build`)                                                      |
| `pnpm bench`                    | Benchmarks against this machine's baseline; fails on a regression (minutes; not in `pnpm check`; `--update` records) |
| `pnpm changeset`                | Record a change to a published package (bump type and changelog line)                                                |
| `pnpm examples`                 | Pack the packages, install them into `examples/` (Vite + React 18, Next.js + React 19), build, Playwright smoke test |

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

## Known flaky tests

Seen failing now and then on `main`, passing when run again; not hidden with retries. A failure
of one of these alone is noise; anything else is a real failure.

- `toolbar.spec.ts` "a click while the document is not focused focuses it and shows the change"
  (Chromium, about 1 run in 6).
- Under a full three-engine run's load (4 workers): `word-tables.spec.ts` "the table menu
  inserts a row from the keyboard; the menu, dialog and table pass axe" (Chromium) and
  `lists.spec.ts` "a click on a link does not navigate" (WebKit) failed once each on
  2026-11-17; both passed 3 times in a row in every engine when rerun.

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
playground, spike and examples are never published.

1. **With each change to a published package**, run `pnpm changeset`: pick the bump (before
   1.0: `minor` for breaking changes and features, `patch` for fixes) and write the changelog
   line for users. Commit the `.changeset/*.md` file with the change.
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
