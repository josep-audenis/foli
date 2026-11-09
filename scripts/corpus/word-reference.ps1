# Word as the reference (ADR-0005): opens each .docx in Microsoft Word through COM automation and
# records what Word does with it, for Foli to be compared against.
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
#     [-In corpus/word] [-Out corpus/reference/word] [-PdfDir <folder>]
#
# For every document in -In it writes <name>.json to -Out:
#   - opened: whether Word opened it, and if not the error (a damaged file is refused: Word
#     repairs only with a person at the dialog);
#   - revisionsAccepted: tracked changes in the document. All are accepted (in memory) before
#     measuring, so the numbers describe the final text whatever the user's markup view;
#   - pages: Word's page count;
#   - paragraphs: for every paragraph of the main text, in Word's order (table cells included,
#     end-of-row marks not): its text, the page and the line on that page where it starts, the
#     page where it ends, its list number as Word shows it ("1.1", "(a)"), and whether it is in a
#     table.
# With -PdfDir it also exports Word's PDF of each document there (also the final text).
# Exits 1 if a document opened but could not be measured; its earlier JSON is then kept.
#
# Read only: documents are opened read-only, macros disabled, and closed without saving; Word's
# settings are not changed. Windows with desktop Word only. Private documents: -In their folder
# requires -Out, outside the repository (the JSON holds their text).

param(
  [string]$In = "",
  [string]$Out = "",
  [string]$PdfDir = ""
)

$ErrorActionPreference = "Stop"
# Paths go to Word as [string]: PowerShell 5.1 passes a Join-Path result as a wrapped object,
# and Word then waits forever (see build-word-corpus.ps1).
$root = [string](Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$corpus = [string](Resolve-Path (Join-Path $root "corpus\word"))
if (-not $In) { $In = $corpus }
$In = [string](Resolve-Path $In)
$isCorpus = $In -eq $corpus
# The JSON holds the documents' text: other documents' data never lands in the repository.
if (-not $Out) {
  if (-not $isCorpus) { throw "-Out is required with -In (the JSON holds the documents' text): a folder outside the repository" }
  $Out = Join-Path $root "corpus\reference\word"
}
$Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out).TrimEnd("\")
if (-not $isCorpus -and ($Out + "\").StartsWith($root + "\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "-Out must be outside the repository for documents other than the corpus (the JSON holds their text)"
}
New-Item -ItemType Directory -Force $Out | Out-Null
if ($PdfDir) {
  New-Item -ItemType Directory -Force $PdfDir | Out-Null
  $PdfDir = [string](Resolve-Path $PdfDir)
}

# WdInformation
$INFO_PAGE = 3          # wdActiveEndPageNumber (physical page, not the displayed number)
$INFO_LINE = 10         # wdFirstCharacterLineNumber
$INFO_IN_TABLE = 12     # wdWithInTable
$PDF = 17               # wdExportFormatPDF
$utf8 = New-Object System.Text.UTF8Encoding $false

function Clean([string]$text) {
  # Line breaks and non-breaking hyphens are text; paragraph marks, cell markers, optional
  # hyphens and fields' control characters are not.
  $text = $text.Replace([string][char]0x0B, "`n").Replace([string][char]0x1E, [string][char]0x2011)
  return ($text -replace "[\x00-\x08\x0C-\x1F]", "").TrimEnd("`r", "`n")
}

function Scrub([string]$message, $file) {
  # Word's messages name the file with its full path (a user folder): keep only the message.
  foreach ($path in @($file.FullName, $file.DirectoryName, $In)) {
    $message = $message -replace [regex]::Escape($path), ""
  }
  $message = $message -replace '(?:[A-Za-z]:|\\\\)\\[^\s)]*', "" -replace '\(\s*\)', ""
  return ($message -replace '\s+', ' ').Trim()
}

$word = New-Object -ComObject Word.Application
$failed = 0
try {
  # This instance only, not saved: macros in the documents (or a template they point to) never run.
  $word.AutomationSecurity = 3   # msoAutomationSecurityForceDisable
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $files = @(Get-ChildItem -Path $In -Filter *.docx -File | Sort-Object Name)
  foreach ($file in $files) {
    $result = [ordered]@{
      document = $file.Name
      word = [string]$word.Build
      opened = $false
      error = $null
      revisionsAccepted = $null
      pages = $null
      paragraphs = @()
    }
    $doc = $null
    try {
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument: Word would wait
      # forever on a hidden password dialog; a wrong password fails instead.
      $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
      $result.opened = $true
      $result.revisionsAccepted = [int]$doc.Revisions.Count
      $doc.TrackRevisions = $false
      if ($result.revisionsAccepted -gt 0) { $doc.Revisions.AcceptAll() }
      $doc.Repaginate()
      $result.pages = $doc.ComputeStatistics(2)   # wdStatisticPages
      $list = New-Object System.Collections.Generic.List[object]
      foreach ($p in $doc.Paragraphs) {
        $range = $p.Range
        $inTable = [bool]$range.Information($INFO_IN_TABLE)
        # A table row's end mark: in a table but in no cell (Information(wdAtEndOfRowMarker) does
        # not tell it on a paragraph's range). Not a w:p in the file.
        if ($inTable -and $range.Cells.Count -eq 0) { continue }
        $first = $range.Characters.First
        $list.Add([ordered]@{
            text = Clean $range.Text
            page = [int]$first.Information($INFO_PAGE)
            line = [int]$first.Information($INFO_LINE)
            endPage = [int]$range.Information($INFO_PAGE)
            listString = [string]$range.ListFormat.ListString
            inTable = $inTable
          })
      }
      $result.paragraphs = $list.ToArray()
      if ($PdfDir) { $doc.ExportAsFixedFormat([string](Join-Path $PdfDir ($file.BaseName + ".pdf")), $PDF) }
    } catch {
      $result.error = Scrub $_.Exception.Message $file
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    if ($result.opened -and $result.error) {
      # Opened but not measured: a harness failure, not data. Any earlier JSON is kept.
      $failed++
      Write-Output "$($file.Name): FAILED: $($result.error)"
      continue
    }
    $json = ($result | ConvertTo-Json -Depth 4) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
    $state = if ($result.opened) { "opened, $($result.pages) pages, $($result.paragraphs.Count) paragraphs, $($result.revisionsAccepted) revisions accepted" } else { "NOT opened: $($result.error)" }
    Write-Output "$($file.Name): $state"
  }
}
finally {
  # Documents still open are not ours (Windows can hand a file the user opens to this instance):
  # leave them to the user instead of closing them unsaved.
  try {
    if ($word.Documents.Count -eq 0) { $word.Quit() }
    else { $word.Visible = $true; Write-Warning "Word left open: it holds documents this script did not open" }
  } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
if ($failed -gt 0) { exit 1 }
