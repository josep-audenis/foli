# Security

What Foli checks, where, and what stays the embedding app's job. Reviewed for 1.0 (roadmap
12.11, 2026-11-20).

## Threat model

Foli runs in the user's browser tab (the editor, the view, `exportPdf`) and in Node or a
browser (`@folijs/core`, `@folijs/docx`). Untrusted input reaches it as:

- **Pasted data**: HTML from any page, Foli's own clipboard JSON (which a hostile page can
  forge), plain text.
- **Documents**: Foli JSON (`parseDocument`, `setDocument`, `initialContent`) and `.docx` files
  (`importDocx`), possibly uploaded by someone other than the user who opens them.
- **Links and pictures** inside either.

What an attacker wants: script running in the app's origin (XSS), requests the user did not
mean to make (tracking, credential leaks), or a crash or hang (denial of service) of a tab or a
server that imports `.docx` or prints PDFs. Extension code (node views, plugins, decorations) is
the app's own code and is trusted; it is checked against mistakes, not against an attacker.

## What is checked where

| Input                        | Where                                                   | What                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foli JSON                    | `parseDocument`, `parseContent` (core `v3/document.ts`) | Every node, mark and attribute validated against the schema; unknown keys refused; nesting depth limited; later-version content refused; never repaired or dropped silently (`FoliDocumentError`)                                                                                            |
| Pasted HTML                  | view `clipboard.ts` (`readHTML`)                        | Parsed with `DOMParser` into an inert document, never inserted; only mapped tags kept; colors parsed; links kept only when `isSafeHref`                                                                                                                                                      |
| Foli clipboard JSON          | `data-foli-clipboard` in the HTML, core `wordclip.ts`   | Read with `getAttribute` only from a lone wrapper; content through `parseContent` with the editor's schema, styles and notes through `parseDocument` (`fitPaste`); unsafe links dropped when the copy names no definitions                                                                   |
| Links                        | core `isSafeHref` (`schema.ts`), the view, `exportPdf`  | `http:`, `https:`, `mailto:`, `tel:` or relative; control characters, spaces and backslashes refused (`java\tscript:`). The view keeps a link as `data-href` and opens only a safe one; copied HTML and PDF link annotations carry only safe absolute ones                                   |
| `.docx` zip                  | docx `zip.ts`                                           | At most 10 000 entries and 512 MiB uncompressed (`ZipLimits`); a declared size deflate cannot produce refused; duplicate (case-insensitive) and overlapping entries refused; encrypted, ZIP64 and other methods refused; inflating stops at the declared size; part names never touch a disk |
| `.docx` XML                  | docx `xml.ts`, `package.ts`                             | DTDs and entities refused (no XXE, no entity expansion); nesting at most 1000 (`maxDepth`); at most 1 000 000 elements across the parts read (`maxElements`, 12.11); invalid characters and encodings refused                                                                                |
| `.docx` relationships        | docx import                                             | External targets are never fetched; hyperlink targets are kept as written (lossless) and filtered where opened, as above                                                                                                                                                                     |
| Pictures                     | core `checkResource`, view `blocks.ts`                  | A resource's `data` must be an image `data:` URL; `url` must be a safe web URL. Drawn only through `<img>` (an SVG's scripts do not run there), with `referrerpolicy="no-referrer"`                                                                                                          |
| `exportPdf`                  | pdf `index.ts`                                          | The document is validated with `parseDocument`; the print page has a Content Security Policy blocking every network request; pictures only from `data:` URLs                                                                                                                                 |
| Node views, decorations, `h` | view `extension.ts` (12.4)                              | Elements from an allowlist (no script, SVG, forms or frames); `on*` handlers, `srcdoc`, `contenteditable` and the view's `data-foli-*` refused; URL attributes and `srcset` through `isSafeHref`; `style` without `url(`, `expression`, `@import` or escapes                                 |
| Docs site markdown           | `apps/site/src/docs/build.ts`                           | Raw HTML shown as text; links and images other than `http`, `https`, `mailto` or relative rendered as text; search results built with `textContent`                                                                                                                                          |

No package uses `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`
with document or pasted data (the clipboard reads back markup it built itself).

## The app's responsibility

- **A Content Security Policy** on the page hosting the editor. Without `img-src` limits a
  document's web pictures load when shown (a tracking pixel is possible); pass the view's
  `resource` option to decide which URLs load.
- **Limits on a server.** `importDocx` and `exportPdf` run in the caller's process: give an
  uploaded `.docx` a size limit before reading it, lower `maxSize` and `maxElements` to what
  your documents need, and run imports with a time limit in a worker or a separate process. The
  defaults bound memory to about 1.5 GB in the worst case (1 000 000 empty paragraphs, about 6 s),
  not to what a shared server can afford.
- **Fetching resources** in a `resource` or `resources` callback is the app's code: check the
  URL there (server-side request forgery).
- **Exported `.docx` from untrusted JSON is untrusted.** Opaque XML and field codes are written
  as they are (well-formed, never re-parsed as markup); a field such as `INCLUDEPICTURE` with a
  network path can make Word fetch it when fields update, as any `.docx` can.
- **Extensions** are trusted code: what a node view's `render` returns is not checked, and `h`
  allows `id`, `name` and `position: fixed`, which can clash with the host page.

## Residual risks (known, accepted for 1.0)

- Pasted data has no size limit: a huge paste slows only the user's own tab.
- A Foli copy carrying definitions keeps its links as written (as a `.docx` import does); every
  place that opens a link filters it.
- Web pictures are fetched when shown unless the app says otherwise (above).

## Reporting a vulnerability

Please do not open a public issue. Report it privately through the repository's GitHub
security advisories ("Security" → "Report a vulnerability"), with the input that triggers it and
the package versions. Fixes are released as patches of the affected packages and listed in their
changelogs.
