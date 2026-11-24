---
"@folijs/collab": minor
---

`createHub(authority)` and `connect(editor, options)`: the messages between an authority and its clients, and the client loop (one batch in flight, every broadcast checked against the editor's version, catching up after a gap or a `stale` refusal, presence sent and shown), so an app only carries JSON messages over its own transport.
