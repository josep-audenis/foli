# Styling

`@folijs/react/styles.css` is the default theme. Import it once (in the app entry or, with
Next.js, the root layout):

```ts
import "@folijs/react/styles.css";
```

Without it the editor still works, but pages have no background, shadow or gap and the toolbar
is unstyled. The page size and margins come from the document settings, set inline by the view;
CSS does not change them.

## CSS variables

The defaults live on `:root` (and `:host`, for a shadow root). Set a variable on any ancestor of
the editor, or on `.foli-canvas` and `.foli-toolbar` themselves, to override it there.

| Variable                    | Default                                                    | Applies to                    |
| --------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `--foli-canvas-background`  | `#f3f3f1`                                                  | area around the pages         |
| `--foli-page-background`    | `#ffffff`                                                  | pages                         |
| `--foli-page-shadow`        | `0 1px 2px rgb(0 0 0 / 0.08), 0 2px 8px rgb(0 0 0 / 0.06)` | pages                         |
| `--foli-page-gap`           | `24px`                                                     | space between pages           |
| `--foli-text-color`         | `#1d1d1b`                                                  | document text                 |
| `--foli-font-family`        | `Georgia, "Times New Roman", serif`                        | document text                 |
| `--foli-font-size`          | `11pt`                                                     | document text                 |
| `--foli-line-height`        | `1.5`                                                      | document text                 |
| `--foli-selection-color`    | `rgb(35 103 220 / 0.22)`                                   | selected text                 |
| `--foli-border-color`       | `#e2e2df`                                                  | toolbar border and separators |
| `--foli-toolbar-background` | `#ffffff`                                                  | toolbar                       |
| `--foli-toolbar-color`      | `#1d1d1b`                                                  | toolbar text                  |
| `--foli-toolbar-hover`      | `#f0f0ee`                                                  | hovered button                |
| `--foli-toolbar-pressed`    | `#dfe8f8`                                                  | pressed (active) toggle       |
| `--foli-focus-ring`         | `#2367dc`                                                  | focus outline, pressed border |

Page breaks follow the text's real line boxes: a font, size or line-height change re-flows the
pages. The document's fonts must be available (loaded web fonts or installed ones); the view
re-flows when a web font finishes loading.

## Dark theme

Pages are paper: the default keeps them white. To darken everything:

```css
@media (prefers-color-scheme: dark) {
  /* On the editor's elements, not :root: the stylesheet's own :root defaults would win
     whenever it loads after this rule. */
  .foli-canvas,
  .foli-toolbar {
    --foli-canvas-background: #1b1b1a;
    --foli-page-background: #2a2a28;
    --foli-page-shadow: 0 0 0 1px #3a3a37;
    --foli-text-color: #e8e8e4;
    --foli-selection-color: rgb(110 160 255 / 0.35);
    --foli-border-color: #3a3a37;
    --foli-toolbar-background: #222220;
    --foli-toolbar-color: #e8e8e4;
    --foli-toolbar-hover: #33332f;
    --foli-toolbar-pressed: #2c3f63;
    --foli-focus-ring: #7aa7ff;
  }
}
```

Print uses the same variables: reset the page and text colors under `@media print` if dark
pages should print white.

## Elements and classes

| Selector                           | What                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.foli-canvas`                     | `FoliCanvas`'s outer element (`className` is added here)                                             |
| `.foli-content`                    | the editable host (`role="textbox"`); `FoliCanvas` adds the class, with `EditorView` add it yourself |
| `.foli-page`                       | one page (`<section>`), size and padding inline                                                      |
| `p`, `h1`–`h6` inside `.foli-page` | paragraphs and headings                                                                              |
| `strong`, `em`, `u`, `s`           | bold, italic, underline, strikethrough                                                               |
| `.foli-toolbar`                    | `FoliToolbar` (`className` is added here)                                                            |
| `.foli-toolbar-button`             | each button, plus `.foli-toolbar-<key>` (`bold`, `h1`, `undo`, `pageBreak`…)                         |
| `.foli-toolbar-separator`          | between button groups                                                                                |

You can style headings and paragraphs (`.foli-page h1 { font-size: 20pt }`). Margins and
padding on blocks are measured, so pagination follows them. A paragraph split across two pages
is two elements: its padding and border repeat on each part. Avoid negative margins on blocks
and `vertical-align` on inline text; pagination does not model them.

## Print

The view adds print rules for each editor: one sheet per page at the document's page size, no
gap. The stylesheet removes the canvas padding, page shadows and toolbar in print.

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

Print-only CSS must not change text metrics (font, size, line height), or the printed lines
no longer match the computed page breaks. `@page` applies to the whole web page: with several
editors of different page sizes, print one at a time.

## Forced colors and contrast

In forced-colors mode (Windows High Contrast) the toolbar marks pressed buttons with a
`Highlight` outline, since backgrounds are dropped. When you override colors, check the text
and focus ring contrast against your backgrounds.

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
