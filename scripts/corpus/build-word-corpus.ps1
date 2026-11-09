# Builds the synthetic Word corpus (corpus/word/*.docx) with Microsoft Word itself, through COM
# automation, so the files carry what real Word documents carry (full styles, numbering
# definitions, theme, revision ids, settings). Windows with desktop Word only.
#
#   powershell -ExecutionPolicy Bypass -File scripts/corpus/build-word-corpus.ps1 [-PdfDir <folder>]
#
# -PdfDir also exports Word's own PDF of each document there (to look at, or compare with).
#
# Built-in styles are addressed by their WdBuiltinStyle number, never by name: Word localizes
# style names ("Heading 1" is "Titulo 1" in a Spanish Word). Word's user name is changed to
# author tracked changes and comments, and restored at the end.

param([string]$PdfDir = "")

$ErrorActionPreference = "Stop"
# Paths go to Word as [string]: PowerShell 5.1 passes a Join-Path result as a wrapped object,
# and Word then waits forever in SaveAs2, ExportAsFixedFormat and AddPicture.
$root = [string](Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$out = [string](Join-Path $root "corpus\word")
New-Item -ItemType Directory -Force $out | Out-Null
$missing = [Type]::Missing

# WdBuiltinStyle
$S_NORMAL = -1; $S_H1 = -2; $S_H2 = -3; $S_H3 = -4; $S_TITLE = -63; $S_SUBTITLE = -75
$S_LIST_BULLET = -49; $S_LIST_NUMBER = -50; $S_CAPTION = -35; $S_QUOTE = -181
# Other constants
$FORMAT_DOCX = 16          # wdFormatDocumentDefault
$FIELD_EMPTY = -1
$SECTION_NEXT_PAGE = 2
$PAGE_BREAK = 7
$ALIGN_LEFT = 0; $ALIGN_CENTER = 1; $ALIGN_RIGHT = 2; $ALIGN_JUSTIFY = 3
$TAB_RIGHT = 2; $LEADER_DOTS = 1
$NUM_ARABIC = 0; $NUM_LOWER_LETTER = 4; $NUM_LOWER_ROMAN = 2
$HF_PRIMARY = 1; $HF_FIRST = 2
$CC_RICH = 0; $CC_TEXT = 1; $CC_DROPDOWN = 4; $CC_DATE = 6; $CC_CHECKBOX = 8
$ORIENT_LANDSCAPE = 1
$COLOR_LIGHT_GRAY = 15132390   # BGR
$COLOR_DARK_BLUE = 6299648     # RGB(0, 32, 96) as BGR
$LANG_EN_GB = 2057              # wdEnglishUK

# Progress log (Word automation can stall on a dialog; the log shows where).
$logFile = Join-Path ([System.IO.Path]::GetTempPath()) "foli-corpus.log"
Set-Content $logFile "" -Encoding UTF8
function Log([string]$message) {
  try { Add-Content $logFile ("{0:HH:mm:ss} {1}" -f (Get-Date), $message) -Encoding UTF8 -ErrorAction Stop } catch {}
}

function Set-Author([string]$name, [string]$initials) {
  $word.UserName = $name
  $word.UserInitials = $initials
}

function New-Doc {
  $doc = $word.Documents.Add()
  $doc.Content.Style = $doc.Styles.Item($S_NORMAL)
  # English (UK) text, whatever the language of the Word that generates the corpus.
  $doc.Styles.Item($S_NORMAL).LanguageID = $LANG_EN_GB
  $doc.Content.LanguageID = $LANG_EN_GB
  # A4, 2.54 cm margins (72 pt = 1 inch).
  $setup = $doc.Sections.Item(1).PageSetup
  $setup.PageWidth = 595.3; $setup.PageHeight = 841.9
  $setup.TopMargin = 72; $setup.BottomMargin = 72; $setup.LeftMargin = 72; $setup.RightMargin = 72
  return $doc
}

# Appends a paragraph at the end of the document and returns its range.
function Add-Para($doc, [string]$text, $style = $S_NORMAL) {
  Log ("para: " + $text.Substring(0, [Math]::Min(40, $text.Length)))
  $end = $doc.Content
  $last = $doc.Paragraphs.Last.Range
  if ($last.Text.Trim().Length -gt 0 -or $doc.Paragraphs.Count -gt 1) {
    $end.InsertParagraphAfter()
  }
  $para = $doc.Paragraphs.Last
  $para.Range.Text = $text
  $para = $doc.Paragraphs.Last
  $para.Style = $doc.Styles.Item($style)
  return $para.Range
}

# Bolds every occurrence of $text inside $range (one plain paragraph: its text offsets are
# document positions; Word's Find keeps state between calls and can stall a loop).
function Set-Bold($range, [string]$text) {
  $content = $range.Text
  $at = $content.IndexOf($text)
  while ($at -ge 0) {
    $range.Document.Range($range.Start + $at, $range.Start + $at + $text.Length).Font.Bold = $true
    $at = $content.IndexOf($text, $at + $text.Length)
  }
}

function Find-Range($doc, [string]$text) {
  Log ("find: " + $text)
  $r = $doc.Content
  $r.Find.ClearFormatting()
  $r.Find.Wrap = 0
  $r.Find.Forward = $true
  if ($r.Find.Execute($text)) { return $r }
  throw "Text not found: $text"
}

# Legal clause numbering: level 1 linked to Heading 1 ("1."), level 2 to a "Clause" style
# ("1.1"), level 3 to a "Sub-clause" style ("(a)"), level 4 ("(i)").
function Add-ClauseNumbering($doc) {
  $clause = $doc.Styles.Add("Clause", 1)
  $clause.BaseStyle = $doc.Styles.Item($S_NORMAL).NameLocal
  $clause.ParagraphFormat.SpaceAfter = 6
  $clause.ParagraphFormat.Alignment = $ALIGN_JUSTIFY
  $sub = $doc.Styles.Add("Sub-clause", 1)
  $sub.BaseStyle = "Clause"
  $roman = $doc.Styles.Add("Sub-sub-clause", 1)
  $roman.BaseStyle = "Clause"
  $h1 = $doc.Styles.Item($S_H1)
  $h1.Font.Size = 12; $h1.Font.Bold = $true; $h1.Font.AllCaps = $true
  $h1.ParagraphFormat.SpaceBefore = 12; $h1.ParagraphFormat.SpaceAfter = 6

  $template = $doc.ListTemplates.Add($true, "ContractClauses")
  $levels = @(
    @{ Format = "%1."; Style = $NUM_ARABIC; Linked = $h1.NameLocal; Indent = 0; Text = 36 },
    @{ Format = "%1.%2"; Style = $NUM_ARABIC; Linked = "Clause"; Indent = 0; Text = 36 },
    @{ Format = "(%3)"; Style = $NUM_LOWER_LETTER; Linked = "Sub-clause"; Indent = 36; Text = 72 },
    @{ Format = "(%4)"; Style = $NUM_LOWER_ROMAN; Linked = "Sub-sub-clause"; Indent = 72; Text = 108 }
  )
  for ($i = 0; $i -lt $levels.Count; $i++) {
    $level = $template.ListLevels.Item($i + 1)
    $level.NumberFormat = $levels[$i].Format
    $level.NumberStyle = $levels[$i].Style
    $level.NumberPosition = $levels[$i].Indent
    $level.TextPosition = $levels[$i].Text
    $level.TabPosition = $levels[$i].Text
    $level.StartAt = 1
    $level.LinkedStyle = $levels[$i].Linked
    if ($i -eq 1) { $level.ResetOnHigher = 1 }
  }
  return $template
}

# "Page X of Y" in the primary footer of every section.
function Add-PageXofY($doc) {
  Log "page x of y"
  foreach ($section in $doc.Sections) {
    $footer = $section.Footers.Item($HF_PRIMARY).Range
    $footer.Text = "Page "
    $footer.ParagraphFormat.Alignment = $ALIGN_CENTER
    $r = $section.Footers.Item($HF_PRIMARY).Range
    $r.Collapse(0)
    $doc.Fields.Add($r, $FIELD_EMPTY, "PAGE", $false) | Out-Null
    $r = $section.Footers.Item($HF_PRIMARY).Range
    $r.Collapse(0)
    $r.InsertAfter(" of ")
    $r = $section.Footers.Item($HF_PRIMARY).Range
    $r.Collapse(0)
    $doc.Fields.Add($r, $FIELD_EMPTY, "NUMPAGES", $false) | Out-Null
  }
}

function Save-Doc($doc, [string]$name) {
  Log "save $name"
  $path = [string](Join-Path $out $name)
  if (Test-Path $path) { Remove-Item $path }
  $doc.Repaginate()
  $doc.Fields.Update() | Out-Null
  Log "fields updated"
  $doc.SaveAs2($path, $FORMAT_DOCX)
  if ($PdfDir) {
    New-Item -ItemType Directory -Force $PdfDir | Out-Null
    $doc.ExportAsFixedFormat([string](Join-Path $PdfDir ($name -replace "\.docx$", ".pdf")), 17)
  }
  Log "saved"
  $doc.Close(0)
  Write-Output "wrote $name"
}

# A small PNG "logo" and "chart" for the documents that need images (drawn with .NET).
function New-Png([string]$path, [int]$w, [int]$h, [scriptblock]$draw) {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::White)
  & $draw $g
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$tmp = [string](Join-Path ([System.IO.Path]::GetTempPath()) "foli-corpus")
New-Item -ItemType Directory -Force $tmp | Out-Null
$logo = [string](Join-Path $tmp "logo.png")
New-Png $logo 320 80 {
  param($g)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 32, 96))
  $g.FillEllipse($brush, 8, 8, 64, 64)
  $font = New-Object System.Drawing.Font "Arial", 20, ([System.Drawing.FontStyle]::Bold)
  $g.DrawString("NORTHWIND", $font, $brush, 80, 22)
}
$chart = [string](Join-Path $tmp "chart.png")
New-Png $chart 480 280 {
  param($g)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Gray), 2
  $g.DrawLine($pen, 40, 250, 460, 250); $g.DrawLine($pen, 40, 250, 40, 20)
  $values = @(120, 150, 135, 190, 210, 240)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(68, 114, 196))
  for ($i = 0; $i -lt $values.Count; $i++) { $g.FillRectangle($brush, 60 + $i * 66, 250 - $values[$i], 44, $values[$i]) }
}

