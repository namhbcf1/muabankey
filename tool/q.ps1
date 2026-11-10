param([Parameter(Mandatory=$true)][string]$Sql, [string]$File)
$env:CLOUDFLARE_API_TOKEN="cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6"
$env:CLOUDFLARE_ACCOUNT_ID="5b62d10947844251d23e0eac532531dd"
if ($File) {
  npx wrangler d1 execute muabankey-db --remote --json --file=$File 2>&1
} else {
  npx wrangler d1 execute muabankey-db --remote --json --command=$Sql 2>&1
}
