# Word as the reference for review content (9.8): opens each .docx in Microsoft Word through COM
# automation and records its tracked changes and comments as Word reads them.
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 `
#     -In <folder> -Out <folder> [-Edit <folder>]
#
# For every document in -In it writes <name>.json to -Out:
#   - opened: whether Word opened it, and if not the error (a damaged file is refused: Word
#     repairs only with a person at the dialog);
#   - revisions: every tracked change, in Word's order: its type (Word's WdRevisionType number),
#     author and text;
#   - comments: every comment: its text, author, initials, the index of the comment it answers
#     (-1 for none) and whether it is resolved (done);
#   - accepted / rejected: the main text's paragraphs (text, and whether in a table) after
#     accepting, and after rejecting, every change.
# With -Edit, Word also edits a copy of each document there, as a reviewer would, saved as
# <name>-word.docx: tracked changes on, "Word edit. " typed at the start of the first paragraph,
# and a reply ("Word reply.") to the first comment, if any. The author is Word's user name.
#
# Read only for -In: documents are opened read-only (edited copies too: saved as new files, never
# over an existing one), macros disabled, closed without saving; Word's settings are not changed.
# Windows with desktop Word only. Documents other than the corpus: -Out and -Edit outside the
# repository (the JSON holds their text); -Edit never -In or inside it.

param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Edit = ""
)

$ErrorActionPreference = "Stop"
$root = [string](Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$corpus = [string](Resolve-Path (Join-Path $root "corpus\word"))
$In = [string](Resolve-Path $In)
$isCorpus = $In -eq $corpus
$full = { param($path) $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path).TrimEnd("\") }
$inside = { param($path, $folder) ($path + "\").StartsWith($folder + "\", [StringComparison]::OrdinalIgnoreCase) }
$Out = & $full $Out
# The JSON holds the documents' text, the edited copies the documents: other documents' data
# never lands in the repository.
if (-not $isCorpus -and (& $inside $Out $root)) {
  throw "-Out must be outside the repository for documents other than the corpus (the JSON holds their text)"
}
if ($Edit) {
  $Edit = & $full $Edit
  if (-not $isCorpus -and (& $inside $Edit $root)) {
    throw "-Edit must be outside the repository for documents other than the corpus"
  }
  # Copies never go next to the documents: nothing there is overwritten or read again.
  if (& $inside $Edit $In) { throw "-Edit must not be -In or a folder inside it" }
}
New-Item -ItemType Directory -Force $Out | Out-Null
if ($Edit) { New-Item -ItemType Directory -Force $Edit | Out-Null }
$utf8 = New-Object System.Text.UTF8Encoding $false
$INFO_IN_TABLE = 12

function Clean([string]$text) {
  $text = $text.Replace([string][char]0x0B, "`n").Replace([string][char]0x1E, [string][char]0x2011)
  return ($text -replace "[\x00-\x08\x0C-\x1F]", "").TrimEnd("`r", "`n")
}

function Scrub([string]$message, $file) {
  # Word's messages name the file with its full path (a user folder): keep only the message.
  foreach ($path in @($file.FullName, $file.DirectoryName, $In, $Edit)) {
    if ($path) { $message = $message -replace [regex]::Escape($path), "" }
  }
  $message = $message -replace '(?:[A-Za-z]:|\\\\)\\[^\s)]*', "" -replace '\(\s*\)', ""
  return ($message -replace '\s+', ' ').Trim()
}

function Paragraphs($doc) {
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($p in $doc.Paragraphs) {
    $range = $p.Range
    $inTable = [bool]$range.Information($INFO_IN_TABLE)
    # A table row's end mark: in a table but in no cell; not a w:p in the file.
    if ($inTable -and $range.Cells.Count -eq 0) { continue }
    $list.Add([ordered]@{ text = (Clean $range.Text); inTable = $inTable })
  }
  return , $list.ToArray()
}

function Open($word, [string]$path, [bool]$readOnly) {
  # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument: a wrong password
  # fails instead of waiting on a hidden dialog.
  return $word.Documents.Open($path, $false, $readOnly, $false, "foli-no-password")
}

