# What Word makes of documents after find and replace and with bookmarks (11.11): opens every .docx
# of -In read-only through COM and writes <name>.json to -Out: whether it opened, the text of each
# story as it stands (a tracked change's two sides both in it), with every change accepted and with
# every change rejected, how many changes each story has, and the bookmarks with their text.
# Used by find-roundtrip.mjs; closes only what it opened.
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force $Out | Out-Null
function Clean([string]$text) { return ($text -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", "") }
# Word's story types: main text, footnotes, endnotes, then the six kinds of header and footer.
$kinds = @{ 1 = "main"; 2 = "footnote"; 3 = "endnote"; 6 = "header"; 7 = "header"; 8 = "footer"; 9 = "footer"; 10 = "header"; 11 = "footer" }
function Stories($doc) {
  $out = [ordered]@{ main = ""; footnote = ""; endnote = ""; header = ""; footer = "" }
  $changes = [ordered]@{ main = 0; footnote = 0; endnote = 0; header = 0; footer = 0 }
  foreach ($first in $doc.StoryRanges) {
    $range = $first
    while ($range) {
      $kind = $kinds[[int]$range.StoryType]
      if ($kind) {
        $out[$kind] += (Clean $range.Text) + "`n"
        $changes[$kind] += [int]$range.Revisions.Count
      }
      $range = $range.NextStoryRange
    }
  }
  return @{ text = $out; changes = $changes }
}
# One Word per file: a crash in one leaves the others their own reading.
foreach ($file in Get-ChildItem -LiteralPath $In -Filter *.docx) {
  # Word's server can go away under load, with other Words about: read again before believing it.
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
  $result = [ordered]@{ opened = $false; error = $null; stories = $null; changes = $null; accepted = $null; rejected = $null; bookmarks = @() }
  $word = New-Object -ComObject Word.Application
  $doc = $null
  $step = "open"
  try {
    $word.Visible = $false
    $word.AutomationSecurity = 3
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
    $result.opened = $true
    $step = "read"
    $now = Stories $doc
    $result.stories = $now.text
    $result.changes = $now.changes
    $marks = New-Object System.Collections.Generic.List[object]
    foreach ($mark in $doc.Bookmarks) {
      $marks.Add([ordered]@{ name = [string]$mark.Name; story = [int]$mark.StoryType; text = (Clean ([string]$mark.Range.Text)) })
    }
    $result.bookmarks = $marks.ToArray()
    $step = "accept"
    if ($doc.Revisions.Count) { $doc.Revisions.AcceptAll() }
    foreach ($first in $doc.StoryRanges) { $r = $first; while ($r) { if ($r.Revisions.Count) { $r.Revisions.AcceptAll() }; $r = $r.NextStoryRange } }
    $result.accepted = (Stories $doc).text
    $step = "reopen"
    $doc.Close([ref]0)
    $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
    $step = "reject"
    if ($doc.Revisions.Count) { $doc.Revisions.RejectAll() }
    foreach ($first in $doc.StoryRanges) { $r = $first; while ($r) { if ($r.Revisions.Count) { $r.Revisions.RejectAll() }; $r = $r.NextStoryRange } }
    $result.rejected = (Stories $doc).text
  } catch {
    $result.error = "$step`: " + $_.Exception.Message.Replace([string]$file.FullName, $file.Name)
  } finally {
    try { if ($doc) { $doc.Close([ref]0) } } catch {}
    try { if ($word.Documents.Count -eq 0) { $word.Quit([ref]0) } } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  }
  if (-not $result.error -or $result.error -notmatch "0x800706BA|0x800706BE") { break }
  }
  $json = ($result | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
  Write-Output "$($file.Name): $(if ($result.error) { "ERROR $($result.error)" } else { "read" })"
}
