# ADR-0018: Equations as OMML in an `equation` node, edited in their linear form (schema 12)

- **Status:** Accepted when merged, task 35.5 (2026-11-28), by an agent's review, as the owner
  asked for Phase 35 (one PR per task, reviewed, merged).
- **Context:** until Phase 35 an equation (`m:oMath`, `m:oMathPara`) was an `opaqueInline`
  holding its OMML. 35.4 drew it: the view turns OMML into MathML, which the browser lays out on
  the pages, in print and in `exportPdf`, and find reads its characters. Word edits an equation
  in place, as a tree of math zones, and offers its linear format (UnicodeMath, ISO/IEC TR
  50.2) as another way to type one: `x=(-b±√(b^2-4ac))/2a` builds up to the quadratic formula.
  An editor engine for math (MathQuill, MathLive) is not wanted (ADR-0002), and a full
  structural equation editor is larger than this phase.

## Decision

1. **An `equation` node holds the OMML.** An inline atom with `xml`: the `m:oMath` (in its
   line) or `m:oMathPara` (a display equation, on a line of its own) element, as the file has it
   or as Foli wrote it, checked to be one of those two elements. `@folijs/docx` reads an
   equation into it and writes `xml` back as it is: an equation nobody edited comes back byte
   for byte (as the corpus's `13-equations.docx` shows). The view draws it as 35.4 drew the
   opaque one; find sees its characters and never replaces them.
2. **Edited in its linear form.** The view reads Word's linear format into OMML as Word writes
   it (`unicodeMathToOmml`: fractions, scripts, roots, n-ary operators with limits,
   delimiters, binomials, matrices, functions, Word's invisible brackets and `\name` symbols;
   each run in Cambria Math, neighbouring characters in one run) and writes OMML back as that
   format (`ommlToUnicodeMath`) for the box. Own parser and writer, no dependency. Editing
   replaces the whole `xml`; an equation whose linear form did not change keeps its OMML.
3. **Commands:** `insertEquation(xml)` at the selection (then selected) and `setEquation(pos,
   xml)`, one undo step each, refused while tracking changes (Word tracks an equation's runs
   one by one). Deleting or pasting a whole equation while tracking is tracked as the whole
   node (`w:del` or `w:ins` around its `m:oMath`), which ECMA-376 allows; a deleted equation is
   selected first, as Word's.
   React's Insert ▸ Equation offers Word's gallery (its nine built-in equations, by their linear
   forms), Insert New Equation… and Edit Equation… (the Equation dialog: the linear form, the
   equation drawn as it will show, Display).
4. **Schema 12.** An `equation` needs it; a document saying 11 or less holding one is refused.
   v11 → v12 changes the version only: an equation an earlier release kept opaque stays so
   until the `.docx` is imported again.
5. **Checked against Word.** Word 16 opens Foli's new equations (the gallery's and typed ones)
   as equations (`OMaths`, inline and display as written). Their structure is checked against
   Word's own: the quadratic formula Foli builds from Word's linear form has the elements of the
   corpus's (Word-made) one, and the gallery's binomials, factorials and scripts are built as
   Word builds them (`unicodemath.test.ts`).

## Options rejected

- **Keeping equations opaque and editing the opaque node's XML:** the model would not say what
  the node is, and every caller would have to sniff the XML.
- **A structural math model (nodes for fractions, scripts…) edited in place:** what Word does,
  and right for a later phase; far larger, and every OMML element Word writes would have to be
  modelled or kept, where one verbatim `xml` keeps them all.
- **An editor engine for math, or a UnicodeMath library:** ADR-0002 rules out the first; no
  maintained, licensed UnicodeMath-to-OMML converter was found that fits, and the subset Word's
  gallery and ordinary equations use is small.

## Consequences

- An edited equation loses what the linear form does not say: per-run formatting inside it,
  `m:argPr`, alignment marks, Word's own run properties (written anew in Cambria Math).
- Equations in the agent's reading show as `[equation: …]` with their characters; the agent
  does not edit them.
