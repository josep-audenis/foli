---
"@folijs/mcp": patch
---

A save no longer writes over the file another open document came from: it is refused, naming the other document. Before, saving a first document beside its file after opening that saved copy as a second document lost the second's saved edits.
