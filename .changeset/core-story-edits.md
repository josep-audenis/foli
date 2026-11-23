---
"@folijs/core": minor
---

An edit inside a header, footer or note is now a `StoryEditStep` of the story's own steps (22.4, ADR-0012) instead of a `StoryStep` replacing the story whole: two edits of one story map over each other as edits of the body do, an undo maps over a change of its story made outside history instead of being dropped, and an open story editor keeps its caret where it was when another editor's edit of the story arrives. `StoryStep` stays for creating, removing and replacing a story.
