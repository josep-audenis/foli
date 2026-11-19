---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

View extensions (ADR-0008): a `ViewExtension` (from `@folijs/view`) is an `Extension` with view
hooks, given to `createEditor({ extensions })` or React's new `extensions` prop (`FoliEditor`,
`useFoliEditor`). The editor keeps its extensions (`editor.extensions`) and every `EditorView` of
it reads the hooks from there.

- `nodeViews`: how a custom node is drawn (`NodeView`: `render(node, { document, h })`, `split?`).
  Inline ones sit in their line as the browser sizes them; block ones are measured and placed by
  the page flow and split between their root element's children across a page end, unless
  `split: false` keeps them whole. `h` makes elements without HTML and refuses event handlers and
  unsafe links.
- `markViews`: classes and attributes on every run of a custom mark. Runs of custom marks are now
  named for CSS too (`data-foli-mark`), with or without a mark view.
- `decorations(state)`: classes and attributes on ranges (`{ from, to, attrs }`) or nodes
  (`node: true`), never document content; only the blocks whose decorations changed are drawn
  again.
- `view(editorView)`: a plugin view with `update(view, previous)` and `destroy()`, made with the
  view and destroyed with it.

New names: `ViewExtension`, `NodeView`, `NodeViewDOM`, `MarkView`, `Decoration`,
`DecorationAttrs`, `PluginView` (`@folijs/view`); `Editor.extensions` (`@folijs/core`).
