---
"@folijs/react": minor
---

Comments pane: resolved threads leave the margin for an Open / Resolved switch (the comment
history, with Reopen and Delete). `mentions` suggests people after `@` in a comment or reply and
links the pick to `mailto:` their address; `onMention({ comment, people })` tells the app whom a
saved comment newly tags. `FoliEditor` passes both. A focused thread's text no longer stays
outlined after it is resolved, deleted or split across pages.
