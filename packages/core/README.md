# @foli/core

The document model and headless editing engine of [Foli](https://github.com/josep-audenis/foli):
document format and validation, schema, transactions, undo history and commands. No DOM: runs
in the browser, Node and workers.

> Pre-release: the API may change in any 0.x version.

```bash
npm install @foli/core
```

```ts
import { createEditor, parseDocument } from "@foli/core";

const doc = parseDocument(JSON.parse(saved)); // throws FoliDocumentError on invalid input
const editor = createEditor({ document: doc });
editor.select(1);
editor.commands.insertText("Hello ");
editor.commands.toggleMark("bold");
editor.subscribe((state, transactions) => {
  if (transactions.some((tr) => tr.docChanged)) console.log("changed");
});
const json = JSON.stringify(editor.getDocument());
```

To show and edit a document in the browser, use [`@foli/react`](https://www.npmjs.com/package/@foli/react)
or [`@foli/view`](https://www.npmjs.com/package/@foli/view).

- [Document format](https://github.com/josep-audenis/foli/blob/main/docs/document-model.md)
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folicore)
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
