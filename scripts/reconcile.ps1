param([Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference = 'Stop'
$excel = $null
$book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3
  $book = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $true)
  $excel.CalculateFullRebuild()
  $sheet = $book.Worksheets.Item('Comparison')
  $values = @()
  $row = 2
  while ($sheet.Cells.Item($row,1).Text -ne '') {
    $values += @{ vendor = [string]$sheet.Cells.Item($row,1).Text; total = [double]$sheet.Cells.Item($row,2).Value2 }
    $row++
    if ($row -gt 100) { throw 'Comparison has too many rows' }
  }
  ConvertTo-Json -InputObject @($values) -Compress -Depth 4
} finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
