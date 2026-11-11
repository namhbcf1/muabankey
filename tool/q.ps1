param([Parameter(Mandatory=$true)][string]$Sql, [string]$File)
# Credentials lấy từ .env (đã gitignore). KHÔNG hardcode token vào file này:
# token từng bị commit ở đây và trong README, phải coi là đã lộ.
. (Join-Path $PSScriptRoot '..\scripts\load-env.ps1') | Out-Null
if ($File) {
  npx wrangler d1 execute muabankey-db --remote --json --file=$File 2>&1
} else {
  npx wrangler d1 execute muabankey-db --remote --json --command=$Sql 2>&1
}