$word = New-Object -ComObject Word.Application
# Everything after Word starts runs inside try/finally: Word always quits and the user's settings
# are always restored, whatever fails.
$savedUser = $null
$addedCaptionLabel = $false
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # The user's own name and initials, restored at the end. Kept in a file too: if a run is killed
  # before it restores them, the next run restores the original, not the last corpus author.
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
  # Signed in to Office, Word authors changes and comments with the account's name unless "Always
  # use these values regardless of sign in" is on: on for the run (no real names in the corpus),
  # restored at the end.
  $word.Options.UseLocalUserInfo = $true
  # InsertCaption with a label Word does not know ("Table" in a non-English Word) adds it to the
  # user's caption labels: removed again at the end if this run added it.
  $knownLabels = @($word.CaptionLabels | ForEach-Object { $_.Name })
  if ($knownLabels -notcontains "Table") {
    $word.CaptionLabels.Add("Table") | Out-Null
    $addedCaptionLabel = $true
  }

  Set-Author "Legal Department" "LD"

  # ---------------------------------------------------------------------------------------
  # 01: Mutual NDA. Legal clause numbering linked to styles, defined terms, a cross-reference,
  # a confidential header from page 2 (different first page), Page X of Y, a signature table.
  $doc = New-Doc
  $template = Add-ClauseNumbering $doc
  $r = Add-Para $doc "MUTUAL NON-DISCLOSURE AGREEMENT" $S_TITLE
  $r.ParagraphFormat.Alignment = $ALIGN_CENTER
  $r = Add-Para $doc "This Mutual Non-Disclosure Agreement (the ""Agreement"") is made on 3 March 2026 between:"
  $r = Add-Para $doc "Northwind Traders Limited, a company incorporated in England and Wales with company number 01234567, whose registered office is at 1 Harbour Street, London E14 5AB (""Northwind""); and"
  $r.ParagraphFormat.LeftIndent = 36
  Set-Bold $r "Northwind Traders Limited"
  $r = Add-Para $doc "Contoso Pharmaceuticals S.L., a company incorporated in Spain with tax number B12345678, whose registered office is at Calle Mayor 10, 28013 Madrid (""Contoso""),"
  $r.ParagraphFormat.LeftIndent = 36
  Set-Bold $r "Contoso Pharmaceuticals S.L."
  Add-Para $doc "each a ""Party"" and together the ""Parties""." | Out-Null

  $h = Add-Para $doc "Definitions and interpretation" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 0, $missing, 1) | Out-Null
  $c = Add-Para $doc "In this Agreement the following definitions apply:" "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  foreach ($def in @(
      """Confidential Information"" means all information of a confidential nature disclosed by a Party to the other Party, whether in writing, orally or by any other means, including the information described in clause 2.2;",
      """Purpose"" means the evaluation of a possible supply and distribution arrangement between the Parties;",
      """Representatives"" means a Party's employees, officers, professional advisers and contractors who need to know the Confidential Information for the Purpose.")) {
    $d = Add-Para $doc $def "Sub-clause"
    $d.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 3) | Out-Null
    Set-Bold $d ($def.Split('"')[1])
  }
  $c = Add-Para $doc "Clause headings do not affect the interpretation of this Agreement. Words in the singular include the plural and vice versa." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null

  $h = Add-Para $doc "Obligations of confidentiality" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "Each Party shall keep the other Party's Confidential Information confidential and shall not use it except for the Purpose." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  $c = Add-Para $doc "Confidential Information includes, without limitation:" "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  foreach ($item in @("technical data, formulae, specifications and know-how;", "commercial information, including pricing, customers and suppliers; and", "the existence and terms of the discussions between the Parties.")) {
    $s = Add-Para $doc $item "Sub-clause"
    $s.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 3) | Out-Null
  }
  $c = Add-Para $doc "The obligations in this clause do not apply to information that:" "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  foreach ($item in @("is or becomes generally available to the public other than through a breach of this Agreement;", "was lawfully in the possession of the receiving Party before disclosure; or", "is required to be disclosed by law, provided that the receiving Party:")) {
    $s = Add-Para $doc $item "Sub-clause"
    $s.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 3) | Out-Null
  }
  foreach ($item in @("gives the disclosing Party prompt written notice; and", "discloses only the minimum information required.")) {
    $s = Add-Para $doc $item "Sub-sub-clause"
    $s.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 4) | Out-Null
  }

  $h = Add-Para $doc "Term and return of information" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "This Agreement continues for a period of three (3) years from its date. On request, each Party shall return or destroy the other Party's Confidential Information, subject to the exceptions in clause " "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  # Cross-reference to the numbered item "The obligations in this clause do not apply..." (clause 2.3).
  $items = $doc.GetCrossReferenceItems(0)
  $target = 0
  # Word returns a 1-based array: enumerate it instead of indexing.
  $i = 0
  foreach ($item in $items) { $i++; if ($item -like "*do not apply*") { $target = $i; break } }
  if ($target -eq 0) { throw "Cross-reference target not found" }
  $ref = $doc.Paragraphs.Last.Range
  $ref.MoveEnd(1, -1) | Out-Null
  $ref.Collapse(0)
  $ref.InsertCrossReference(0, -4, $target, $true, $false, $false, " ")
  $ref = $doc.Paragraphs.Last.Range
  $ref.MoveEnd(1, -1) | Out-Null
  $ref.InsertAfter(".")

  $h = Add-Para $doc "Governing law" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "This Agreement and any dispute arising out of it are governed by the law of England and Wales, and the courts of England have exclusive jurisdiction." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null

  $r = Add-Para $doc "Signed by the Parties on the date stated above."
  $r.ParagraphFormat.SpaceBefore = 18
  $r.ParagraphFormat.KeepWithNext = $true
  Add-Para $doc "" | Out-Null
  Log "table"
  $table = $doc.Tables.Add($doc.Paragraphs.Last.Range, 4, 2)
  Log "table added"
  $table.Borders.Enable = $false
  $labels = @(@("For and on behalf of Northwind Traders Limited", "For and on behalf of Contoso Pharmaceuticals S.L."), @("Signature: ____________________", "Signature: ____________________"), @("Name: Jane Ellis", "Name: Carlos Ruiz"), @("Title: Chief Executive Officer", "Title: Director General"))
  for ($row = 1; $row -le 4; $row++) { for ($col = 1; $col -le 2; $col++) { $table.Cell($row, $col).Range.Text = $labels[$row - 1][$col - 1] } }
  $table.Rows.Item(1).Range.Font.Bold = $true

  $section = $doc.Sections.Item(1)
  Log "first page header"
  $section.PageSetup.DifferentFirstPageHeaderFooter = -1
  $header = $section.Headers.Item($HF_PRIMARY).Range
  $header.Text = "CONFIDENTIAL - Mutual NDA - Northwind / Contoso"
  $header.ParagraphFormat.Alignment = $ALIGN_RIGHT
  $header.Font.Size = 8
  Add-PageXofY $doc
  $first = $section.Footers.Item($HF_FIRST).Range
  $first.Text = "Northwind Traders Limited - Registered in England and Wales No. 01234567"
  $first.Font.Size = 8
  $first.ParagraphFormat.Alignment = $ALIGN_CENTER
  Save-Doc $doc "01-mutual-nda.docx"

  # ---------------------------------------------------------------------------------------
  # 02: Services agreement under negotiation: a fee table (merged header, shading, repeated
  # header row), a bulleted list, then tracked changes by two authors (insertions, deletions,
  # a formatting change, a new clause) and comments with a reply and a resolved one.
  $doc = New-Doc
  $template = Add-ClauseNumbering $doc
  $r = Add-Para $doc "MASTER SERVICES AGREEMENT" $S_TITLE
  $r.ParagraphFormat.Alignment = $ALIGN_CENTER
  Add-Para $doc "Between Northwind Traders Limited (the ""Customer"") and Fabrikam Consulting LLP (the ""Supplier"")." | Out-Null
  $h = Add-Para $doc "Services" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 0, $missing, 1) | Out-Null
  $c = Add-Para $doc "The Supplier shall provide the following services (the ""Services""):" "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  foreach ($item in @("design and implementation of the Customer's data platform;", "training of up to twenty (20) members of the Customer's staff;", "second-line support during business hours.")) {
    Add-Para $doc $item $S_LIST_BULLET | Out-Null
  }
  $c = Add-Para $doc "The Supplier shall perform the Services with reasonable skill and care and in accordance with good industry practice." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  $h = Add-Para $doc "Fees and payment" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "The Customer shall pay the fees set out in the table below. Invoices are payable within thirty (30) days of receipt." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  Add-Para $doc "" | Out-Null
  $table = $doc.Tables.Add($doc.Paragraphs.Last.Range, 5, 3)
  $table.Borders.Enable = $true
  $cells = @(@("Fee schedule", "", ""), @("Milestone", "Due", "Amount (EUR)"), @("Platform design", "On signature", "40,000"), @("Implementation", "On acceptance", "85,000"))
  # Monthly support for two years: the table crosses a page, so its header rows repeat.
  $months = @("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
  foreach ($year in @(2026, 2027)) { foreach ($month in $months) { $cells += , @("Support and training, $month $year", "End of month", "6,500") } }
  while ($table.Rows.Count -lt $cells.Count) { $table.Rows.Add() | Out-Null }
  for ($row = 1; $row -le $cells.Count; $row++) { for ($col = 1; $col -le 3; $col++) { $table.Cell($row, $col).Range.Text = $cells[$row - 1][$col - 1] } }
  $table.Cell(1, 1).Merge($table.Cell(1, 3))
  $table.Rows.Item(1).Range.Font.Bold = $true
  $table.Rows.Item(1).Range.ParagraphFormat.Alignment = $ALIGN_CENTER
  $table.Rows.Item(1).Shading.BackgroundPatternColor = $COLOR_DARK_BLUE
  $table.Rows.Item(1).Range.Font.Color = 16777215
  $table.Rows.Item(2).Range.Font.Bold = $true
  $table.Rows.Item(2).Shading.BackgroundPatternColor = $COLOR_LIGHT_GRAY
  $table.Rows.Item(1).HeadingFormat = -1
  $table.Rows.Item(2).HeadingFormat = -1
  for ($row = 3; $row -le $cells.Count; $row++) { $table.Cell($row, 3).Range.ParagraphFormat.Alignment = $ALIGN_RIGHT }
  $h = Add-Para $doc "Liability" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "Each Party's total liability under this Agreement is limited to the fees paid in the twelve (12) months before the claim. Neither Party is liable for indirect or consequential loss." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  $h = Add-Para $doc "Termination" $S_H1
  $h.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 1) | Out-Null
  $c = Add-Para $doc "Either Party may terminate this Agreement on ninety (90) days' written notice." "Clause"
  $c.ListFormat.ApplyListTemplateWithLevel($template, $true, 2, $missing, 2) | Out-Null
  Add-PageXofY $doc

  # Negotiation round 1: the Supplier's lawyer.
  $doc.TrackRevisions = $true
  Set-Author "Alice Martin" "AM"
  (Find-Range $doc "thirty (30) days").Text = "forty-five (45) days"
  (Find-Range $doc "Neither Party is liable for indirect or consequential loss.").Delete() | Out-Null
  $r = Find-Range $doc "with reasonable skill and care"
  $r.Font.Bold = $true
  $r = Find-Range $doc "on ninety (90) days' written notice."
  $r.InsertParagraphAfter()
  $new = $r.Paragraphs.Item(1).Next(1).Range
  $new.InsertBefore("The Supplier may suspend the Services if any invoice remains unpaid for more than sixty (60) days after its due date.")
  $doc.Comments.Add((Find-Range $doc "forty-five (45) days"), "Our standard terms are 45 days; 30 days does not work with our billing cycle.") | Out-Null
  # Round 2: the Customer's counsel.
  Set-Author "Bob Chen" "BC"
  $r = Find-Range $doc "twelve (12) months"
  $r.Text = "twenty-four (24) months"
  $comment = $doc.Comments.Item(1)
  $comment.Replies.Add($comment.Scope, "We can accept 45 days if the late-payment suspension right is removed.") | Out-Null
  $c2 = $doc.Comments.Add((Find-Range $doc "Fee schedule"), "Please confirm the amounts are exclusive of VAT.")
  Set-Author "Alice Martin" "AM"
  $c2.Replies.Add($c2.Scope, "Confirmed: all amounts exclude VAT.") | Out-Null
  $c2.Done = $true
  Save-Doc $doc "02-services-agreement-redlined.docx"

  # ---------------------------------------------------------------------------------------
  # 03: Offer letter template: letterhead with a logo, content controls (text, date,
  # drop-down, check box, rich text) and merge fields.
  Set-Author "HR Templates" "HR"
  $doc = New-Doc
  $header = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range
  $header.InlineShapes.AddPicture($logo, $false, $true) | Out-Null
  $header = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range
  $header.InsertParagraphAfter()
  $address = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range.Paragraphs.Last.Range
  $address.Text = "Northwind Traders Limited - 1 Harbour Street - London E14 5AB"
  $address.ParagraphFormat.Alignment = $ALIGN_RIGHT
  $address.Font.Size = 8
  $r = Add-Para $doc "PRIVATE AND CONFIDENTIAL"
  $r.Font.Bold = $true
  $r = Add-Para $doc "Date: "
  $cc = $doc.ContentControls.Add($CC_DATE, $doc.Paragraphs.Last.Range.Characters.Last)
  $cc.Title = "Offer date"; $cc.Tag = "offer_date"; $cc.DateDisplayFormat = "d MMMM yyyy"; $cc.DateDisplayLocale = $LANG_EN_GB
  $r = Add-Para $doc "Dear "
  $f = $doc.Paragraphs.Last.Range
  $f.MoveEnd(1, -1) | Out-Null
  $f.Collapse(0)
  $doc.Fields.Add($f, $FIELD_EMPTY, "MERGEFIELD CandidateFirstName \* MERGEFORMAT", $false) | Out-Null
  $doc.Paragraphs.Last.Range.InsertAfter(",")
  Add-Para $doc "We are pleased to offer you the position below, on the terms set out in this letter and in the enclosed contract of employment." | Out-Null
  $t = Add-Para $doc "Position: "
  $cc = $doc.ContentControls.Add($CC_DROPDOWN, $doc.Paragraphs.Last.Range.Characters.Last)
  $cc.Title = "Position"; $cc.Tag = "position"
  foreach ($p in @("Data Engineer", "Senior Data Engineer", "Engineering Manager")) { $cc.DropdownListEntries.Add($p, $p) | Out-Null }
  $t = Add-Para $doc "Annual salary (EUR): "
  $cc = $doc.ContentControls.Add($CC_TEXT, $doc.Paragraphs.Last.Range.Characters.Last)
  $cc.Title = "Salary"; $cc.Tag = "salary"
  # Word's default placeholder text, as in most real templates.
  $t = Add-Para $doc "Start date: "
  $f = $doc.Paragraphs.Last.Range
  $f.MoveEnd(1, -1) | Out-Null
  $f.Collapse(0)
  $doc.Fields.Add($f, $FIELD_EMPTY, "MERGEFIELD StartDate \@ ""d MMMM yyyy"" \* MERGEFORMAT", $false) | Out-Null
  $t = Add-Para $doc " Remote working eligible"
  $cc = $doc.ContentControls.Add($CC_CHECKBOX, $doc.Paragraphs.Last.Range.Characters.First)
  $cc.Title = "Remote"; $cc.Tag = "remote"
  Add-Para $doc "Benefits:" | Out-Null
  Add-Para $doc "" | Out-Null
  $cc = $doc.ContentControls.Add($CC_RICH, $doc.Paragraphs.Last.Range)
  $cc.Title = "Benefits"; $cc.Tag = "benefits"
  $cc.Range.Text = "Private health insurance; 25 days' annual leave; pension contribution of 5%."
  Add-Para $doc "This offer is conditional on satisfactory references and proof of your right to work. Please sign and return a copy of this letter by the date stated in the enclosed contract." | Out-Null
  $r = Add-Para $doc "Yours sincerely,"
  $r.ParagraphFormat.SpaceBefore = 12
  Add-Para $doc "" | Out-Null
  Add-Para $doc "Maria Lopez" | Out-Null
  Add-Para $doc "Head of People" | Out-Null
  $footer = $doc.Sections.Item(1).Footers.Item($HF_PRIMARY).Range
  $footer.Text = "Northwind Traders Limited is registered in England and Wales under number 01234567."
  $footer.Font.Size = 7
  $footer.ParagraphFormat.Alignment = $ALIGN_CENTER
  Save-Doc $doc "03-offer-letter-template.docx"

  # ---------------------------------------------------------------------------------------
  # 04: Board report: cover page (different first page), table of contents, headings 1-3,
  # bulleted and numbered lists, footnotes, a floating chart with square wrapping, a
  # landscape section with a wide table, and a captioned appendix.
  Set-Author "Finance Team" "FT"
  $doc = New-Doc
  $r = Add-Para $doc "Quarterly Board Report" $S_TITLE
  $r = Add-Para $doc "Q1 2026 - Northwind Traders Limited" $S_SUBTITLE
  $doc.Paragraphs.Last.Range.InsertParagraphAfter()
  $doc.Paragraphs.Last.Range.InsertBreak($PAGE_BREAK)
  $r = Add-Para $doc "Contents"
  $r.Font.Bold = $true; $r.Font.Size = 14
  Add-Para $doc "" | Out-Null
  $doc.TablesOfContents.Add($doc.Paragraphs.Last.Range, $true, 1, 3) | Out-Null
  $doc.Content.InsertParagraphAfter()
  $doc.Paragraphs.Last.Range.InsertBreak($PAGE_BREAK)
  Add-Para $doc "Executive summary" $S_H1 | Out-Null
  $r = Add-Para $doc "Revenue grew by 14% compared with the same quarter last year, driven by the new distribution agreement in Spain. Operating margin improved to 11.2%."
  $fn = Find-Range $doc "11.2%"
  $fn.Collapse(0)
  $doc.Footnotes.Add($fn, $missing, "Operating margin before exceptional items, as defined in the 2025 annual report.") | Out-Null
  foreach ($item in @("Revenue: EUR 48.3 million (+14%)", "Gross margin: 38.5% (+1.2 points)", "Net cash: EUR 12.1 million")) { Add-Para $doc $item $S_LIST_BULLET | Out-Null }
  Add-Para $doc "Trading performance" $S_H1 | Out-Null
  Add-Para $doc "Sales by region" $S_H2 | Out-Null
  $r = Add-Para $doc "All regions grew in the quarter. The chart shows monthly revenue for the last six months; the strongest month was March, when the first shipments under the new agreement were invoiced. Northern Europe remained broadly flat, while Southern Europe more than offset the seasonal slowdown in the United Kingdom. The pipeline for the second quarter is in line with the budget approved in December."
  $shape = $doc.InlineShapes.AddPicture($chart, $false, $true, $r.Paragraphs.Item(1).Range)
  $floating = $shape.ConvertToShape()
  $floating.WrapFormat.Type = 0  # wdWrapSquare
  $floating.Width = 200; $floating.LockAspectRatio = -1
  $floating.RelativeHorizontalPosition = 0   # wdRelativeHorizontalPositionMargin
  $floating.Left = -999996                    # wdShapeRight
  $floating.AlternativeText = "Bar chart of monthly revenue, October to March"
  Add-Para $doc "Costs" $S_H2 | Out-Null
  Add-Para $doc "Staff costs" $S_H3 | Out-Null
  Add-Para $doc "Headcount increased from 212 to 231 employees. The main hires were:" | Out-Null
  foreach ($item in @("four data engineers for the platform programme;", "eight warehouse staff for the Madrid hub;", "a Head of Compliance.")) { Add-Para $doc $item $S_LIST_NUMBER | Out-Null }
  Add-Para $doc "Decisions requested" $S_H1 | Out-Null
  $r = Add-Para $doc "The Board is asked to approve the capital expenditure set out in the appendix and to note the risk register."
  $fn = Find-Range $doc "note the risk register"
  $fn.Collapse(0)
  $doc.Footnotes.Add($fn, $missing, "The risk register is circulated separately to Board members.") | Out-Null
  # Landscape appendix in its own section.
  $doc.Content.InsertParagraphAfter()
  $doc.Paragraphs.Last.Range.InsertBreak($SECTION_NEXT_PAGE)
  $appendix = $doc.Sections.Item($doc.Sections.Count)
  $appendix.PageSetup.Orientation = $ORIENT_LANDSCAPE
  Add-Para $doc "Appendix: capital expenditure" $S_H1 | Out-Null
  Add-Para $doc "" | Out-Null
  $table = $doc.Tables.Add($doc.Paragraphs.Last.Range, 4, 6)
  $table.Borders.Enable = $true
  $rows = @(@("Project", "Owner", "Q2", "Q3", "Q4", "Total"), @("Madrid hub expansion", "Operations", "1.2", "0.8", "0.4", "2.4"), @("Data platform", "Technology", "0.6", "0.6", "0.3", "1.5"), @("Fleet renewal", "Logistics", "0.0", "1.1", "1.1", "2.2"))
  for ($row = 1; $row -le 4; $row++) { for ($col = 1; $col -le 6; $col++) { $table.Cell($row, $col).Range.Text = $rows[$row - 1][$col - 1] } }
  $table.Rows.Item(1).Range.Font.Bold = $true
  $table.Rows.Item(1).HeadingFormat = -1
  $table.Range.InsertCaption("Table", ": Capital expenditure by quarter (EUR million)", $missing, 1) | Out-Null
  $doc.Sections.Item(1).PageSetup.DifferentFirstPageHeaderFooter = -1
  $header = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range
  $header.Text = "Quarterly Board Report - Q1 2026"
  $header.Font.Size = 8
  Add-PageXofY $doc
  $doc.TablesOfContents.Item(1).Update()
  Save-Doc $doc "04-board-report.docx"

  # ---------------------------------------------------------------------------------------
  # 05: Business letter with its own styles: tab stops with dot leaders, first-line and
  # hanging indents, line spacing, highlight, colored text, small caps, double underline,
  # superscript, a manual page break and a different first page.
  Set-Author "Sales Office" "SO"
  $doc = New-Doc
  $body = $doc.Styles.Add("Letter Body", 1)
  $body.BaseStyle = $doc.Styles.Item($S_NORMAL).NameLocal
  $body.Font.Name = "Georgia"; $body.Font.Size = 11
  $body.ParagraphFormat.LineSpacingRule = 5   # wdLineSpaceMultiple
  $body.ParagraphFormat.LineSpacing = 13.8    # 1.15 lines
  $body.ParagraphFormat.SpaceAfter = 8
  $body.ParagraphFormat.FirstLineIndent = 18
  $ref = $doc.Styles.Add("Reference Line", 1)
  $ref.BaseStyle = "Letter Body"
  $ref.ParagraphFormat.FirstLineIndent = 0
  $ref.Font.SmallCaps = $true
  $r = Add-Para $doc "Northwind Traders Limited" "Reference Line"
  $r.Font.Size = 14; $r.Font.Bold = $true
  $r = Add-Para $doc "Our ref: NT/SALES/2026/041" "Reference Line"
  $r.ParagraphFormat.TabStops.Add(451, $TAB_RIGHT, $LEADER_DOTS) | Out-Null
  $r.InsertAfter("`t12 February 2026")
  Add-Para $doc "Ms Laura Petit, Purchasing Director, Litware SAS, 22 rue de la Paix, 75002 Paris, France" "Reference Line" | Out-Null
  $r = Add-Para $doc "Re: Price list for the 2026 season" "Letter Body"
  $r.Font.Bold = $true; $r.ParagraphFormat.FirstLineIndent = 0
  Add-Para $doc "Dear Ms Petit," "Letter Body" | Out-Null
  $r = Add-Para $doc "Thank you for your enquiry of 4 February. We are delighted to confirm our prices for the 2026 season, which remain unchanged for all products ordered before 31 March 2026. Orders placed after that date will be charged at the new rates shown below." "Letter Body"
  $hl = Find-Range $doc "31 March 2026"
  $hl.HighlightColorIndex = 7   # wdYellow
  foreach ($line in @(@("Organic green tea, 250 g", "EUR 8.40"), @("Darjeeling first flush, 100 g", "EUR 12.90"), @("Ceramic teapot, 1 l", "EUR 34.00"))) {
    $p = Add-Para $doc ($line[0] + "`t" + $line[1]) "Letter Body"
    $p.ParagraphFormat.FirstLineIndent = 0
    $p.ParagraphFormat.LeftIndent = 18
    $p.ParagraphFormat.TabStops.Add(400, $TAB_RIGHT, $LEADER_DOTS) | Out-Null
  }
  $r = Add-Para $doc "Delivery is free for orders above EUR 500. Our 2nd delivery window opens on 1 May." "Letter Body"
  $sup = Find-Range $doc "2nd"
  $sup.SetRange($sup.Start + 1, $sup.End)
  $sup.Font.Superscript = $true
  $u = Find-Range $doc "free"
  $u.Font.Underline = 3   # wdUnderlineDouble
  $u.Font.Color = 192     # dark red (BGR)
  $r = Add-Para $doc "Payment terms. Payment is due within thirty days of the invoice date; late payments bear interest at the statutory rate. Please quote our reference on all correspondence." "Letter Body"
  $r.ParagraphFormat.FirstLineIndent = -36
  $r.ParagraphFormat.LeftIndent = 36
  Set-Bold $r "Payment terms."
  Add-Para $doc "We look forward to working with you again this year." "Letter Body" | Out-Null
  $doc.Content.InsertParagraphAfter()
  $doc.Paragraphs.Last.Range.InsertBreak($PAGE_BREAK)
  Add-Para $doc "Enclosure: general terms and conditions of sale (2 pages)." "Letter Body" | Out-Null
  $r = Add-Para $doc "Yours sincerely," "Letter Body"
  $r.ParagraphFormat.FirstLineIndent = 0
  Add-Para $doc "Tom Becker, Sales Director" "Reference Line" | Out-Null
  $doc.Sections.Item(1).PageSetup.DifferentFirstPageHeaderFooter = -1
  $header = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range
  $header.Text = "Litware SAS - 12 February 2026 - page "
  $header.Font.Size = 8
  $hr = $doc.Sections.Item(1).Headers.Item($HF_PRIMARY).Range
  $hr.Collapse(0)
  $doc.Fields.Add($hr, $FIELD_EMPTY, "PAGE", $false) | Out-Null
  Save-Doc $doc "05-business-letter.docx"
}
finally {
  # Each step on its own: one failing must not keep Word running or the others from running. The
  # saved-settings file is removed only once the settings are back.
  if ($null -ne $savedUser) {
    try {
      $word.UserName = $savedUser
      $word.UserInitials = $savedInitials
      $word.Options.UseLocalUserInfo = $savedUseLocal
      Remove-Item $userFile -ErrorAction SilentlyContinue
    } catch { Write-Warning "Could not restore Word's user settings: $_ (the next run restores them)" }
  }
  if ($addedCaptionLabel) {
    try { $word.CaptionLabels.Item("Table").Delete() } catch { Write-Warning "Could not remove the caption label 'Table': $_" }
  }
  try { foreach ($d in @($word.Documents)) { $d.Close(0) } } catch {}
  try { $word.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
