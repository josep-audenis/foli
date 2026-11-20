# 1.0: decisions for the owner

Prepared in roadmap task 12.11 (2026-11-20) so the owner can decide quickly; folded into the
roadmap, `limitations.md` and the 1.0.0 release notes and deleted in 12.12. Items 1 and 2 are
open; 3 and 4 were decided by the owner on 2026-11-20.

## 1. Known limitations: block 1.0 or ship as known limits (open)

From [limitations.md](limitations.md). Effort: S (a day or less), M (a few days), L (a week or
more), XL (a phase). Only the ones that could plausibly block are listed; the rest are edge cases
or documented trade-offs.

| Limitation                                                                                                                    | Impact                                                                                                    | Effort | Recommendation                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Pictures copied to another document lose their images (the resources stay behind)                                             | Copy and paste between two documents drops content silently (the picture's box comes, its image does not) | S-M    | **Fix before 1.0**: the copy already carries its definitions; carry the used resources too |
| Keystroke and first layout slower than the Phase 5 targets at 100 pages                                                       | Typing in long documents; see 2                                                                           | -      | See 2                                                                                      |
| No virtualization: every page is in the DOM and laid out on load                                                              | Documents of several hundred pages load slowly (200 pages: about 240 ms in Chromium)                      | L      | Ship as a known limit; a 1.x minor can add it                                              |
| Charts, shapes, text boxes, equations, linked images stay opaque (kept, not editable)                                         | Such Word documents open and round-trip but these parts cannot be edited                                  | XL     | Ship; 1.x minors may model them (the format point, 4)                                      |
| Right-to-left text: line measurement assumes left to right; arrows next to opaque blocks too                                  | Arabic and Hebrew documents may break pages at the wrong line                                             | L      | Ship, stated plainly as not supported in 1.0                                               |
| Some Android keyboards insert paragraphs without the needed events (the edit is discarded with a warning); Backspace in lists | Mobile editing; untested on devices                                                                       | M-L    | Ship as a known limit (mobile is not a 1.0 target), or block if it is                      |
| While tracking: table structure (columns, merges), table styles, picture resizing refused                                     | Reviewers cannot make those edits with tracking on (refused, not lost)                                    | M      | Ship                                                                                       |
| Autofit tables keep Word's saved widths; table styles count cells, not grid columns                                           | Some tables look different from Word after edits                                                          | M      | Ship                                                                                       |
| Fields: `IF`, `STYLEREF`, formulas and some switches keep their stored result                                                 | Those results go stale until Word updates them                                                            | M      | Ship                                                                                       |
| HTML paste: images dropped, tables become paragraphs; drag and drop of text does nothing                                      | Pasting from web pages and other apps is basic                                                            | M      | Ship                                                                                       |
| A Content Security Policy without `'unsafe-inline'` styles hides the placeholder and breaks print sheets                      | Apps with a strict CSP                                                                                    | M      | Ship, documented in styling.md                                                             |
| Comments pane is React only                                                                                                   | Framework-free apps build their own                                                                       | M      | Ship                                                                                       |
| Server rendering gives the shell, not the content                                                                             | No SEO for documents                                                                                      | -      | Ship (an editor)                                                                           |
| A tracked paragraph typed into after its mark was deleted keeps its properties on accept (found in 12.11)                     | A paragraph style can differ from doing the same edits untracked, in a rare sequence                      | S-M    | Ship as a known limit (listed); Word's own behavior not checked                            |

## 2. Performance: does the keystroke and first-layout cost block 1.0? (open)

Findings (details and method in [benchmarks.md](benchmarks.md), "Against earlier numbers" and
"Investigated in 12.11"):

- 12.7 measured, against 0.2.0 at 100 pages in Chromium: handler 3.3-3.5×, first layout and
  re-flow about 2.2×, paint p95 about 2×; mostly Phase 8 (the Word model).
- 12.11 profiled it. Top cause of a keystroke: the view redraws every page (`renderPages`, about
  70% of the handler), nearly half of which was list numbering resolving every paragraph's whole
  style cascade on every change. **Fixed** (only numbered paragraphs are resolved; `FoliComments`
  no longer scans a document without comments): handler p50 11.4 → 8.9 ms (type) and 12.9 →
  9.9 ms (Enter) at 100 sections, about -20% at 200, measured on a machine running other work
  (the unchanged layout and PDF metrics came out 13-33% slower than the baseline in the same run,
  so the real gain is likely nearer a third). The target was ≤ 8 ms.
- Still above the targets: first layout 110-125 ms (target ≤ 60), re-flow 131-158 ms (≤ 100),
  Enter's paint p95 32-38 ms (≤ 25). The first layout is mostly the browser's own layout of 100
  pages (about 40%), then building the model (about 20%) and the paragraphs' DOM.
- Options, not built (estimated): redraw only the pages from the edited block on (-3 to -5 ms a
  key; M, risky in `renderPages`' bookkeeping); reuse unchanged nodes' JSON when an app reads
  `change.document` on every change (-2 to -3 ms a key for such apps; M); fewer forced layouts when
  writing the selection (-1 to -2 ms; M); page virtualization (first layout roughly halved for
  long documents; L-XL, pages still need measuring).

**Recommendation:** do not block 1.0. Typing stays within a frame at 100 pages (handler about
9 ms, typing's paint p95 about 17-18 ms in Chromium); the first layout of a 100-page document in
about a tenth of a second is acceptable for an editor. Record the targets as missed in the
release notes, keep the baseline catching regressions, and take the incremental redraw in a 1.x
minor.

## 3. ADR-0003 manual checks (decided 2026-11-20)

The owner accepted the manual checks (IME and dead keys on real platforms, screen readers, macOS
keys, real pastes, Safari) again as known 1.0 risks instead of running them, as for 0.1-0.6:
recorded in [ADR-0003](decisions/ADR-0003-rendering-and-input.md#release-10-with-the-manual-checks-open-decided-2026-11-20)
and [limitations.md](limitations.md#not-verified-by-hand); the 1.0.0 release notes list them.

## 4. ADR-0008's format point (decided 2026-11-20)

The owner accepted that a 1.x minor may add a schema version (only by adding, with a migration),
and that a document is saved with the lowest version its content needs (never below v5): recorded
in [ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md#the-saved-format) and
[deprecation.md](deprecation.md#saved-documents). Nothing to build for 1.0: v5 is the only 1.x
version so far, and the fixtures of 12.11 (`packages/core/fixtures/formats/`) check that every
0.x format loads and saves.

## Also for the owner

- [security.md](security.md) points reporters to GitHub's private vulnerability reporting:
  check that it is enabled on the repository (Settings → Code security), or name another channel.
