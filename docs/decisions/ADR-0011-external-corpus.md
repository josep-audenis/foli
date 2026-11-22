# ADR-0011: The external corpus: real .docx files, fetched, never committed

- **Status:** Accepted when merged, task 20.1 (2026-11-22), by an agent's review, as the owner
  asked for Phase 20 ("go iteratively through all of them").
- **Context:** every check of import and export so far ran on the nine synthetic documents of
  `corpus/word/`, written by Word for the features each phase built. Real files carry what nobody
  wrote them for: other writers, old Word versions, damaged or odd structures. Phase 20 runs
  import → export → compare over a large set of them.

## Decision

**Sources.** The test documents of open-source projects that publish theirs, each at a commit
pinned in `scripts/corpus/fetch.mjs` and recorded in `corpus/external.json`:

| Source       | Repository                   | What                                                | License (file)                | Files |
| ------------ | ---------------------------- | --------------------------------------------------- | ----------------------------- | ----: |
| poi          | `apache/poi`                 | `test-data/`                                        | Apache-2.0 (`legal/LICENSE`)  |   181 |
| libreoffice  | `LibreOffice/core`           | `sw/qa/extras/ooxmlexport/data`, `ooxmlimport/data` | MPL-2.0 (`COPYING.MPL`)       | 1 540 |
| docx4j       | `plutext/docx4j`             | every `.docx` (core tests, sample documents)        | Apache-2.0 (`legals/LICENSE`) | 1 365 |
| python-docx  | `python-openxml/python-docx` | every `.docx` (test files)                          | MIT (`LICENSE`)               |    46 |
| open-xml-sdk | `dotnet/Open-XML-SDK`        | every `.docx` (test assets)                         | MIT (`LICENSE`)               |   419 |

Counts are the pinned trees' `.docx` blobs (2026-11-22, none over the 25 MB cap: the largest is 2.96 MB); the manifest has
what was fetched. Many come from those projects' bug reports: documents people attached to show
a reader failing, which is what this run is for. The licenses are the repositories'; nothing of
them is redistributed by Foli.

**Never committed.** `pnpm corpus:fetch` downloads the files into `.corpus-cache/` (ignored) from
`raw.githubusercontent.com` at the pinned commit and checks each against the SHA-256 the manifest
records; a file that differs is deleted and reported, never run. `--update` lists the pinned
trees again (GitHub's API; `GITHUB_TOKEN` for its rate limit) and rewrites the manifest: done
when a source's commit is moved, in a PR of its own. A file over 25 MB is left out. Paths are
checked before any request: plain names in their source's folder of the cache. 106 of the
files are copies of others (3 445 distinct by hash, mostly LibreOffice's export and import
folders): the run counts each content once.

**Reports hold no document text.** What the run writes (results, `docs/corpus-report.md`)
holds counts, element and attribute names, file names and sizes, never text from a document: the
files are public, but a private folder is run the same way by its owner, and a report must be
safe to paste into an issue. The results files (`.corpus-cache/results/*.jsonl`) stay on the
machine that ran them: they also hold each file's local path, for the renderer pass to find it.
Error messages are the code's, capped (200 characters) but not rewritten: one that quotes a
document's content is a bug to fix where it is thrown, as 20.2 did for the XML parser's.

**What the run checks, and how a difference is classed** (20.2, 20.3): each file in a worker
thread with a time limit and a heap cap (a worker that dies or times out is that file's failure,
recorded, and the run goes on): import (refused with a `DocxError` and its message, or not; any
other exception is a crash); the import report (opaque and dropped elements, unmodeled values);
export without edits compared part by part with the file, its XML canonicalized (namespace
prefixes, attribute order, whitespace Word does not read) so that only a real difference counts,
each classed as a part lost or added, content lost, a value changed, or order only; a second
import of the export equal to the first; an edit then an export accepted by `importDocx` and the
schema; the read-only renderer in Chromium (an exception, a page whose content overflows its
sheet); times per step. Word, on the owner's Windows machine, opens a sample (20.6).

**Not in `pnpm check`.** The run takes long and needs the network once; it is `pnpm corpus:run`,
run by hand or by an agent, its report committed.

## Consequences

- A loss found in a third-party file is fixed with a reduced fixture written for it (by hand, or
  by `build-word-corpus.ps1`): the third-party file itself is never committed.
- Moving a source's commit changes the set: the report says which manifest it ran on.
- The run depends on GitHub serving those commits; the manifest's hashes make a changed file
  visible rather than silently different.
