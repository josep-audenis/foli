---
"@folijs/core": minor
"@folijs/docx": minor
---

Envelope changes are steps (22.3, ADR-0012): `withEnvelope` keeps its signature and makes an `EnvelopeStep` for each entry of the envelope it changes (one style, numbering definition, resource, control's properties or setting; the section, defaults and theme whole), with the value before and after. They travel as JSON to other editors, a transaction whose step no longer finds its `before` is refused, and **undo now takes a style, list definition, resource or control added with an edit back with it** (before, it stayed). The tracking switch is the document's: `settings.trackRevisions` (schema 7, `SCHEMA_VERSION` is 7), written by `setTrackChanges` (kept out of undo) and read by the editor (its `trackChanges` option holds while the document says nothing) and by `exportDocx` when no `trackRevisions` option is given; `importDocx` puts it in for a Word file that tracks changes. A document holding it is saved as schema 7, which 1.5 and earlier refuse; others keep the lowest schema their content needs (5 or 6).
