---
"@folijs/mcp": minor
---

Code mode: started with `--code`, the server has a `run` tool that takes a JavaScript script over an open document, for a task that is the same step on many blocks. The script runs in a sandbox (QuickJS as WebAssembly, in a thread of its own, with limits on time, memory and calls) and sees only `doc`, the operations the other tools have. Every edit is a tracked change; a script that throws or is stopped changes nothing. Off by default.
