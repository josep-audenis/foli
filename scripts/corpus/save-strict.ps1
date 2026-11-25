# Saves the synthetic Word corpus (corpus/word/*.docx) as Strict Open XML through Microsoft Word
# (Phase 28, ADR-0014). For each document it writes two files to corpus/word/strict/, from the
# same open document so they differ only by the format Word wrote:
#   <name>.strict.docx        wdFormatStrictOpenXMLDocument (24)
#   <name>.transitional.docx  wdFormatDocumentDefault (16), the Strict file's twin
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/save-strict.ps1
#
# Each document is opened from a copy in the temp folder, read-write (a read-only open makes Word
# record DocSecurity 4 in the Transitional save), macros disabled. Word records who saved a file
# (lastModifiedBy): for the run Word's user is the corpus's fictional author, and the user's own
# name is restored at the end (kept in the same file as build-word-corpus.ps1, so an interrupted
# run of either is restored by the next). Windows with desktop Word only.

$ErrorActionPreference = "Stop"
# Paths go to Word as [string]: PowerShell 5.1 passes a Join-Path result as a wrapped object,
# and Word then waits forever (see build-word-corpus.ps1).
$root = [string](Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$in = [string](Join-Path $root "corpus\word")
$out = [string](Join-Path $in "strict")
New-Item -ItemType Directory -Force $out | Out-Null
$FORMAT_DOCX = 16
$FORMAT_STRICT = 24

$word = New-Object -ComObject Word.Application
$savedUser = $null
try {
  $word.AutomationSecurity = 3   # msoAutomationSecurityForceDisable
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $userFile = Join-Path ([System.IO.Path]::GetTempPath()) "foli-corpus-word-user.txt"
  if (Test-Path $userFile) {
    $savedUser, $savedInitials, $savedUseLocal = Get-Content $userFile -Encoding UTF8
    $savedUseLocal = $savedUseLocal -eq "True"
  } else {
    $savedUser = $word.UserName
    $savedInitials = $word.UserInitials
    $savedUseLocal = [bool]$word.Options.UseLocalUserInfo
    Set-Content $userFile @($savedUser, $savedInitials, "$savedUseLocal") -Encoding UTF8
  }
  $word.Options.UseLocalUserInfo = $true
  $word.UserName = "Legal Department"
  $word.UserInitials = "LD"
  $scratch = [string](Join-Path ([System.IO.Path]::GetTempPath()) "foli-save-strict")
  New-Item -ItemType Directory -Force $scratch | Out-Null
  foreach ($file in @(Get-ChildItem -Path $in -Filter *.docx -File | Sort-Object Name)) {
    $base = [string]$file.BaseName
    $copy = [string](Join-Path $scratch $file.Name)
    Copy-Item $file.FullName $copy -Force
    $doc = $word.Documents.Open($copy, $false, $false, $false, "foli-no-password")
    try {
      foreach ($pair in @(@("transitional", $FORMAT_DOCX), @("strict", $FORMAT_STRICT))) {
        $path = [string](Join-Path $out "$base.$($pair[0]).docx")
        if (Test-Path $path) { Remove-Item $path }
        $doc.SaveAs2($path, $pair[1])
      }
    } finally {
      $doc.Close(0)
      Remove-Item $copy -ErrorAction SilentlyContinue
    }
    Write-Output "wrote $base"
  }
} finally {
  if ($null -ne $savedUser) {
    try {
      $word.UserName = $savedUser
      $word.UserInitials = $savedInitials
      $word.Options.UseLocalUserInfo = $savedUseLocal
      Remove-Item $userFile -ErrorAction SilentlyContinue
    } catch { Write-Warning "Could not restore Word's user settings: $_ (the next run restores them)" }
  }
  try { $word.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
