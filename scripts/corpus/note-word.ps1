# What Word makes of notes (11.10): opens every .docx of -In read-only through COM and writes
# <name>.json to -Out: whether it opened, and for footnotes and endnotes the number style, starting
# number, numbering rule and location Word reads, with each note's text. Numbers themselves Word
# gives only on its pages. Used by story-roundtrip.mjs; closes only what it opened.
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force $Out | Out-Null
function Clean([string]$text) { return ($text -replace "[\x00-\x1F]", "").Trim() }
function Notes($collection) {
  $texts = New-Object System.Collections.Generic.List[string]
  foreach ($note in $collection) { $texts.Add((Clean $note.Range.Text)) }
  return [ordered]@{
    numberStyle = [int]$collection.NumberStyle
    startingNumber = [int]$collection.StartingNumber
    numberingRule = [int]$collection.NumberingRule
    location = [int]$collection.Location
    texts = $texts.ToArray()
  }
}
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.AutomationSecurity = 3
  $word.DisplayAlerts = 0
  foreach ($file in Get-ChildItem -LiteralPath $In -Filter *.docx) {
    $result = [ordered]@{ opened = $false; error = $null; footnotes = $null; endnotes = $null }
    $doc = $null
    try {
      $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
      $result.opened = $true
      $result.footnotes = Notes $doc.Footnotes
      $result.endnotes = Notes $doc.Endnotes
    } catch {
      $result.error = $_.Exception.Message.Replace([string]$file.FullName, $file.Name)
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    [System.IO.File]::WriteAllText(
      (Join-Path $Out ($file.BaseName + ".json")),
      ($result | ConvertTo-Json -Depth 5),
      $utf8
    )
  }
} finally {
  if ($word.Documents.Count -eq 0) { $word.Quit() }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
