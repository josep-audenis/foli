# Clipboard HTML fixtures

`text/html` as each source puts it on the clipboard, used by `src/clipboard.test.ts`.

These files are **hand-written approximations** of each source's format. They reproduce the
traits the parser must handle: Word's `MsoNormal` classes, `<o:p>`, `mso-list:Ignore` and
conditional comments, and its list paragraphs with levels and number markers (`word-lists.html`);
Google Docs' `<b style="font-weight:normal">` wrapper, styled spans, and its lists with a list
nested directly in a list, `start`, links styled by spans, and alignment
(`google-docs-lists.html`);
LibreOffice's `<font>` and `western` classes; a browser copy with scripts and images. They are
not captures. Replace or extend them with real captures (paste into a page that logs
`event.clipboardData.getData("text/html")`) while running the manual checks in
[docs/testing/ime.md](../../../../docs/testing/ime.md).
