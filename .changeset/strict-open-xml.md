---
"@folijs/docx": minor
---

Strict Open XML documents (Word's "Strict Open XML Document") are read and written back Strict:
each XML part is translated to Transitional names and values as it is read and back as it is
written, so the model and the XML kept verbatim stay Transitional (`DocxPackage.conformance`
says which a package is). A Strict document saved as JSON and exported without its package comes
out Transitional. A part whose root is `mc:AlternateContent` is read as Word reads it: the branch
it understands, the documents in that branch joined; what is left out is in `report.dropped`.
Headers, footers, notes, comments, styles, numbering and settings with such a root are read the
same way; a footnotes or endnotes part with one no longer makes export throw "A note reference
has no note". Other unknown roots are still refused, and the message now names the root.
