---
"@folijs/core": minor
"@folijs/docx": minor
---

Text boxes in the model (schema 10, ADR-0016): a `textBox` node, a floating anchor like a
picture (size, position, wrapping, fill, line, insets), its text a story of kind `textBox`
that goes with it. `@folijs/docx` reads Word's DrawingML and VML text boxes and writes them
back: unchanged byte for byte, edited text into both copies, a changed box into its drawing in
place. A picture whose position or wrapping changed is now written into its own drawing too,
keeping its effects and ids. Documents with text boxes need this release to be read.
