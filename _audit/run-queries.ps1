param([string]$File)
# Run each SQL statement (separated by ;--) separately via wrangler --command --json
$env:CLOUDFLARE_API_TOKEN="cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6"
$env:CLOUDFLARE_ACCOUNT_ID="5b62d10947844251d23e0eac532531dd"
$raw = Get-Content -Raw -Path $File
$blocks = $raw -split '(?m)^--=(.+)$' | Where-Object { $_.Trim() -ne '' }
$i = 0
$label = ''
while ($i -lt $blocks.Count) {
  $b = $blocks[$i]
  if ($b -match '^\s*--' ) { $i++; continue }
  $i++
}
# simpler: split on lines starting with '--@'
$parts = $raw -split "(?m)^--@"
foreach ($p in $parts) {
  if ($p.Trim() -eq '') { continue }
  $lines = $p -split "`r?`n"
  $name = $lines[0].Trim()
  $sql = ($lines[1..($lines.Count-1)] -join "`n").Trim()
  if ($sql -eq '') { continue }
  $sql = $sql -replace '\s+', ' '
  Write-Output "===== $name"
  $out = npx wrangler d1 execute muabankey-db --remote --json --command="$sql" 2>$null
  $txt = ($out -join "`n")
  $start = $txt.IndexOf('[')
  if ($start -ge 0) {
    $json = $txt.Substring($start)
    try {
      $obj = $json | ConvertFrom-Json
      $obj[0].results | ConvertTo-Json -Depth 8 -Compress
    } catch { Write-Output "PARSE_FAIL"; Write-Output $txt }
  } else { Write-Output "NO_RESULT"; Write-Output $txt }
}
