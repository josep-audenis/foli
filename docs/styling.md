# Styling

`@folijs/react/styles.css` is the default theme. Import it once (in the app entry or, with
Next.js, the root layout):

```ts
import "@folijs/react/styles.css";
```

Without it the editor still works, but pages have no background, shadow or gap and the toolbar
is unstyled. The page size and margins come from the document's section, set inline by the view;
CSS does not change them. The text's look (fonts, sizes, spacing, colors) is the document's own:
Word's styles and direct formatting, written inline on each paragraph and run.

## CSS variables

The defaults live on `:root` (and `:host`, for a shadow root). Set a variable on any ancestor of
the editor, or on `.foli-canvas` and `.foli-toolbar` themselves, to override it there.

| Variable                    | Default                                                    | Applies to                      |
| --------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `--foli-canvas-background`  | `#f3f3f1`                                                  | area around the pages           |
| `--foli-page-background`    | `#ffffff`                                                  | pages                           |
| `--foli-page-shadow`        | `0 1px 2px rgb(0 0 0 / 0.08), 0 2px 8px rgb(0 0 0 / 0.06)` | pages                           |
| `--foli-page-gap`           | `24px`                                                     | space between pages             |
| `--foli-text-color`         | `#1d1d1b`                                                  | text without a color of its own |
| `--foli-selection-color`    | `rgb(35 103 220 / 0.22)`                                   | selected text                   |
| `--foli-border-color`       | `#e2e2df`                                                  | toolbar border and separators   |
| `--foli-toolbar-background` | `#ffffff`                                                  | toolbar                         |
| `--foli-toolbar-color`      | `#1d1d1b`                                                  | toolbar text                    |
| `--foli-toolbar-hover`      | `#f0f0ee`                                                  | hovered button                  |
| `--foli-toolbar-pressed`    | `#dfe8f8`                                                  | pressed (active) toggle         |
| `--foli-focus-ring`         | `#2367dc`                                                  | focus outline, pressed border   |
| `--foli-error-color`        | `#b3261e`                                                  | link dialog: invalid URL        |

Page breaks follow the text's real line boxes: a font, size or line-height change (the
document's, or CSS over it) re-flows the pages. The document's fonts must be available (loaded web fonts or installed ones); the view
re-flows when a web font finishes loading.

## Themes

A complete theme, a dark one, print colors, forced colors and the look of extension content:
the [theming guide](guides/theming.md). This page is the reference it builds on.

## Elements and classes

