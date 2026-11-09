# Word as the reference (ADR-0005): opens each .docx in Microsoft Word through COM automation and
# records what Word does with it, for Foli to be compared against.
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
#     [-In corpus/word] [-Out corpus/reference/word] [-PdfDir <folder>]
#
# For every document in -In it writes <name>.json to -Out:
#   - opened: whether Word opened it without complaint (under automation Word refuses a file it
#     would have to repair, so false means "Word would offer to repair it"), and the error;
#   - pages: Word's page count;
#   - paragraphs: for every paragraph of the main text, in Word's order (table cells included):
#     its text (control characters removed), the page and the line on that page where it starts,
#     the page where it ends, its list number as Word shows it ("1.1", "(a)"), and whether it is
#     in a table.
# With -PdfDir it also exports Word's PDF of each document there.
#
# Read only: documents are opened read-only and closed without saving; Word's settings are not
# changed. Windows with desktop Word only. Private documents: point -In at their folder and -Out
# outside the repository.

param(
  [string]$In = "",
  [string]$Out = "",
  [string]$PdfDir = ""
)

$ErrorActionPreference = "Stop"
# Paths go to Word as [string]: PowerShell 5.1 passes a Join-Path result as a wrapped object,
# and Word then waits forever (see build-word-corpus.ps1).
$root = [string](Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $In) { $In = Join-Path $root "corpus\word" }
if (-not $Out) { $Out = Join-Path $root "corpus\reference\word" }
$In = [string](Resolve-Path $In)
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = [string](Resolve-Path $Out)
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
  # Paragraph marks, cell markers, fields' control characters: not text.
  return ($text -replace "[\x00-\x08\x0B-\x1F]", "").TrimEnd("`r", "`n")
}

$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $files = @(Get-ChildItem -Path $In -Filter *.docx -File | Sort-Object Name)
  foreach ($file in $files) {
    $result = [ordered]@{
      document = $file.Name
      word = [string]$word.Build
      opened = $false
      error = $null
      pages = $null
      paragraphs = @()
    }
    $doc = $null
    try {
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles
      $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false)
      $result.opened = $true
      $doc.Repaginate()
      $result.pages = $doc.ComputeStatistics(2)   # wdStatisticPages
      $list = New-Object System.Collections.Generic.List[object]
      foreach ($p in $doc.Paragraphs) {
        $range = $p.Range
        $first = $range.Characters.First
        $list.Add([ordered]@{
            text = Clean $range.Text
            page = [int]$first.Information($INFO_PAGE)
            line = [int]$first.Information($INFO_LINE)
            endPage = [int]$range.Information($INFO_PAGE)
            listString = [string]$range.ListFormat.ListString
            inTable = [bool]$range.Information($INFO_IN_TABLE)
          })
      }
      $result.paragraphs = $list.ToArray()
      if ($PdfDir) { $doc.ExportAsFixedFormat([string](Join-Path $PdfDir ($file.BaseName + ".pdf")), $PDF) }
    } catch {
      # Word's message names the file with its full path (a user folder): keep only the message.
      $result.error = (($_.Exception.Message -replace '\s*\([A-Za-z]:\\[^)]*\)', '') -replace '\s+', ' ').Trim()
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    $json = ($result | ConvertTo-Json -Depth 4) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
    $state = if ($result.opened) { "opened, $($result.pages) pages, $($result.paragraphs.Count) paragraphs" } else { "NOT opened: $($result.error)" }
    Write-Output "$($file.Name): $state"
  }
}
finally {
  try { foreach ($d in @($word.Documents)) { $d.Close(0) } } catch {}
  try { $word.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
