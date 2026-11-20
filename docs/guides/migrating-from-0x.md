# Migrating from 0.x

What an app changes to move from a 0.x release (0.1.0 to 0.6.0) to 1.0. 1.0.0 is not published
yet: the changes since 0.6.0 below are on `main`, recorded as pending changesets in
[`.changeset/`](../../.changeset/README.md), and ship with it. From 1.0 on, the rules for what may
change are in [Versions and deprecation](../deprecation.md).

## Documents

Every saved document loads in 1.0. `parseDocument`, `createEditor`, `setDocument` and
`FoliEditor`'s `initialContent` read every format from schema v1 (0.1.0) to v5 (0.6.0) and
migrate it; nothing is dropped. 1.0 (as `main` stands) saves schema v5, the format 0.6.0 saves,
so 0.6.0 and 1.0 read each other's documents as long as they hold no custom types (below). 0.5.0
and older cannot read v5: upgrade every app that reads your documents first.

| Saved by     | Schema | Loading it in 1.0                                                                   |
| ------------ | ------ | ----------------------------------------------------------------------------------- |
| 0.1.0        | 1      | migrated to Word's model (v3), then to v5                                           |
| 0.2.0        | 2      | migrated to Word's model (v3), then to v5                                           |
| 0.3.0, 0.4.0 | 3      | only the version changes; opaque tables stay opaque until the `.docx` is read again |
| 0.5.0        | 4      | only the version changes; opaque headers, notes and fields stay so likewise         |
| 0.6.0        | 5      | read as it is                                                                       |

