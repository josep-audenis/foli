# Theming

A theme is a set of values for Foli's CSS variables, plus the app's own rules for the content
its extensions draw. This page shows how to set them, a complete theme, a dark one, print and
forced colors. The reference (each variable's default, every element and class, print rules,
Content Security Policy, Shadow DOM) is [styling.md](../styling.md): this page does not repeat it.

## What a theme changes

The default theme is `@folijs/react/styles.css`. Its 13 variables
([the table](../styling.md#css-variables)) color the area around the pages, the pages, the
toolbar, its menus and dialogs, the find panel, the outline and the comments pane.

A theme does not change the document. Page size and margins come from the document's sections,
and the text's fonts, sizes, spacing and colors from its Word styles and direct formatting,
written inline. `--foli-text-color` only colors text that has no color of its own. A CSS rule
over the document's formatting needs `!important`, and the pages re-flow with it
([styling.md](../styling.md#elements-and-classes)).

Some colors are not variables: tracked changes are drawn in their authors' colors, and find's
matches in yellow and orange (`Mark` and `Highlight` in forced colors; not printed).

## Where to set the variables

The stylesheet declares the defaults on `:root` (and `:host`). Set your values on an element
that holds the editor: everything inside inherits them. `FoliEditor` renders no element of its
own around its toolbar and pages, so wrap it:

```tsx
import { FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";

export const ThemedEditor = () => (
  <div className="acme-editor">
    <FoliEditor />
  </div>
);
```

The toolbar's menus and dialogs, the find panel and the comments pane are rendered inside it (no
portals), so they take the theme too. To theme one part only, set the variables on
`.foli-toolbar` or `.foli-canvas` (both take a `className`; with toolbar tabs the toolbar's
`className` is on `.foli-ribbon`, around the tabs and the toolbar).

Do not set them on `:root`: the stylesheet's own `:root` rule has the same specificity, so
whichever loads last wins.

## A complete theme

Every variable, on the wrapper above:

```css
.acme-editor {
  --foli-canvas-background: #e9edf2;
  --foli-page-background: #ffffff;
  --foli-page-shadow: 0 1px 3px rgb(16 24 40 / 0.12);
  --foli-page-gap: 16px;
  --foli-text-color: #111827;
  --foli-selection-color: rgb(14 116 144 / 0.25);
  --foli-border-color: #d0d7e2;
  --foli-toolbar-background: #f8fafc;
  --foli-toolbar-color: #111827;
  --foli-toolbar-hover: #e2e8f0;
  --foli-toolbar-pressed: #cdeaf0;
  --foli-focus-ring: #0e7490;
  --foli-error-color: #b42318;
}
```

Check the contrast of what you pick: the toolbar's text on its background, hover and pressed
colors, and the focus ring against the toolbar and the canvas (WCAG asks 4.5:1 for text and 3:1
for the focus indicator). `--foli-page-gap` and the shadow change only the look; the pages keep
their size.

## The ribbon's parts

The status bar, the right-click menu, the mini toolbar and the Styles gallery (1.11) take the
toolbar's tokens (`--foli-toolbar-background`, `--foli-toolbar-color`, `--foli-border-color`,
`--foli-toolbar-hover`, `--foli-toolbar-pressed`, `--foli-focus-ring`): set them where the editor
is (around `FoliEditor`), not only on `.foli-toolbar`, and they follow. The gallery's tiles keep
`--foli-page-background` and `--foli-text-color`, as the page does: they show text as it will
look. Formatting marks are drawn in `--foli-formatting-marks`.

## Dark

Pages are paper. A Word document's colors are chosen for a white page: headings in a theme
color, black text set as a color, tables shaded light. Darkening the pages leaves that text as it
is. So the safer dark theme darkens everything around the pages and keeps the pages light:

```css
@media (prefers-color-scheme: dark) {
  .acme-editor {
    --foli-canvas-background: #15181d;
    --foli-page-shadow: 0 0 0 1px #2b313b;
    --foli-border-color: #2b313b;
    --foli-toolbar-background: #1d2128;
    --foli-toolbar-color: #e5e7eb;
    --foli-toolbar-hover: #2b313b;
    --foli-toolbar-pressed: #164e63;
    --foli-focus-ring: #67c6dc;
    --foli-error-color: #f97066;
    --foli-ribbon-contextual: #d6a8f0;
  }
  /* The comments pane draws its threads in the page colors, but this line on the canvas. */
  .acme-editor .foli-comments-empty {
    color: #e5e7eb;
  }
}
```

To darken the pages too, add:

```css
@media (prefers-color-scheme: dark) {
  .acme-editor {
    --foli-page-background: #2a2a28;
    --foli-text-color: #e8e8e4;
    --foli-selection-color: rgb(110 160 255 / 0.35);
  }
}
```

Only text without a color of its own turns light; check your documents. With a theme switch in
the app instead of the media query, put the same rules under the switch's selector
(`.acme-editor[data-theme="dark"]`).

## Print

The view prints one sheet per page at its section's size, and the stylesheet drops the canvas,
shadows, toolbar and panels in print ([styling.md](../styling.md#print)). The variables still
apply to the printed pages: a theme with dark pages prints dark pages. Reset them:

```css
@media print {
  .acme-editor {
    --foli-page-background: #ffffff;
    --foli-text-color: #000000;
  }
  .acme-editor .acme-todo {
    background: none;
  }
}
```

Hide in print whatever your extensions draw that is not part of the document (decorations such
as the `acme-todo` marks below). Print-only CSS must not change fonts, sizes or line heights: the
printed lines would no longer match the computed page breaks. `@folijs/pdf`'s `exportPdf` uses
the same print rules but none of your CSS, unless you pass it in `styles`.

## Forced colors

In forced-colors mode (Windows High Contrast) the browser replaces colors with the user's system
colors and drops backgrounds. The stylesheet already marks pressed toolbar buttons and the find
panel's current tab with a `Highlight` outline, keeps color swatches in their colors, and the
view draws find's matches in `Mark` and `Highlight`.

Your theme's variables have no effect there, which is intended. What you add must not rely on a
background alone. Give such content a border or outline, which forced colors keep:

```css
@media (forced-colors: active) {
  .acme-editor .acme-mention,
  .acme-editor .acme-todo {
    outline: 1px solid CanvasText;
  }
}
```

Do not set `forced-color-adjust: none` on content: it keeps your colors where the user asked
for theirs.

## Extension content

Node views, mark views and decorations put classes and attributes on what they draw; the view
adds no rules for them ([extensions](extensions.md)). The app's CSS gives them their look, for the
classes the extension guide uses:

```css
.acme-editor .acme-mention {
  padding: 0 4px;
  border-radius: 4px;
  background: #e0f2f7;
  color: #0b4f5f;
}
.acme-editor .acme-topic {
  text-decoration: underline dotted #0e7490;
}
.acme-editor .acme-card {
  border: 1px solid var(--foli-border-color);
  border-radius: 6px;
}
.acme-editor .acme-todo {
  background: #fff3bf;
}
```

The pages measure extension content as they measure text: a rule that changes a size (padding,
font size, a border's width) re-flows the pages. For marks that come and go, such as a caret's
paragraph or search hits, prefer backgrounds, outlines and `box-shadow`, which change no size.
