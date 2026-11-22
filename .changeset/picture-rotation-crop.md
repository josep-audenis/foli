---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/docx": minor
---

Schema 6: a picture's `rotation` (60 000ths of a degree) and `crop` (`left`, `top`, `right`,
`bottom`, 1000ths of a percent), read from `.docx`, drawn and written back. Documents are saved
with the lowest schema their content needs: one without a rotated or cropped picture still says
5, which 1.0 to 1.3 read; one with them says 6, which they refuse (as a newer document).
`SCHEMA_VERSION` is 6 and `FoliDocument["schemaVersion"]` is `5 | 6`.