$word = New-Object -ComObject Word.Application
$failed = 0
try {
  $word.AutomationSecurity = 3   # msoAutomationSecurityForceDisable: no macros
  $word.Visible = $false
  $word.DisplayAlerts = 0
  foreach ($file in @(Get-ChildItem -Path $In -Filter *.docx -File | Sort-Object Name)) {
    $result = [ordered]@{
      document = $file.Name
      word = [string]$word.Build
      opened = $false
      error = $null
      revisions = @()
      comments = @()
      accepted = @()
      rejected = @()
    }
    $doc = $null
    try {
      $doc = Open $word ([string]$file.FullName) $true
      $result.opened = $true
      $revisions = New-Object System.Collections.Generic.List[object]
      foreach ($r in $doc.Revisions) {
        $revisions.Add([ordered]@{ type = [int]$r.Type; author = [string]$r.Author; text = (Clean $r.Range.Text) })
      }
      $result.revisions = $revisions.ToArray()
      $comments = New-Object System.Collections.Generic.List[object]
      $all = @($doc.Comments)
      foreach ($c in $all) {
        $parent = -1
        try {
          $ancestor = $c.Ancestor
          if ($ancestor) {
            for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i].Range.Start -eq $ancestor.Range.Start -and $all[$i].Range.End -eq $ancestor.Range.End) { $parent = $i } }
          }
        } catch {}
        $comments.Add([ordered]@{
            text = (Clean $c.Range.Text)
            author = [string]$c.Author
            initials = [string]$c.Initial
            parent = $parent
            done = [bool]$c.Done
          })
      }
      $result.comments = $comments.ToArray()
      $doc.TrackRevisions = $false
      $doc.Revisions.AcceptAll()
      $result.accepted = Paragraphs $doc
      $doc.Close(0)
      $doc = Open $word ([string]$file.FullName) $true
      $doc.TrackRevisions = $false
      $doc.Revisions.RejectAll()
      $result.rejected = Paragraphs $doc
    } catch {
      $result.error = Scrub $_.Exception.Message $file
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    if ($result.opened -and $result.error) {
      $failed++
      Write-Output "$($file.Name): FAILED: $($result.error)"
      continue
    }
    $json = ($result | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
    $state = if ($result.opened) { "opened, $($result.revisions.Count) revisions, $($result.comments.Count) comments" } else { "NOT opened: $($result.error)" }
    Write-Output "$($file.Name): $state"

    if ($Edit -and $result.opened) {
      $copy = $null
      $target = [string](Join-Path $Edit ($file.BaseName + "-word.docx"))
      try {
        if (Test-Path -LiteralPath $target) { throw "$($file.BaseName)-word.docx already exists in -Edit: not overwritten" }
        # Read-only: the document itself is never changed; the edit is saved as a new file.
        $copy = Open $word ([string]$file.FullName) $true
        $copy.TrackRevisions = $true
        $first = $copy.Paragraphs.First.Range
        $first.Collapse(1)   # wdCollapseStart
        $first.InsertAfter("Word edit. ")
        if ($copy.Comments.Count -gt 0) {
          $topic = $copy.Comments.Item(1)
          $topic.Replies.Add($topic.Scope, "Word reply.") | Out-Null
        }
        # FileName, FileFormat (wdFormatXMLDocument)
        $copy.SaveAs2($target, 12)
        Write-Output "$($file.Name): edited by Word"
      } catch {
        $failed++
        Write-Output "$($file.Name): Word edit FAILED: $(Scrub $_.Exception.Message $file)"
      } finally {
        if ($copy) { try { $copy.Close(0) } catch {} }
      }
    }
  }
}
finally {
  try {
    if ($word.Documents.Count -eq 0) { $word.Quit() }
    else { $word.Visible = $true; Write-Warning "Word left open: it holds documents this script did not open" }
  } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
if ($failed -gt 0) { exit 1 }
