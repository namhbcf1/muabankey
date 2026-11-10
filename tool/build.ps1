# Build XArena No Fog EXE
#
# Cach dung:
#   cd tool
#   powershell -File build.ps1
#
# Sau khi build xong:
#   - EXE nam o tool\dist\xa_nofog_pro.exe
#   - Script in ra SHA-256 + size de cap nhat vao src/routes/installer.js
#   - Tu dong upload len R2 neu co bien CLOUDFLARE_API_TOKEN

param(
    [switch]$SkipUpload,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$toolDir = $PSScriptRoot
$srcDir  = Join-Path $toolDir 'src'
$distDir = Join-Path $toolDir 'dist'
$buildDir = Join-Path $toolDir '.build'
$rootDir = Split-Path $toolDir -Parent

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '    Build XArena No Fog' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

# ---- Kiem tra Python ----
try {
    $pyv = python --version 2>&1
    Write-Host "  [OK] $pyv" -ForegroundColor Green
} catch {
    Write-Host '  [X] Khong tim thay python' -ForegroundColor Red
    exit 1
}

# ---- Kiem tra PyInstaller ----
$hasPyInstaller = $false
try {
    python -c "import PyInstaller" 2>$null
    $hasPyInstaller = $true
} catch { }

if (-not $hasPyInstaller) {
    Write-Host '  [*] Cai PyInstaller...' -ForegroundColor Yellow
    python -m pip install --quiet pyinstaller
}

# ---- Kiem tra syntax truoc khi build ----
Write-Host '  [*] Kiem tra syntax...'
python -m py_compile (Join-Path $srcDir 'xa_nofog_pro.py') (Join-Path $srcDir 'xa_config.py')
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] Loi syntax, dung build' -ForegroundColor Red
    exit 1
}
Write-Host '  [OK] Syntax hop le' -ForegroundColor Green

# ---- Hien thi cau hinh hien tai ----
Write-Host ''
Write-Host '  Cau hinh (tu src/xa_config.py):' -ForegroundColor DarkGray
python -c @"
import sys
sys.path.insert(0, r'$srcDir')
import xa_config as c
print('    API_BASE :', c.API_BASE)
print('    APP_NAME :', c.APP_NAME)
print('    GAME     :', ', '.join(c.PROCESS_NAMES))
"@
Write-Host ''

# ---- Clean ----
if ($Clean) {
    Write-Host '  [*] Xoa ban build cu...'
    Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $distDir -ErrorAction SilentlyContinue
}

# ---- Build ----
Write-Host '  [*] Dang build EXE (co the mat 1-2 phut)...'
Push-Location $srcDir
try {
    python -m PyInstaller `
        --onefile `
        --name xa_nofog_pro `
        --distpath $distDir `
        --workpath $buildDir `
        --specpath $buildDir `
        --noconfirm `
        --clean `
        --uac-admin `
        xa_nofog_pro.py 2>&1 | Out-Null
} finally {
    Pop-Location
}

$exePath = Join-Path $distDir 'xa_nofog_pro.exe'
if (-not (Test-Path $exePath)) {
    Write-Host '  [X] Build that bai' -ForegroundColor Red
    exit 1
}

# ---- Thong tin EXE ----
$item = Get-Item -LiteralPath $exePath
$sha  = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
$size = $item.Length

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host '    BUILD XONG' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  File      : $exePath"
Write-Host "  Kich thuoc: $size bytes ($([math]::Round($size/1MB,2)) MB)"
Write-Host "  SHA-256   : $sha"
Write-Host ''

# ---- Cap nhat installer.js ----
$installerFile = Join-Path $rootDir 'src\routes\installer.js'
if (Test-Path $installerFile) {
    $ans = Read-Host '  Cap nhat SHA-256 + size vao src/routes/installer.js? (y/n)'
    if ($ans -eq 'y') {
        $content = [System.IO.File]::ReadAllText($installerFile)
        $content = [regex]::Replace($content, "const EXE_SHA256 = '[A-F0-9]+';", "const EXE_SHA256 = '$sha';")
        $content = [regex]::Replace($content, 'const EXE_SIZE = \d+;', "const EXE_SIZE = $size;")
        [System.IO.File]::WriteAllText($installerFile, $content, (New-Object System.Text.UTF8Encoding $false))
        Write-Host '  [OK] Da cap nhat installer.js' -ForegroundColor Green
        Write-Host '       Nho chay: npx wrangler deploy' -ForegroundColor Yellow
    }
}

# ---- Upload R2 ----
if (-not $SkipUpload) {
    $ans = Read-Host '  Upload len R2? (y/n)'
    if ($ans -eq 'y') {
        if (-not $env:CLOUDFLARE_API_TOKEN) {
            Write-Host '  [!] Thieu CLOUDFLARE_API_TOKEN' -ForegroundColor Yellow
        } else {
            Push-Location $rootDir
            try {
                npx --yes wrangler@4 r2 object put "muabankey-assets/files/xa_nofog_pro.exe" `
                    --file=$exePath --content-type="application/octet-stream" --remote
                Write-Host '  [OK] Da upload' -ForegroundColor Green
            } finally {
                Pop-Location
            }
        }
    }
}

# ---- Cap nhat ban local (chay truc tiep) ----
$localExe = 'C:\Program Files\XArena\_re\chayduoc\xa_nofog_pro.exe'
if (Test-Path $localExe) {
    $ans = Read-Host '  Chep de len ban dang chay o Program Files? (y/n)'
    if ($ans -eq 'y') {
        Copy-Item -LiteralPath $exePath -Destination $localExe -Force
        Write-Host '  [OK] Da cap nhat ban local' -ForegroundColor Green
    }
}

Write-Host ''
Write-Host '  Xong.' -ForegroundColor Cyan
Write-Host ''
