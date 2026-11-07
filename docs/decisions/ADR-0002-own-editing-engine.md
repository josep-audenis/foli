# ADR-0002: Foli owns its editing engine

- **Status:** Accepted
- **Date:** 2026-11-04
- **Supersedes:** [ADR-0001](ADR-0001-editor-foundation.md)

## Context

ADR-0001 chose Tiptap/ProseMirror to move fast. The project goal has since been sharpened:
Foli is an **independent document-editing engine**, designed around native pagination from day
one, with its own document model, transactions, view and layout.

Tiptap is not a replaceable UI layer. It supplies the document model, transactions, schema and
extension system. Building the MVP on it and removing it later would mean rewriting nearly
everything, so we stop now, while the codebase is a skeleton.

## Decision

1. **No editor-engine dependencies at runtime.** Not allowed in any published package:
   ProseMirror, Tiptap, Lexical, Slate, Quill, CKEditor, Draft.js, Editor.js, or similar.
   General-purpose libraries (testing, build, parsing, zip/XML, fonts) remain allowed under the
   normal license policy.
2. **Learn from existing engines, reimplement in our own code.** Reading ProseMirror, Lexical,
   CodeMirror etc. is encouraged. Copying code is the exception: allowed only for permissively
   licensed, well-understood pieces, recorded in `THIRD_PARTY_NOTICES.md` (source, commit,
   license, what was changed) with the original notices kept.
3. **DOM rendering, not canvas.** Text is rendered as real DOM inside a single `contenteditable`
   host, so we keep browser text shaping, IME, spellcheck, autocorrect and accessibility. Foli
   owns the mapping between DOM and model; the DOM is never the source of truth. Whether one
   paragraph can be rendered as **fragments on two pages** inside that host is the core bet and
   is validated by a spike before the view is built (Phase 1 → ADR-0003). Fallback: hidden
   input element + Foli-rendered DOM (Monaco-style), at the cost of native spellcheck.
4. **Model design** (concepts proven by ProseMirror, implemented by us):
   - Immutable node tree with structural sharing; marks on inline content.
   - Integer positions over the whole document; resolved positions for tree context.
   - Every change is a **step** that can be applied, inverted and can **map positions**.
     Mapping keeps undo, selections, cursor positions across reflow and future collaboration
     correct.
   - The persisted JSON shape stays `{ type, attrs, content, text, marks }`.
5. **TypeScript is the single source of truth** for the model and transactions. Rust/WASM is
   for off-the-keystroke-path processing (DOCX, batch transforms, server pipelines) and must
   consume the same JSON format. No duplicate transaction logic in two languages.
6. **Package boundaries** start small: `@folijs/core` (model, transactions; no DOM),
   `@folijs/view` (DOM rendering, input, selection, layout), `@folijs/react`. More packages only
   when a boundary has proven itself in code.

## Consequences

- Much slower start. Rough planning ranges (part-time, AI-assisted, constrained scope):
  basic editor 1–3 months, reliable rich text 6–12+ months, credible paginated editor
  12–24+ months. Estimates, not commitments.
- We own the hardest problems: IME (especially Android and Safari), clipboard from office
  apps, selection edge cases, accessibility, browser quirks. Each needs its own tests.
- Pagination can be designed into the view and layout instead of retrofitted.
- Rust can become a real part of the platform for document processing.
- Architecture gates (see [roadmap](../roadmap.md)) stop us from building features on a
  foundation that fails the five core editing tests.
