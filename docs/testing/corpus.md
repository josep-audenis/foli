# The corpus run

How Foli is checked against real Word files (Phase 20, [ADR-0011](../decisions/ADR-0011-external-corpus.md)),
and how to run the same checks over your own files. The latest results are in
[corpus-report.md](../corpus-report.md).

## The external corpus

About 3 500 test documents of Apache POI, LibreOffice, docx4j, python-docx and the Open XML
SDK, at the commits `corpus/external.json` pins (with each file's SHA-256). They are never
committed: `pnpm corpus:fetch` downloads them into `.corpus-cache/` (ignored), checks every hash,
and refuses a file that does not match.

```bash
pnpm build                # the checks use the built packages
pnpm corpus:fetch         # once; again after the manifest changes
pnpm corpus:run           # the Node pass: about 5 minutes of work, on up to 6 worker threads
pnpm corpus:render        # the renderer pass in Chromium, over the files the last run imported
```

`pnpm corpus:fetch --update` moves the pins to each project's current commit and rewrites the
manifest (all or nothing).

## A private folder

In PowerShell:

```powershell
pnpm build
pnpm corpus:run "C:\path\to\your\docx"
$env:FOLI_CORPUS_RESULTS = ".corpus-cache/results/<run>.jsonl"; pnpm corpus:render
```

Every `.docx` under the folder is checked; files with the same bytes once. Nothing leaves the
machine, and the results hold no document text: counts, element and attribute names, error
messages cut short, and the files' paths and names (so the `.jsonl` itself is for you, not for an
issue; the summary is safe to share).

## What each file goes through

In a worker thread (120 s, 2 GB heap; a file that hangs or kills its worker is tried once more,
then recorded as such):

1. **Import**: refused with a reason (`DocxError`, `ZipError`), or a crash.
2. **Export with no edit**, compared with the file part by part: binary parts byte for byte, XML
   parts by their elements and attribute values (prefixes and order aside) and each paragraph's
   text with every character's formatting, as Word reads it (see the report's introduction for
   what is not counted).
3. **A second import** of the export, compared with the first.
4. **An edit**: one character typed at the document's start, exported and read back.

The renderer pass lays out every imported file with `renderDocument` in Chromium: pages, time,
page errors, and pages whose content overflows the sheet.

## Word on a sample

On Windows with Word: `node scripts/corpus/word-sample.mjs export <run>.jsonl <dir>` copies a
sample and Foli's exports to `<dir>` (outside the repository), `word-reference.ps1` measures each
half in Word, and `word-sample.mjs compare <dir>` lists what Word measured differently (the
script's header has the commands).

## Reading the results

`.corpus-cache/results/<time>.jsonl` has a line per distinct file; `<time>.summary.json` counts
the outcomes and the classes of difference ("element lost: w:hyperlink", "second import differs
at /content/content", …), each with how many files show it. To see one file's details:

```bash
node -e "import('./scripts/corpus/check.mjs').then(async m => console.log(JSON.stringify(await m.checkFile(new Uint8Array(require('fs').readFileSync(process.argv[1]))), null, 2)))" <file.docx>
```

## Reporting

A file Foli gets wrong: the issue template "A .docx Foli reads, writes or shows wrongly". Attach
the file only if it may be public; otherwise a reduced copy, or the file's result line from the
`.jsonl` with its `path` and `names` removed.
