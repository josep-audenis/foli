---
"@folijs/mcp": patch
---

A save no longer writes over the file another open document came from, or one another document saved since (even after it was closed): a save with a path there is refused, naming the other document, and a save without one takes the next free name. Before, saving a first document beside its file after opening that saved copy as a second document lost the second's saved edits.
