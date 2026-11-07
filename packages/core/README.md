# @foli/core

The document model and headless editing engine of [Foli](https://github.com/josep-audenis/foli):
document format and validation, schema, transactions, undo history and commands. No DOM: runs
in the browser, Node and workers.

> Pre-release: the API may change in any 0.x version.

```bash
npm install @foli/core
```

```ts
import { createDocument, createEditor, parseDocument } from "@foli/core";

const text = JSON.stringify(createDocument()); // stand-in for a saved document
const doc = parseDocument(JSON.parse(text)); // throws FoliDocumentError on invalid input
const editor = createEditor({ document: doc });
editor.subscribe((_state, transactions) => {
  if (transactions.some((tr) => tr.docChanged)) console.log("content changed");
});
editor.select(1); // inside the first paragraph
editor.commands.toggleMark("bold"); // the next typed text is bold
editor.commands.insertText("Hello");
const saved = JSON.stringify(editor.getDocument());
```

To show and edit a document in the browser, use [`@foli/react`](https://www.npmjs.com/package/@foli/react)
or [`@foli/view`](https://www.npmjs.com/package/@foli/view).

- [Document format](https://github.com/josep-audenis/foli/blob/main/docs/document-model.md)
- [API reference](https://github.com/josep-audenis/foli/blob/main/docs/api.md#folicore)
- [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md)

MIT
