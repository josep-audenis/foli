# Contributing

## Setup

Requirements: Node ≥ 20.19, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # playground at http://localhost:5173
```

## Commands

| Command                         | What it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `pnpm dev`                      | Playground with HMR, packages consumed from source |
| `pnpm test` / `pnpm test:watch` | Vitest (all packages)                              |
| `pnpm typecheck`                | `tsc --noEmit` in every workspace project          |
| `pnpm lint` / `pnpm format`     | Biome check / auto-fix                             |
| `pnpm build`                    | Build packages to `dist/` and the playground       |
| `pnpm check`                    | Everything CI runs                                 |

## Rules

- TypeScript strict; no `any` without a comment explaining why.
- Tests next to code (`*.test.ts[x]`). DOM tests opt in with `// @vitest-environment jsdom`.
- Editing logic belongs in `packages/*`, never in `apps/playground`.
- Never silently drop or "repair" document content; throw `FoliDocumentError`.
- New dependency: check license (MIT/Apache/ISC/BSD preferred; no AGPL/GPL/commercial), size,
  and whether an existing dependency already covers it.
- Changes to the persisted format bump `SCHEMA_VERSION` and add a migration.
- Significant architectural decisions get an ADR in `docs/decisions/`.
- Keep docs truthful: never document planned behavior as implemented.
