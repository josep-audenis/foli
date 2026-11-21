---
"@folijs/agent": minor
---

`session.checkpoint()`: marks the document as it is; `rollback()` takes back every edit made since (no tracked change left of them, every handle naming the block it named), `release()` keeps them. For a batch of operations that must all be done or none. One insert now takes 500 paragraphs at most, and one `replaceText` with `all` 500 places, and one replace, `fillControl` or `updateFields` writes 300,000 characters at most, its places together (a merge value counts once per merge field of its name): more is refused.
