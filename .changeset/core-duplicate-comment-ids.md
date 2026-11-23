---
"@folijs/core": patch
---

`parseDocument` refuses a document whose comments repeat an id (`comments[i].id: N is the id of an earlier comment`): editing or resolving one by id changed the other. `importDocx` renumbers such comments, so a `.docx` with them still opens.
