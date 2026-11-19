# ADR-0008's spike, Word's side: opens every .docx of -In through COM, writes <name>.json to -Out
# (whether it opened, and each content control: type, tag, text, locks), types "Word edit. " at the
# start of the document and saves it as <name>.docx in -Out (Word's own file). Used by
# src/word.test.ts; closes only what it opened.
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force $Out | Out-Null
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.AutomationSecurity = 3
  $word.DisplayAlerts = 0
  foreach ($file in Get-ChildItem -LiteralPath $In -Filter *.docx) {
    $result = [ordered]@{ opened = $false; error = $null; version = [string]$word.Version; controls = @() }
    $doc = $null
    try {
      # Paths go to Word as [string] (see scripts/corpus/build-word-corpus.ps1).
      $doc = $word.Documents.Open([string]$file.FullName, $false, $false, $false, "foli-no-password")
      $result.opened = $true
      $controls = New-Object System.Collections.Generic.List[object]
      foreach ($control in $doc.ContentControls) {
        $controls.Add([ordered]@{
            type = [int]$control.Type
            tag = [string]$control.Tag
            text = [string]$control.Range.Text
            lockContents = [bool]$control.LockContents
          })
      }
      $result.controls = $controls.ToArray()
      $start = $doc.Range(0, 0)
      $start.InsertBefore("Word edit. ")
      # FileName, FileFormat (wdFormatXMLDocument)
      $doc.SaveAs2([string](Join-Path $Out $file.Name), 12)
    } catch {
      $result.error = $_.Exception.Message.Replace([string]$file.FullName, $file.Name)
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    $json = ($result | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
    Write-Output "$($file.Name): $(if ($result.opened) { "$($result.controls.Count) controls, saved by Word" } else { "NOT opened: $($result.error)" })"
  }
}
finally {
  try {
    if ($word.Documents.Count -eq 0) { $word.Quit() }
    else { $word.Visible = $true; Write-Warning "Word left open: it holds documents this script did not open" }
  } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
