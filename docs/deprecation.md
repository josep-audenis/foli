# Versions and deprecation

What Foli promises from 1.0 on: which API is stable, what a version number says about a change,
how a name is deprecated before it goes, and what happens to saved documents. Decided in
[ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md). Before 1.0 none of it holds: a 0.x
minor may break anything, and its changelog says what.

## What is public

- **Each package's entry.** What `@folijs/core`, `@folijs/view`, `@folijs/react`, `@folijs/docx`
  and `@folijs/pdf` export by name, as [api.md](api.md) lists it, is the API. Each package's exact
  published types are its API report, `packages/<name>/api-report.d.ts`.
- **Not public:** `@folijs/core/internal` (what the other Foli packages need from core: any
  release may change it), names api.md marks internal, and anything not exported.
- **CSS:** the 13 `--foli-*` variables and the classes and attributes
  [styling.md](styling.md#elements-and-classes) documents. Other class names, the DOM's structure
  and the styles the view sets inline are not promised.
- **The packages move together.** The five packages always share one version, and the others take
  `@folijs/core` (and `@folijs/react` also `@folijs/view`) as a peer at exactly that version.
  Upgrade them together.

## What a version number says

Foli follows [semver](https://semver.org/):

- **Major (2.0):** a breaking change. Removing or renaming an export, a prop or an option;
  narrowing what a function accepts; changing what it returns or does for input that worked;
  removing a CSS variable or a documented class; a change to the saved format that older
  versions could not read as before (below).
- **Minor (1.x):** new exports, options, props, commands and keys, and new members of types the
  packages return: node and mark types, `ControlJSON.kind`, the reasons in reports. A `switch`
  over them needs a `default`.
- **Patch (1.x.y):** fixes, including making an output match Word where it did not.

Making an output closer to Word's is a fix, so a page break may move in a patch. Page breaks also
depend on the fonts the browser has ([limitations](limitations.md#pages)).

## Deprecation

A name, prop, option or class that will go is first deprecated in a minor:

- its doc comment gets `@deprecated` naming the replacement (editors strike the name through);
- where the old path still runs and the check is cheap, it logs one `console.warn` per name,
  only when `globalThis.process?.env?.NODE_ENV` is not `"production"`;
- the changeset and the changelog list it, and api.md marks it.

It stays until the next major at least. Nothing is deprecated yet.

The development warning reads `process.env.NODE_ENV` through `globalThis` at run time, which
bundlers do not replace: a bundle that defines no `process` shows the warnings in production too.

## Saved documents

- **Every 1.x reads every earlier format** without loss: schema v1 to v5 (0.1.0 to 0.6.0), and
  any version a later 1.x adds. A document is migrated when loaded; migrations never drop content.
- **1.0 saves schema v5.** Custom node and mark types (an app's extensions) never change the
  version: they are content, stored by type name.
- **A document from a newer version** is refused with a `FoliDocumentError` that says so, never
  read in part.
- **Content a version does not model** (charts, shapes, equations, Word features to come) is kept
  as it is, shown as an opaque box, and written back to `.docx` unchanged. A custom type without
  its extension is kept as a foreign node or mark and saved back unchanged.
- **Apps that read the JSON** must ignore node and mark types they do not know: other apps'
  custom types reach them, and so may new Word types.

**Open:** whether a 1.x minor may add a schema version (only adding node types, attributes or
envelope keys, with a migration, saved only by documents that use what it adds) waits for the
owner's decision before 1.0.0 ([ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md#the-saved-format)).
If not, 1.x saves v5 throughout and new Word content stays opaque until 2.0.
