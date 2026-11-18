# What Word makes of content controls (11.9): opens every .docx of -In read-only through COM, accepts
# its tracked changes in memory and writes <name>.json to -Out: whether it opened, and each control
# of the main text (type, tag, title, placeholder shown, text, id, locks, check box state, list
# entries, date format). Used by control-roundtrip.mjs; closes only what it opened.
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force $Out | Out-Null
function Clean([string]$text) {
  $text = $text.Replace([string][char]0x0B, "`n")
  return ($text -replace "[\x00-\x08\x0C-\x1F]", "").TrimEnd("`r", "`n")
}
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.AutomationSecurity = 3
  $word.DisplayAlerts = 0
  foreach ($file in Get-ChildItem -LiteralPath $In -Filter *.docx) {
    $result = [ordered]@{ opened = $false; error = $null; controls = @() }
    $doc = $null
    try {
      $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
      $result.opened = $true
      if ($doc.Revisions.Count -gt 0) { $doc.Revisions.AcceptAll() }
      $controls = New-Object System.Collections.Generic.List[object]
      foreach ($control in $doc.ContentControls) {
        $type = [int]$control.Type
        $entries = @()
        if ($type -eq 3 -or $type -eq 4) { foreach ($e in $control.DropdownListEntries) { $entries += "$($e.Text)|$($e.Value)" } }
        $controls.Add([ordered]@{
            type = $type
            tag = [string]$control.Tag
            title = [string]$control.Title
            placeholder = [bool]$control.ShowingPlaceholderText
            text = Clean $control.Range.Text
            id = [string]$control.ID
            lockContents = [bool]$control.LockContents
            lockControl = [bool]$control.LockContentControl
            checked = if ($type -eq 8) { [bool]$control.Checked } else { $null }
            entries = $entries
            dateFormat = if ($type -eq 6) { [string]$control.DateDisplayFormat } else { $null }
          })
      }
      $result.controls = $controls.ToArray()
    } catch {
      $result.error = $_.Exception.Message.Replace([string]$file.FullName, $file.Name)
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} }
    }
    $json = ($result | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText([string](Join-Path $Out ($file.BaseName + ".json")), $json + "`n", $utf8)
    Write-Output "$($file.Name): $(if ($result.opened) { "$($result.controls.Count) controls" } else { "NOT opened: $($result.error)" })"
  }
}
finally {
  try {
    if ($word.Documents.Count -eq 0) { $word.Quit() }
    else { $word.Visible = $true; Write-Warning "Word left open: it holds documents this script did not open" }
  } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
