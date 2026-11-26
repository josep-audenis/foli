# Third-party notices

Foli's code is its own (see [ADR-0002](docs/decisions/ADR-0002-own-editing-engine.md)). This file
records code that is copied or closely derived from other projects, with provenance and the
original license notice.

## Tinos (test-only font)

- **Source:** the `@fontsource/tinos` npm package (5.3.0, a root dev dependency), from
  https://github.com/googlefonts/tinos.
- **License:** SIL Open Font License 1.1 (the package's `LICENSE` file).
- **Used in:** `apps/playground/e2e/fixtures.ts`, which serves the Latin faces to the
  playground during Playwright runs so page breaks and screenshots are deterministic. Foli
  does not ship or load any font; nothing of it is in a published package.

## Lucide icons

- **Source:** the `lucide-static` npm package (1.81.0), from https://github.com/lucide-icons/lucide.
  Not a dependency: the shapes of 70 icons were copied as data (Phase 29.2).
- **License:** ISC; the icons Lucide derives from Feather also under MIT (Cole Bemis). The full
  text is `packages/react/LICENSE-lucide`, published with `@folijs/react`.
- **Used in:** `packages/react/src/icons.tsx` (`toolbarIcons`), each entry naming its Lucide icon.
