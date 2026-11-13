# Build xa_setup.exe (bo cai GUI) bang Nuitka
#
#   powershell -ExecutionPolicy Bypass -File tool\setup\build-setup.ps1
#
# Sau khi build xong, script in ra SHA-256 + kich thuoc de cap nhat vao
# src/routes/install-info.js neu can, roi upload R2:
#
#   npx wrangler r2 object put "muabankey-assets/files/xa_setup.exe" `
#     --file=tool/dist-setup/xa_setup.exe --content-type=application/octet-stream --remote

$ErrorActionPreference = 'Stop'

$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root    = Split-Path -Parent (Split-Path -Parent $toolDir)
$srcDir  = $toolDir
$distDir = Join-Path $root 'tool\dist-setup'
$exeName = 'xa_setup.exe'

Write-Host ''
Write-Host '=== Build bo cai GUI ===' -ForegroundColor Cyan

# ---- Python ----
$Python = $null
foreach ($c in @('python', 'py')) {
    try {
        $v = & $c --version 2>&1
        if ($LASTEXITCODE -eq 0) { $Python = $c; break }
    } catch { }
}
if (-not $Python) {
    Write-Host '  [X] Khong tim thay Python.' -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] $Python $((& $Python --version 2>&1))"

# ---- tkinter phai co (GUI dung tkinter) ----
& $Python -c "import tkinter" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [X] Python nay thieu tkinter. Cai ban Python co Tcl/Tk.' -ForegroundColor Red
    exit 1
}
Write-Host '  [OK] tkinter co san'

# ---- Nuitka ----
& $Python -c "import nuitka" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [*] Cai Nuitka...' -ForegroundColor Yellow
    & $Python -m pip install --quiet nuitka ordered-set zstandard
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [X] Cai Nuitka that bai.' -ForegroundColor Red
        exit 1
    }
}
Write-Host "  [OK] Nuitka $((& $Python -m nuitka --version 2>&1 | Select-Object -First 1))"

# ---- Selftest TRUOC khi build ----
Write-Host ''
Write-Host '  [*] Selftest truoc khi build...' -ForegroundColor Yellow
Push-Location $srcDir
try {
    & $Python xa_setup.py --selftest
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [X] Selftest FAIL -- dung build.' -ForegroundColor Red
        exit 1
    }
}
finally { Pop-Location }
Write-Host '  [OK] Selftest PASS'

# ---- Clean ----
Remove-Item -Recurse -Force $distDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

# ---- Build ----
# --windows-console-mode=disable: day la GUI, khong hien cua so den.
# --windows-uac-admin: manifest xin quyen Administrator NGAY KHI MO FILE.
#   Day la cach duy nhat dam bao CHI MOT cua so: Windows nang quyen truoc khi
#   chuong trinh chay, khong can tu khoi chay lai (relaunch sinh cua so thu 2).
# --enable-plugin=tk-inter: Nuitka can biet de gom Tcl/Tk.
Write-Host ''
Write-Host '  [*] Dang build (3-6 phut)...' -ForegroundColor Yellow
Push-Location $srcDir
try {
    & $Python -m nuitka `
        --onefile `
        --windows-console-mode=disable `
        --windows-uac-admin `
        --assume-yes-for-downloads `
        --enable-plugin=tk-inter `
        --include-module=tkinter `
        --output-dir=$distDir `
        --output-filename=$exeName `
        --remove-output `
        --no-pyi-file `
        --nofollow-import-to=unittest `
        --nofollow-import-to=pydoc `
        --nofollow-import-to=lib2to3 `
        --nofollow-import-to=setuptools `
        --nofollow-import-to=pip `
        --python-flag=no_docstrings `
        --python-flag=no_annotations `
        xa_setup.py

    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [X] Build that bai.' -ForegroundColor Red
        exit 1
    }
}
finally { Pop-Location }

# ---- Ket qua ----
$exe = Join-Path $distDir $exeName
if (-not (Test-Path $exe)) {
    Write-Host "  [X] Khong thay $exe" -ForegroundColor Red
    exit 1
}

$size = (Get-Item $exe).Length
$sha  = (Get-FileHash $exe -Algorithm SHA256).Hash

Write-Host ''
Write-Host '=== XONG ===' -ForegroundColor Green
Write-Host "  File : $exe"
Write-Host "  Size : $size"
Write-Host "  SHA  : $sha"
Write-Host ''
Write-Host '  [*] Kiem tra EXE chay duoc:'
& $exe --selftest
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [!] EXE selftest FAIL -- kiem tra lai truoc khi upload.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  Buoc tiep theo -- upload len R2:' -ForegroundColor Cyan
Write-Host '    npx wrangler r2 object put "muabankey-assets/files/xa_setup.exe" `'
Write-Host "      --file=$exe --content-type=application/octet-stream --remote"
