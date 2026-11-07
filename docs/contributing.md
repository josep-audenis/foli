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
| `pnpm check`                    | lint + typecheck + test + build + package checks (`publint`) + bundle size budgets; the pre-push hook                |
| `pnpm size`                     | Bundle size per package against its budget (after `pnpm build`)                                                      |
| `pnpm changeset`                | Record a change to a published package (bump type and changelog line)                                                |
| `pnpm examples`                 | Pack the packages, install them into `examples/` (Vite + React 18, Next.js + React 19), build, Playwright smoke test |

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

`@folijs/core`, `@folijs/view` and `@folijs/react` always share one version (a Changesets
`fixed` group, [`.changeset/config.json`](../.changeset/config.json)); the playground, spike and
examples are never published.

1. **With each change to a published package**, run `pnpm changeset`: pick the bump (before
   1.0: `minor` for breaking changes and features, `patch` for fixes) and write the changelog
   line for users. Commit the `.changeset/*.md` file with the change.
2. **To release**, on a branch: `pnpm changeset version` applies every pending changeset (new
   version in each `package.json`, `CHANGELOG.md` entries) and deletes the changeset files.
   Review, commit ("Version packages"), PR, merge to `main`.
3. **Publish**: GitHub → Actions → **Release** → Run workflow (on `main`). It installs from the
   lockfile, refuses to run while unapplied changesets exist or a package is still at the
   `0.0.0` placeholder, runs `pnpm check`, publishes every
   version not yet on npm with [provenance](https://docs.npmjs.com/generating-provenance-statements),
   and pushes the tags (`@folijs/core@0.1.0`…). Publishing an existing version is skipped, so a
   failed run can be re-run.

Before the first release, the owner sets up (once):

- The npm org `folijs` (npmjs.com → Add Organization, free plan for public packages), owning
  the `@folijs` scope.
- An npm **granular access token** with read and write access to the `@folijs` scope (npmjs.com
  → Access Tokens → Generate New Token → Granular), saved as the secret `NPM_TOKEN` of the
  GitHub environment `npm` (repository Settings → Environments → `npm` → Add secret). Add
  required reviewers to that environment to approve each publish. Write tokens expire: renew
  it before a release if needed.
- After the first publish, optionally switch to npm
  [trusted publishing](https://docs.npmjs.com/trusted-publishers) (each package's settings on
  npmjs.com → Trusted publisher: GitHub Actions, this repository, workflow `release.yml`,
  environment `npm`) and delete the token: the workflow then authenticates through OIDC.