| Selector                                  | What                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.foli-canvas`                            | `FoliCanvas`'s outer element (`className` is added here)                                                                                                                           |
| `.foli-content`                           | the editable host (`role="textbox"`); `FoliCanvas` adds the class, with `EditorView` add it yourself                                                                               |
| `.foli-page`                              | one page (`<section>`), size and padding inline                                                                                                                                    |
| `p`, `h1`–`h6` inside `.foli-page`        | paragraphs, and paragraphs in Word's heading styles; their formatting inline                                                                                                       |
| `span` inside a paragraph                 | a run of text, its formatting inline (bold is `font-weight: 700`); a list number is a `[data-foli-marker]` span, not editable                                                      |
| `.foli-selected-node`                     | an opaque block (content Foli keeps verbatim) while it is selected                                                                                                                 |
| `[data-foli-picture-selected]`            | the selected picture's element (outlined; its resize handle is `[data-foli-resize]`); a picture without alt text is `[data-foli-no-alt]`                                           |
| `[data-foli-float]`                       | a floating picture's element, first in its paragraph (its wrapping as the value); pages are `position: relative; isolation: isolate; display: flow-root`                           |
| `.foli-selected-cell`                     | each cell of a cell selection (`[data-foli-cells]` on the host while there is one)                                                                                                 |
| `a`                                       | a link with a safe target, in the run's own color (a click places the caret; Ctrl/Cmd+click opens it in a new tab)                                                                 |
| `.foli-toolbar`                           | `FoliToolbar` (`className` is added here)                                                                                                                                          |
| `.foli-toolbar-button`                    | each button, plus `.foli-toolbar-<key>` (`bold`, `bulletList`, `undo`, `pageBreak`…)                                                                                               |
| `.foli-toolbar-select`                    | each box (a `select`), plus `.foli-toolbar-<key>`                                                                                                                                  |
| `.foli-toolbar-tabs`, `.foli-toolbar-tab` | the tab list over the toolbar and each tab (`.foli-toolbar-tab-<key>`; the selected one is `[aria-selected="true"]`); `.foli-toolbar-panel` wraps the toolbar while there are tabs |
| `.foli-toolbar-dialog`                    | an app's dialog under the toolbar (`ToolbarDialog`; also `.foli-link-dialog` and `.foli-toolbar-<key>-dialog`)                                                                     |
| `.foli-toolbar-separator`                 | between button groups                                                                                                                                                              |
| `.foli-toolbar-menu`, `.foli-menu`        | a color menu button's wrapper, its menu (`.foli-menu-item`, `.foli-menu-swatch`); `.foli-toolbar-swatch` shows the current color on the button                                     |
| `.foli-link-dialog`                       | the link dialog under the toolbar; `.foli-link-error` its message for an invalid URL                                                                                               |
| `.foli-table-dialog`                      | the insert table dialog (also `.foli-link-dialog`)                                                                                                                                 |
| `.foli-picture-dialog`                    | the picture dialog (also `.foli-link-dialog`); `.foli-picture-status` its status line while a picture uploads                                                                      |
| `.foli-editor-body`                       | `FoliEditor`'s row of pages and comments pane (make it, or a parent, the scroller: the pane scrolls with the pages)                                                                |
| `.foli-find-panel`                        | the find and replace panel and the bookmarks dialog (`.foli-bookmarks`), also `.foli-link-dialog`; fixed at the window's top right                                                 |
| `.foli-outline`                           | the outline, a column beside the pages                                                                                                                                             |
| `.foli-comments`                          | `FoliComments`, the pane (`className` is added here); `.foli-comment-thread` each thread (`[data-active]`, `[data-done]`), `.foli-comment` each comment                            |
| `.foli-comment-active`                    | text of the comment whose thread has the focus (in the document)                                                                                                                   |
| `[data-foli-custom]`                      | a custom (or foreign) node, its type as the value: its node view inside, else its text; a block split across pages is one per page, after the first `aria-hidden`                  |
| `[data-foli-mark]`                        | a run under custom marks, their types space separated (`[data-foli-mark~="acme:topic"]`); a mark view adds its own classes and attributes                                          |

Extensions style their own content (ADR-0008): the view adds no rules for what node views, mark
views and decorations draw. How to style it without re-flowing the pages:
[theming](guides/theming.md#extension-content).

CSS over the document's own formatting needs `!important` (it is inline), and pagination
follows it: margins and padding on blocks are measured. A paragraph split across two pages is
two elements: its padding and border repeat on each part. Avoid negative margins on blocks and
`vertical-align` on inline text; pagination does not model them.

## Print

The view adds print rules for each editor: one sheet per page at its section's page size
(named pages; an engine without them prints every sheet at the last section's size), no gap. The stylesheet removes the canvas padding, page shadows and toolbar in print.

Everything else on your web page prints too, and anything before the pages adds sheets. Hide
it:

```css
@media print {
  header,
  nav,
  footer {
    display: none;
  }
}
```

The same rules print the read-only renderer's pages (`DocumentPages.printStyles()`), and so
`@folijs/pdf`'s `exportPdf`: the editor's print and the PDF have the same sheets.

Print-only CSS must not change text metrics (font, size, line height), or the printed lines
no longer match the computed page breaks. `@page` applies to the whole web page: with several
editors of different page sizes, print one at a time.

## Content Security Policy

The view injects two small `<style>` elements: the placeholder rule (when a placeholder is
first shown) and each editor's print rules. A policy without `'unsafe-inline'` in `style-src`
blocks them: the placeholder is not shown and print is not split into sheets. (Page size and
margins are set through the CSSOM, which such a policy allows.) Until a nonce option exists,
allow `'unsafe-inline'` for styles if you need either.

## Shadow DOM

The stylesheet's variables are declared on `:host` too, so you can adopt it in a shadow root.
The view adds its placeholder style to the host's shadow root and its print rules to the
document head (where `@page` works) and to the shadow root.
