# Example: a custom node

An app's own node type, `acme:mention`, declared by an extension (ADR-0008): its attributes are
validated when a document loads, it is drawn by a node view (a chip, built with `h`, never from
HTML), it is one caret position, and it is undone, copied, pasted and saved like Word's own
content. A toolbar button runs the command that inserts one. The API:
[Custom nodes and marks](../../../../docs/api.md#custom-nodes-and-marks) and
[View extensions](../../../../docs/api.md#view-extensions).

Put the caret somewhere and press **Insert mention** in the toolbar.
