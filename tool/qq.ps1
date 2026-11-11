param([Parameter(Mandatory=$true)][string]$Sql, [switch]$Raw)
# Credentials lấy từ .env (đã gitignore). KHÔNG hardcode token vào file này.
. (Join-Path $PSScriptRoot '..\scripts\load-env.ps1') | Out-Null
$out = npx wrangler d1 execute muabankey-db --remote --json --command=$Sql 2>&1 | Out-String
if ($Raw) { Write-Host $out; return }
# extract JSON from first '[' to last ']'
$i = $out.IndexOf('[')
$j = $out.LastIndexOf(']')
if ($i -lt 0 -or $j -lt 0) { Write-Host "PARSE_FAIL"; Write-Host $out; return }
$json = $out.Substring($i, $j - $i + 1)
try {
  $parsed = $json | ConvertFrom-Json
  $rows = $parsed[0].results
  if ($null -eq $rows -or $rows.Count -eq 0) { Write-Host "(no rows)"; return }
  $rows | Format-Table -AutoSize | Out-String -Width 400
} catch { Write-Host "JSONERR: $($_.Exception.Message)"; Write-Host $json }
