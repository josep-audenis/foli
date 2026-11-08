---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

Links. Core: `setLink(href)`, `removeLink`, `insertLink(href, text?)`, `linkAt(state)`, `normalizeHref` (trim, `\` to `/`, spaces percent-encoded, `mailto:` for an email address and `https://` for a host name) and `autolinkHref`; every entry normalizes then validates the href, so unsafe protocols never apply; `editor.commands.setLink` and `removeLink`. Mod-K runs `openLinkEditor`, a request (`linkEditorRequest` transaction metadata, `requestsLinkEditor(tr)`) that a link UI answers. View: Ctrl+click (Cmd+click on Apple platforms) opens a link in a new tab with `noopener,noreferrer`; pasting plain text that is one URL makes a link (over selected text, links it), except paste as plain text; `view.paste(data, autolink?)`. React: a Link toolbar button (pressed in a link) and Mod-K open an accessible link dialog (URL field, Apply, Remove link, Cancel, Escape; an invalid URL is announced and not applied); new CSS variable `--foli-error-color`.
