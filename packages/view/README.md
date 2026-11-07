# @foli/view

The editable view of [Foli](https://github.com/josep-audenis/foli), without a framework: renders
a `@foli/core` editor into an element as real pages and turns keyboard, IME, clipboard and
mouse input into editor commands. For React, use [`@foli/react`](https://www.npmjs.com/package/@foli/react).

> Pre-release: the API may change in any 0.x version.

```bash
npm install @foli/view @foli/core
```

```ts
import { createDocument, createEditor } from "@foli/core";
import { EditorView } from "@foli/view";

const editor = createEditor({ document: createDocument() });
const host = document.getElementById("editor")!;
host.classList.add("foli-content"); // the default theme's selection color
host.setAttribute("aria-label", "Document");
const view = new EditorView(host, editor, { placeholder: "Start writing…" });
// later: view.destroy();
```

The view sets page size and margins from the document settings; the page look (background,
shadow, gap, fonts) comes from your CSS or a copy of
[`@foli/react`'s `styles.css`](https://github.com/josep-audenis/foli/blob/main/packages/react/styles.css).

- [Getting started](https://github.com/josep-audenis/foli/blob/main/docs/getting-started.md#using-the-view-without-react)
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#foliview)
- [Styling](https://github.com/josep-audenis/foli/blob/main/docs/styling.md)
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
