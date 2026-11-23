---
"@folijs/agent": minor
---

The tools come with the package (23.1, ADR-0013): `agentTools(session)` gives a model loop each tool's name, description and JSON Schema, and a `run` that checks the arguments and answers in words; `AGENT_TOOLS` are the same over any session, `INSTRUCTIONS` what to tell the model once, `READ_LIMIT` the blocks `read` gives by default. `invalid` and the `JsonSchema` types moved here from `@folijs/mcp`, which re-exports the types.
