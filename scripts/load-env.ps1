# Nap credentials Cloudflare vao session PowerShell hien tai.
#
# Dung:  . .\scripts\load-env.ps1
#        npx wrangler@4 deploy
#
# Phai dung "." (dot-source) chu khong phai "&": "&" chay tien trinh con nen
# bien moi truong se mat ngay khi script ket thuc.

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

if (-not (Test-Path $envFile)) {
    Write-Error "Khong tim thay $envFile - tao file nay voi CLOUDFLARE_API_TOKEN va CLOUDFLARE_ACCOUNT_ID."
    return
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($value.Length -ge 2) {
        $first = $value.Substring(0, 1)
        $last = $value.Substring($value.Length - 1, 1)
        if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }
    Set-Item -Path "Env:$name" -Value $value
}

# Chi xac nhan da nap, khong in gia tri token.
if ($env:CLOUDFLARE_API_TOKEN) {
    $len = $env:CLOUDFLARE_API_TOKEN.Length
    $head = $env:CLOUDFLARE_API_TOKEN.Substring(0, 5)
    Write-Host "CLOUDFLARE_API_TOKEN  : da nap ($len ky tu, bat dau bang $head...)"
} else {
    Write-Warning "CLOUDFLARE_API_TOKEN chua duoc nap"
}

if ($env:CLOUDFLARE_ACCOUNT_ID) {
    Write-Host "CLOUDFLARE_ACCOUNT_ID : $env:CLOUDFLARE_ACCOUNT_ID"
} else {
    Write-Warning "CLOUDFLARE_ACCOUNT_ID chua duoc nap"
}