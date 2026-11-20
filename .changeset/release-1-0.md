---
"@folijs/core": major
"@folijs/view": major
"@folijs/react": major
"@folijs/docx": major
"@folijs/pdf": major
---

**Foli 1.0.** The first stable release: from here the public API and the saved format change only
as [semver](https://semver.org/) allows. Moving from 0.x:
[the migration guide](https://foli.josepaudenis.com/docs/guides/migrating-from-0x/) (every
change since 0.6.0, each older minor's breaks, documents v1 to v5).

**What 1.0 promises** ([ADR-0008](https://foli.josepaudenis.com/docs/decisions/ADR-0008-1.0-contract-and-extensions/),
[versions and deprecation](https://foli.josepaudenis.com/docs/deprecation/)):

- **The API.** What each package's entry exports by name, as the
  [API reference](https://foli.josepaudenis.com/docs/api/) lists it and its API report
  (`api-report.d.ts`) records it, is the 1.x API: nothing is removed or changed before 2.0.
  `@folijs/core/internal` is what the other Foli packages use from core, with no promise. The
  `--foli-*` CSS variables and the documented classes are part of it.
- **Deprecation.** A name that will go is first deprecated in a minor (`@deprecated` naming its
  replacement, a one-time development warning where cheap, listed in the changelog) and stays
  until the next major at least.
- **One version.** The five packages share one version, and `@folijs/view`, `@folijs/react`,
  `@folijs/docx` and `@folijs/pdf` take `@folijs/core` (React also `@folijs/view`) as a peer at
  exactly that version: install and upgrade them together.
- **Saved documents.** Every 1.x reads every earlier format without loss: schema v1 to v5 (0.1.0
  to 0.6.0), and any version a 1.x minor adds (only by adding, with a migration). A document is
  saved with the lowest version its content needs: 1.0 saves v5, as 0.6.0 does. An older 1.x
  refuses a document that needs a newer version with a `FoliDocumentError`; it never reads one
  in part. Apps that walk the JSON must ignore node and mark types they do not know.

**New since 0.6.0** (details in the entries below):

- Custom nodes and marks (`Extension`: namespaced inline and block leaves and marks on Word's
  schema), validated, saved in the JSON, copied and pasted, found, tracked, and written to `.docx`
  as content controls tagged `foli:` and read back; without their extension they load as foreign
  nodes and are kept.
- View extensions in `@folijs/view` (`ViewExtension`): node views (block ones laid out and split
  across pages), mark views, decorations and plugin views, through `createEditor({ extensions })`
  or React's `extensions` prop.
- Named commands from plugins (`PluginSpec.commands`, `editor.commands`, typed by augmenting
  `FoliCommands`); a plugin's keymap overrides the view's own keys, the rest listed as reserved
  ([keyboard](https://foli.josepaudenis.com/docs/keyboard/)).
- Toolbar items: `FoliToolbar`'s and `FoliEditor`'s `items`, the built-in items by name
  (`toolbarItems`, `defaultToolbarItems`), app buttons and menus, `useCommand`.
- The public API listed by name, internals stripped from the published types, exact peers.
- Safer `.docx` import (`maxNodes`, a long paragraph in linear time), pictures copied into another
  document with their images, faster keystrokes in long documents with lists.
- The docs site, [foli.josepaudenis.com/docs](https://foli.josepaudenis.com/docs/): getting
  started, guides (extensions, theming, migration), the API reference per package, live examples,
  the limitations.

**Known risks, accepted by the owner for 1.0 (2026-11-20):**

- The manual checks of ADR-0003 were never run on real devices: IME and dead keys on real
  Windows, macOS, Android and iOS input methods (only Chromium's emulation is automated), screen
  readers (NVDA, VoiceOver), macOS key bindings, spellcheck and autocorrect at a page edge, pastes
  from real Word, Google Docs and LibreOffice, Safari (tests run on Playwright's WebKit on
  Windows). A failure found later is fixed in a 1.x patch.
- Phase 5's speed targets are missed at 100 pages (104 pages, the owner's laptop, Chromium; Firefox
  in brackets; [benchmarks](https://foli.josepaudenis.com/docs/benchmarks/#10-numbers)): the
  first layout takes 118 ms (146; target 60), a full re-flow 148 ms (164; target 100), Enter's
  handler 9.9 ms (14; target 8) and its paint p95 35 ms (49; target 25). Typing meets them in
  Chromium (handler 7.9 ms, paint p95 14 ms), not in Firefox (11 and 28 ms). Every page is in the
  DOM and laid out on load (no virtualization); the incremental redraw is for a 1.x minor.
- Everything else is a documented known limit:
  [limitations](https://foli.josepaudenis.com/docs/limitations/).
