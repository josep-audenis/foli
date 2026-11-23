---
"@folijs/core": minor
---

Steps have a JSON form (22.2): `step.toJSON()` and `Step.fromJSON(schema, json)` for every step of `@folijs/core` (`ReplaceStep`, `ReplaceAroundStep`, `AddMarkStep`, `RemoveMarkStep`, `NodeMarkupStep`, `NodeMarkupBatchStep`, `CommentStep`, `EnvelopeStep`, `StoryStep`), and `Step.jsonID(stepType, parse)` for an extension's own. `fromJSON` reads untrusted input (it is what collaboration reads from the network): an unknown step type or key, a position that is not a non-negative integer, a slice, mark, attribute, comment, story or envelope value the schema refuses throws `FoliDocumentError` with the JSON path. `Schema.sliceFromJSON` takes a `gap` position, where a gap replace's slice may hold an unfilled wrapper.
