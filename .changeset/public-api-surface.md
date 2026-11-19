---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
"@folijs/docx": minor
"@folijs/pdf": minor
---

The public API is now listed by name (ADR-0008). `@folijs/core`'s entry exports each public name
explicitly; what the other Foli packages need from core without a promise moved to a second
entry, `@folijs/core/internal` (the Word context and envelope: `wordContext`, `withEnvelope`,
`setComments`, `StoryStep`, `CommentStep`, `EnvelopeStep`; the formatting resolver: `Resolver`,
`formatNumber`, `tableConditions` and their types; clipboard fitting: `copiedDefinitions`,
`fitPaste`, `fitPastedV2`; layout helpers; `schema`, `checkSection`, `checkControl`,
`RUN_PROPERTY_MARKS`), and a few helpers left the API (`defaultTextblockType`, `isNote`,
`storyBody`). Every other module export is tagged `@internal` and left out of the published
types. `@folijs/view` exports `BlockOptions`, the type of `renderDocument`'s options.
`@folijs/view`, `@folijs/react`, `@folijs/docx` and `@folijs/pdf` now take `@folijs/core` (and
`@folijs/react` also `@folijs/view`) as a peer dependency at exactly their own version instead of
a dependency: install the Foli packages together, at one version (npm 7+ and pnpm install peers
themselves).
