---
"@folijs/mcp": minor
---

An open document may grow about 16 million characters, as it would be saved, past what it was when opened: a tool call or a `run` that would pass it is taken back and refused, so a session cannot make a document too large to save. Before, a document crafted for it could make one `update_fields` call (2,000 cross-references to heavily formatted text) end the server at the next save.
