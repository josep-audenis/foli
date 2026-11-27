# Word as the reference (ADR-0005): opens each .docx in Microsoft Word through COM automation and
# records what Word does with it, for Foli to be compared against.
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
#     [-In corpus/word] [-Out corpus/reference/word] [-PdfDir <folder>]
#
# For every document in -In it writes <name>.json to -Out:
#   - opened: whether Word opened it, and if not the error (a damaged file is refused: Word
#     repairs only with a person at the dialog);
#   - comments: how many comments the document has;
#   - revisionsAccepted: tracked changes in the document. All are accepted (in memory) before
#     measuring, so the numbers describe the final text whatever the user's markup view;
#   - pages: Word's page count;
#   - pictures: each picture of the main text (inline, then floating ones): page, position and
#     size in points (an inline one from the page's corner; a floating one from what it is
#     relative to, recorded, or its alignment when aligned), alt text, and a floating one's
#     wrapping (WdWrapType);
#   - textBoxes: each text box of the main text (Phase 33; msoTextBox shapes): page, anchor
#     paragraph, position and size in points as for floating pictures, alt text, wrapping, and
#     its text;
#   - shapes: each shape of the main text (Phase 34; msoAutoShape, msoLine, msoFreeform): as text
#     boxes, with its AutoShapeType, rotation, flips, fill (shown, RGB as RRGGBB), line (shown,
#     weight, dash style, RRGGBB, arrowheads), first adjustment and text;
#   - sections: each section's first page, column count, section start, different first page,
#     and its headers and footers (default, first, even): whether they exist, are linked to the
#     previous section, and their text as Word has it open (page fields recomputed, a picture
#     as "/"); exists says the variant is in effect, not that the file has the part;
#   - evenAndOddHeaders; pageSections: the section each page starts in;
#   - notes: each footnote and endnote: its kind, its reference's page, its text (Word answers
#     a note's own page with its reference's: where a note continues shows only in its PDF), and
#     the tracked changes in it, counted before changes are accepted;
#   - fields: each field of the main text: type (WdFieldType), code, result as Word has it
#     open (unlocked DATE fields are today's), page;
#   - bookmarks: each visible bookmark: name, page, text;
#   - controls: each content control of the main text: type (WdContentControlType), tag, title,
#     whether it shows its placeholder, text;
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
# WdShapePosition: what a floating shape's Left or Top holds when it is aligned.
$ALIGNED = @{ -999998 = "left"; -999999 = "top"; -999995 = "center"; -999996 = "right"; -999997 = "bottom"; -999994 = "inside"; -999993 = "outside" }
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
      comments = $null
      revisionsAccepted = $null
      pages = $null
      paragraphs = @()
      pictures = @()
      textBoxes = @()
      shapes = @()
      evenAndOddHeaders = $null
      pageSections = @()
      sections = @()
      notes = @()
      fields = @()
      bookmarks = @()
      controls = @()
    }
    $doc = $null
    try {
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument: Word would wait
      # forever on a hidden password dialog; a wrong password fails instead.
      $doc = $word.Documents.Open([string]$file.FullName, $false, $true, $false, "foli-no-password")
      $result.opened = $true
      # Text is read as shown: results, whatever Word's option for showing field codes says.
      $doc.ActiveWindow.View.ShowFieldCodes = $false
      $result.comments = [int]$doc.Comments.Count
      $result.revisionsAccepted = [int]$doc.Revisions.Count
      $noteCounts = New-Object System.Collections.Generic.List[object]
      foreach ($collection in @($doc.Footnotes, $doc.Endnotes)) {
        foreach ($note in $collection) {
          $noteCounts.Add([int]$note.Range.Revisions.Count)
        }
      }
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
      # Pictures: inline ones from the page's top-left corner (wdHorizontal/VerticalPosition-
      # RelativeToPage: 5, 6); floating ones as Word places them, from what they are relative to
      # (WdRelativeHorizontalPosition and WdRelativeVerticalPosition: 0 margin, 1 page, 2 column
      # or paragraph...), with the page of their anchor. Points.
      $pictures = New-Object System.Collections.Generic.List[object]
      foreach ($s in $doc.InlineShapes) {
        $pictures.Add([ordered]@{
            float = $false
            page = [int]$s.Range.Information($INFO_PAGE)
            left = [math]::Round([double]$s.Range.Information(5), 1)
            top = [math]::Round([double]$s.Range.Information(6), 1)
            width = [math]::Round([double]$s.Width, 1)
            height = [math]::Round([double]$s.Height, 1)
            alt = [string]$s.AlternativeText
            wrap = $null
          })
      }
      foreach ($s in $doc.Shapes) {
        # Pictures only (msoPicture 13, msoLinkedPicture 11): other shapes stay out of the record.
        if ($s.Type -ne 13 -and $s.Type -ne 11) { continue }
        # An aligned picture's Left or Top is one of Word's constants (wdShapeRight -999996…), not
        # a position: recorded as the alignment, the position then null.
        $left = [double]$s.Left; $top = [double]$s.Top
        # The anchor's paragraph, numbered from 1 as Word numbers the main text's paragraphs.
        $anchorParagraph = $doc.Range(0, $s.Anchor.Start).Paragraphs.Count
        if ($s.Anchor.Start -eq $doc.Paragraphs.Item($anchorParagraph).Range.End) { $anchorParagraph++ }
        $pictures.Add([ordered]@{
            float = $true
            page = [int]$s.Anchor.Information($INFO_PAGE)
            paragraph = $anchorParagraph
            left = if ($ALIGNED.ContainsKey([int]$left)) { $null } else { [math]::Round($left, 1) }
            top = if ($ALIGNED.ContainsKey([int]$top)) { $null } else { [math]::Round($top, 1) }
            horizontalAlign = $ALIGNED[[int]$left]
            verticalAlign = $ALIGNED[[int]$top]
            width = [math]::Round([double]$s.Width, 1)
            height = [math]::Round([double]$s.Height, 1)
            alt = [string]$s.AlternativeText
            wrap = [int]$s.WrapFormat.Type
            horizontalTo = [int]$s.RelativeHorizontalPosition
            verticalTo = [int]$s.RelativeVerticalPosition
          })
      }
      $result.pictures = $pictures.ToArray()
      $boxes = New-Object System.Collections.Generic.List[object]
      foreach ($s in $doc.Shapes) {
        if ($s.Type -ne 17) { continue }   # msoTextBox
        $left = [double]$s.Left; $top = [double]$s.Top
        $anchorParagraph = $doc.Range(0, $s.Anchor.Start).Paragraphs.Count
        if ($s.Anchor.Start -eq $doc.Paragraphs.Item($anchorParagraph).Range.End) { $anchorParagraph++ }
        $boxes.Add([ordered]@{
            page = [int]$s.Anchor.Information($INFO_PAGE)
            paragraph = $anchorParagraph
            left = if ($ALIGNED.ContainsKey([int]$left)) { $null } else { [math]::Round($left, 1) }
            top = if ($ALIGNED.ContainsKey([int]$top)) { $null } else { [math]::Round($top, 1) }
            horizontalAlign = $ALIGNED[[int]$left]
            verticalAlign = $ALIGNED[[int]$top]
            width = [math]::Round([double]$s.Width, 1)
            height = [math]::Round([double]$s.Height, 1)
            alt = [string]$s.AlternativeText
            wrap = [int]$s.WrapFormat.Type
            horizontalTo = [int]$s.RelativeHorizontalPosition
            verticalTo = [int]$s.RelativeVerticalPosition
            text = Clean ([string]$s.TextFrame.TextRange.Text).Replace("`r", "`n")
          })
      }
      $result.textBoxes = $boxes.ToArray()
      # BGR (Word's RGB property) as RRGGBB.
      function Hex($bgr) { $n = [int]$bgr; return "{0:X2}{1:X2}{2:X2}" -f ($n -band 255), (($n -shr 8) -band 255), (($n -shr 16) -band 255) }
      $shapes = New-Object System.Collections.Generic.List[object]
      foreach ($s in $doc.Shapes) {
        if (@(1, 5, 9) -notcontains [int]$s.Type) { continue }   # msoAutoShape, msoFreeform, msoLine
        $left = [double]$s.Left; $top = [double]$s.Top
        $anchorParagraph = $doc.Range(0, $s.Anchor.Start).Paragraphs.Count
        if ($s.Anchor.Start -eq $doc.Paragraphs.Item($anchorParagraph).Range.End) { $anchorParagraph++ }
        $text = ""
        try { if ($s.TextFrame.HasText) { $text = Clean ([string]$s.TextFrame.TextRange.Text).Replace("`r", "`n") } } catch {}
        # A shape Word cannot describe (an odd freeform) keeps the rest of the record.
        $fill = $null; $line = $null
        try { if ($s.Fill.Visible -ne 0) { $fill = Hex $s.Fill.ForeColor.RGB } } catch {}
        try {
          if ($s.Line.Visible -ne 0) {
            $line = [ordered]@{ color = Hex $s.Line.ForeColor.RGB; weight = [math]::Round([double]$s.Line.Weight, 2); dash = [int]$s.Line.DashStyle; begin = [int]$s.Line.BeginArrowheadStyle; end = [int]$s.Line.EndArrowheadStyle }
          }
        } catch {}
        $adjust = $null
        try { if ($s.Adjustments.Count -gt 0) { $adjust = [math]::Round([double]$s.Adjustments.Item(1), 4) } } catch {}
        $shapes.Add([ordered]@{
            page = [int]$s.Anchor.Information($INFO_PAGE)
            paragraph = $anchorParagraph
            left = if ($ALIGNED.ContainsKey([int]$left)) { $null } else { [math]::Round($left, 1) }
            top = if ($ALIGNED.ContainsKey([int]$top)) { $null } else { [math]::Round($top, 1) }
            horizontalAlign = $ALIGNED[[int]$left]
            verticalAlign = $ALIGNED[[int]$top]
            width = [math]::Round([double]$s.Width, 1)
            height = [math]::Round([double]$s.Height, 1)
            alt = [string]$s.AlternativeText
            wrap = [int]$s.WrapFormat.Type
            horizontalTo = [int]$s.RelativeHorizontalPosition
            verticalTo = [int]$s.RelativeVerticalPosition
            type = [int]$s.Type
            autoShapeType = [int]$s.AutoShapeType
            rotation = [math]::Round([double]$s.Rotation, 1)
            flipH = [bool]($s.HorizontalFlip -ne 0)
            flipV = [bool]($s.VerticalFlip -ne 0)
            fill = $fill
            line = $line
            adjust = $adjust
            text = $text
          })
      }
      $result.shapes = $shapes.ToArray()
      $result.evenAndOddHeaders = [bool]$doc.PageSetup.OddAndEvenPagesHeaderFooter
      $pageSections = New-Object System.Collections.Generic.List[object]
      for ($n = 1; $n -le $result.pages; $n++) {
        $start = $doc.GoTo(1, 1, $n)   # wdGoToPage, wdGoToAbsolute
        $pageSections.Add([int]$start.Information(2))   # wdActiveEndSectionNumber
      }
      $result.pageSections = $pageSections.ToArray()
      $kinds = [ordered]@{ default = 1; first = 2; even = 3 }   # WdHeaderFooterIndex
      function Stories($collection) {
        $out = [ordered]@{}
        foreach ($kind in $kinds.Keys) {
          $item = $collection.Item($kinds[$kind])
          $out[$kind] = [ordered]@{ exists = [bool]$item.Exists; linked = [bool]$item.LinkToPrevious; text = Clean $item.Range.Text; tables = [int]$item.Range.Tables.Count }
        }
        return $out
      }
      $sections = New-Object System.Collections.Generic.List[object]
      foreach ($section in $doc.Sections) {
        $setup = $section.PageSetup
        $sections.Add([ordered]@{
            page = [int]$section.Range.Characters.First.Information($INFO_PAGE)
            start = [int]$setup.SectionStart
            columns = [int]$setup.TextColumns.Count
            differentFirstPage = [bool]$setup.DifferentFirstPageHeaderFooter
            headers = Stories $section.Headers
            footers = Stories $section.Footers
          })
      }
      $result.sections = $sections.ToArray()
      $notes = New-Object System.Collections.Generic.List[object]
      foreach ($pair in @(@("footnote", $doc.Footnotes), @("endnote", $doc.Endnotes))) {
        foreach ($note in $pair[1]) {
          $notes.Add([ordered]@{ kind = $pair[0]; referencePage = [int]$note.Reference.Information($INFO_PAGE); text = Clean $note.Range.Text; revisions = $noteCounts[$notes.Count] })
        }
      }
      $result.notes = $notes.ToArray()
      $fields = New-Object System.Collections.Generic.List[object]
      foreach ($field in $doc.Fields) {
        $fields.Add([ordered]@{ type = [int]$field.Type; code = ([string]$field.Code.Text).Trim(); result = Clean $field.Result.Text; page = [int]$field.Code.Information($INFO_PAGE) })
      }
      $result.fields = $fields.ToArray()
      $bookmarks = New-Object System.Collections.Generic.List[object]
      foreach ($bookmark in $doc.Bookmarks) {
        $bookmarks.Add([ordered]@{ name = [string]$bookmark.Name; page = [int]$bookmark.Range.Information($INFO_PAGE); text = Clean $bookmark.Range.Text })
      }
      $result.bookmarks = $bookmarks.ToArray()
      $controls = New-Object System.Collections.Generic.List[object]
      foreach ($control in $doc.ContentControls) {
        $controls.Add([ordered]@{ type = [int]$control.Type; tag = [string]$control.Tag; title = [string]$control.Title; placeholder = [bool]$control.ShowingPlaceholderText; text = Clean $control.Range.Text })
      }
      $result.controls = $controls.ToArray()
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
    $json = ($result | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"
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
