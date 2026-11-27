---
"@folijs/core": minor
"@folijs/docx": minor
---

Shapes in the model (schema 11, ADR-0017): a `shape` node, a floating anchor like a picture,
with DrawingML's geometry (a preset with its adjust values, or a custom geometry's paths), turn,
flips, fill or gradient, line with dashes and arrow ends, and text as a story of kind `textBox`.
`@folijs/docx` reads Word's shapes (a theme's style as plain colors) and writes them back:
unchanged byte for byte, a changed one into its own drawing, a new one as DrawingML. Layout
Options, Size and Arrange work on shapes. Documents with shapes need this release to be read.
