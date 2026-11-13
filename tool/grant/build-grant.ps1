# Build XAGrant EXE (Nuitka)
#
# Nuitka bien dich Python -> C -> may that. EXE khong con bytecode Python,
# nen `uncompyle6` / `pycdc` / `decompyle3` khong lay lai duoc source.
# Ket hop voi viec bang dia chi engine chi ton tai dang ma hoa trong token
# da ky, nguoi doc binary cung khong biet tool goi vao dau.
#
# Cach dung:
#   cd tool\grant
#   powershell -File build-grant.ps1
#
#   -SkipUpload   khong upload R2
#   -Clean        xoa ban build cu truoc

param(
    [switch]$SkipUpload,
    [switch]$Clean,
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$toolDir  = $PSScriptRoot
$srcDir   = Join-Path $toolDir 'src'
$distDir  = Join-Path $toolDir 'dist'
$buildDir = Join-Path $toolDir '.build'
$rootDir  = Split-Path (Split-Path $toolDir -Parent) -Parent
$EXE_NAME = 'xa_grant.exe'

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '    Build XArena Grant' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

# ---- 1. Python ----
$pyv = & $Python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [X] Khong tim thay python ($Python)" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] $pyv" -ForegroundColor Green

# ---- 2. Sinh bang hang so da ma hoa ----
# Public key + SPLIT_A doc truc tiep tu src/routes/xa-grant-server.js,
# nen hai ben khong bao gio lech nhau.
Write-Host '  [*] Sinh bang hang so (gen_const.py)...'
& $Python (Join-Path $srcDir 'gen_const.py')
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] gen_const.py that bai' -ForegroundColor Red
    exit 1
}

# ---- 3. Syntax ----
Write-Host '  [*] Kiem tra syntax...'
& $Python -m py_compile `
    (Join-Path $srcDir 'xa_sec.py') `
    (Join-Path $srcDir 'xa_grant_lic.py') `
    (Join-Path $srcDir 'xa_const.py') `
    (Join-Path $toolDir 'xa_grant.py')
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] Loi syntax, dung build' -ForegroundColor Red
    exit 1
}
Write-Host '  [OK] Syntax hop le' -ForegroundColor Green

# ---- 4. Nuitka ----
& $Python -c "import nuitka" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [*] Cai Nuitka...' -ForegroundColor Yellow
    & $Python -m pip install --quiet nuitka ordered-set zstandard
}
$nv = (& $Python -m nuitka --version 2>&1 | Select-Object -First 1)
Write-Host "  [OK] Nuitka $nv" -ForegroundColor Green

# ---- 5. Clean ----
if ($Clean) {
    Write-Host '  [*] Xoa ban build cu...'
    Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $distDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

# ---- 6. Build ----
# --onefile: installer chi phai tai MOT file .exe (khop hop dong hien co).
# --windows-console-mode=force: tool nay chay bang CMD nen LUON can console.
Write-Host ''
Write-Host '  [*] Dang build (2-5 phut)...' -ForegroundColor Yellow
Push-Location $srcDir
try {
    & $Python -m nuitka `
        --onefile `
        --windows-console-mode=force `
        --assume-yes-for-downloads `
        --output-dir=$distDir `
        --output-filename=$EXE_NAME `
        --remove-output `
        --no-pyi-file `
        --include-module=xa_grant_sec `
        --include-module=xa_grant_const `
        --include-module=xa_grant_guard `
        --nofollow-import-to=tkinter `
        --nofollow-import-to=unittest `
        --nofollow-import-to=pydoc `
        --nofollow-import-to=lib2to3 `
        --nofollow-import-to=setuptools `
        --nofollow-import-to=pip `
        --python-flag=no_docstrings `
        --python-flag=no_annotations `
        --python-flag=no_asserts `
        --python-flag=no_site `
        "$toolDir\xa_grant.py"
    $buildRc = $LASTEXITCODE
} finally {
    Pop-Location
}

$exePath = Join-Path $distDir $EXE_NAME
if ($buildRc -ne 0 -or -not (Test-Path $exePath)) {
    Write-Host '  [X] Build that bai' -ForegroundColor Red
    exit 1
}

# ---- 7. Bao cao ----
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

# ---- 8. Cap nhat installer.js ----
$instFile = Join-Path $rootDir 'src\routes\xa-grant-installer.js'
if (Test-Path $instFile) {
    $content = [System.IO.File]::ReadAllText($instFile)
    $content = [regex]::Replace($content,
        "const EXE_SHA256 = '[A-Fa-f0-9]*';",
        "const EXE_SHA256 = '$sha';")
    $content = [regex]::Replace($content,
        'const EXE_SIZE = \d+;',
        "const EXE_SIZE = $size;")
    [System.IO.File]::WriteAllText($instFile, $content,
        (New-Object System.Text.UTF8Encoding $false))
    Write-Host '  [OK] Da cap nhat src/routes/xa-grant-installer.js' -ForegroundColor Green
    Write-Host '       Nho chay: npx wrangler deploy' -ForegroundColor Yellow
} else {
    Write-Host "  [!] Khong thay $instFile" -ForegroundColor Yellow
}
Write-Host ''

# ---- 9. Upload R2 ----
if (-not $SkipUpload) {
    $ans = Read-Host "  Upload len R2 (files/$EXE_NAME)? (y/n)"
    if ($ans -eq 'y') {
        if (-not $env:CLOUDFLARE_API_TOKEN) {
            Write-Host '  [!] Thieu CLOUDFLARE_API_TOKEN' -ForegroundColor Yellow
        } else {
            Push-Location $rootDir
            try {
                npx --yes wrangler@4 r2 object put "muabankey-assets/files/$EXE_NAME" `
                    --file=$exePath --content-type="application/octet-stream" --remote
                Write-Host '  [OK] Da upload' -ForegroundColor Green
            } finally {
                Pop-Location
            }
        }
    }
}

Write-Host ''
Write-Host '  Xong.' -ForegroundColor Cyan
Write-Host ''