The table per version, and how each migration works:
[document-model.md](../document-model.md#versioning-and-migrations).

## Install

The Foli packages now take `@folijs/core` (and `@folijs/react` also `@folijs/view`) as peer
dependencies at exactly their own version, so an app has one copy of the engine. Install the
packages you use together, at one version, and upgrade them together:

```bash
npm install @folijs/react @folijs/view @folijs/core react react-dom   # React
npm install @folijs/view @folijs/core                                 # the view without React
npm install @folijs/docx @folijs/core                                 # .docx
npm install @folijs/pdf @folijs/core                                  # PDF (plus playwright)
```

npm 7+ and pnpm install peers themselves; other package managers need them listed. Two versions
of `@folijs/core` in one app now fail at install instead of breaking at run time.

## From 0.6 to 1.0

**The public API is listed by name.** Each package's entry exports its names one by one, and
[api.md](../api.md) marks each stable or internal. Names that other Foli packages need from core
without a promise moved to a second entry, `@folijs/core/internal`: the Word context and envelope
(`wordContext`, `withEnvelope`, `setComments`, `StoryStep`, `CommentStep`, `EnvelopeStep`), the
formatting resolver (`Resolver`, `formatNumber`, `tableConditions`), clipboard fitting
(`copiedDefinitions`, `fitPaste`, `fitPastedV2`), the view's layout helpers, the Word `schema`,
`checkSection`, `checkControl` and `RUN_PROPERTY_MARKS`. If you imported one of them from
`@folijs/core`, import it from `@folijs/core/internal`, knowing any release may change it, or
use the public way: an editor's schema is `state.schema`. `defaultTextblockType`, `isNote` and
`storyBody` are gone. Every other module export is left out of the published types.

**`parseContent` takes an options object.** `parseContent(json, path?, fragment?)` became
`parseContent(json, { path?, fragment?, extensions? })` (`ContentOptions`):

```ts
import { parseContent } from "@folijs/core";

// 0.6: parseContent(json, "clip", true)
export const pasted = (json: unknown) => parseContent(json, { path: "clip", fragment: true });
```

**Namespaced types load as foreign content.** 0.6.0 refused a document holding a node or mark
type it did not know. A type with a namespace (`acme:mention`) now loads as a foreign node or
mark, drawn as its type in brackets and saved back unchanged; a type without one is still refused
with a `FoliDocumentError`. A document holding custom types is still schema v5, but 0.6.0 refuses
it. See [extensions](extensions.md#saving-loading-and-docx).

**A plugin's keymap now takes the view's own keys.** In 0.6.0 the view handled Ctrl+Home and
Ctrl+End (with Shift), F9, Alt+F9, Alt+Down, Ctrl+Alt+F, Ctrl+Alt+D, Shift+Alt+N, Ctrl+F, Ctrl+H,
Ctrl+G, F3, Shift+F3 and Ctrl+Shift+F5 before any keymap, so a plugin binding them never ran.
Now a user plugin's binding runs first, and one that returns true takes the key from the view.
Check the keys your plugins bind against [keyboard.md](../keyboard.md).

**`keyName` and Alt.** A letter or digit pressed with Alt (Option) is named by its physical key,
as it already was with Mod: Option+Shift+N on macOS is `Alt-Shift-n`, not the character it
types. A character typed with AltGr (Ctrl+Alt on Windows) is named by that character, so it types
instead of running a Ctrl+Alt binding.

**`editor.commands`** is typed `FoliCommands`, which apps augment with their plugins' commands.
A plugin command whose name is taken twice, or by a built-in command, makes `createEditor` throw a
`RangeError`.

**Listeners and hooks.** An editor listener (`editor.subscribe`) that throws no longer keeps the
others from the change: the error is reported with `console.error`.

**React.** `plugins` and `extensions` are still read once; changing them after mount now logs a
warning in development (give the component a new `key`). `FoliEditor`'s `toolbar` takes groups of
items as well as `true` and `false`. Without `items` the toolbar is as in 0.6.0.

New in 1.0, nothing to change for them: custom nodes and marks, view extensions (node views, mark
views, decorations, plugin views), plugin commands, toolbar items and `useCommand`
([extensions](extensions.md)); `editor.extensions`; the `data-foli-custom` and `data-foli-mark`
attributes ([styling.md](../styling.md#elements-and-classes)).

## From older versions

Each 0.x minor could break; the details are in each package's changelog
([changelog](../../packages/core/CHANGELOG.md)). What an app had to change, in short:

- **0.1 → 0.2:** `Transform.split(pos, after)` became `split(pos, depth, typesAfter)`;
  `StepMap.side` became `sides`; `MARK_TYPES` lists every mark (`SIMPLE_MARK_TYPES` the
  attribute-free ones); JSON leaves out attributes equal to their default; `setBlockType` and
  `toggleMark` return false where they used to do nothing or throw.
- **0.2 → 0.3:** Word's model (schema v3). Documents are saved as v3 and later; `createDocument`
  takes v3 content and a section in twips; text color is the `color` mark and `highlight` takes a
  Word color name (use `setTextColor`, `setHighlight`, `colorAt`); Tab types a tab outside lists
  (Escape, then Tab, leaves the editor); `toggleList(kind)` and `wrapInList(kind)` take no
  attributes, the list item commands are commands, not factories. Removed: `insertHorizontalRule`,
  `listTypeAt`, the ¶, H1–H3 and rule buttons, and the CSS variables `--foli-font-family`,
  `--foli-font-size`, `--foli-line-height`, `--foli-link-color`, `--foli-marker-color`,
  `--foli-rule-color` and `--foli-rule-thickness`.
- **0.3 → 0.4:** `closeHistory` makes a transaction its own undo step on both sides;
  `FoliEditor` puts the canvas inside `.foli-editor-body`, beside the comments pane;
  `withEnvelope` ignores comments (use `setComments`); the toolbar shows a review group.
- **0.4 → 0.5:** tables and pictures are nodes; `exportDocx` needs the bytes of a picture added
  since import (a `data:` URL or `ExportOptions.resource`), else it throws a `DocxError`; pages
  are `position: relative; isolation: isolate; display: flow-root`.
- **0.5 → 0.6:** headers, footers, notes, fields and content controls are nodes and stories;
  `FoliEditor` includes `FoliNavigation` and takes Ctrl+F, Ctrl+H, Ctrl+G, F3, Shift+F3 and
  Ctrl+Shift+F5 while the focus is in the document; `view.print()` updates fields first; the
  toolbar shows the Section, Header, Fields, Navigate, Notes and Controls menus; pages break
  closer to Word than in 0.5.0.
