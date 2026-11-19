---
"@folijs/react": minor
---

Toolbar items and command hooks (ADR-0008):

- `FoliToolbar` takes `items`, groups of items (a separator between groups), and `FoliEditor`'s
  `toolbar` takes the same groups in place of `true`. The built-in items are exported by name in
  `toolbarItems` (`toolbarItems.bold`, `toolbarItems.table`…) and the default toolbar as
  `defaultToolbarItems`, so an app adds, removes, reorders and regroups them. Without `items`
  the toolbar is as before.
- An app's item (`ToolbarItem`) is a `ToolbarButton` that runs a command, enabled by its dry run
  (`editor.can`) or its own `enabled`, a toggle with `pressed`; or a `ToolbarMenu` of `actions`
  (`ToolbarAction`s, `checked(state, editor)` for a checkbox entry) like the built-in menus,
  which take more entries the same way (a menu without entries is disabled). `icon` stands for
  the text. Two items with one `key` log a warning in development. App items keep the toolbar's one tab stop, arrow keys, `aria-pressed`,
  `aria-disabled` and the document's focus and selection on click.
- `useCommand(command)` gives `{ enabled, run }` for a button of the app's own: a dry run after
  every transaction, and a way to run it, on the header, footer or note open on its page, else
  the editor. `useCommand(name, ...args)` does the same for any named command of
  `editor.commands` (built-in or a plugin's), typed by `FoliCommands`.
- `plugins` and `extensions` stay read once: changing them after mount now logs one warning
  unless `process.env.NODE_ENV` is `"production"` at run time (a new array of the same plugins is no change). Give the component a new
  `key` to create an editor with them.

New names: `toolbarItems`, `defaultToolbarItems`, `ToolbarItem`, `ToolbarButton`, `ToolbarMenu`,
`ToolbarAction`,
`ToolbarItemName`, `useCommand`, `UseCommandOptions`, `CommandState`.
