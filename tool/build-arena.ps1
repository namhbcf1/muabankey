# Build XA ARENA (xa_arena.exe) bang Nuitka
#
# Cach dung:
#   cd tool
#   powershell -ExecutionPolicy Bypass -File build-arena.ps1
#   powershell -ExecutionPolicy Bypass -File build-arena.ps1 -SkipUpload
#   powershell -ExecutionPolicy Bypass -File build-arena.ps1 -SkipSign   # chi khi test noi bo
#
# VI SAO CO SCRIPT NAY:
#   build.ps1 cu build xa_nofog_pro.exe — san pham DA BO. Khong co script nao
#   build xa_arena.exe, nen moi lan phat hanh deu phai go lenh tay va rat de
#   quen tang version hoac quen cap nhat hash.
#
# Script nay lam du 7 viec:
#   1. Kiem tra version Python <-> server khop nhau
#   2. Nhung VERSION RESOURCE (CompanyName/ProductName/FileVersion)
#   3. Build bang Nuitka (onefile, PyQt6, khong console)
#   4. KY Authenticode + timestamp            <-- P0, truoc day KHONG CO
#   5. Tinh SHA-256 + size SAU KHI KY         <-- P0, ky truoc roi moi bam
#   6. Sinh release/manifest.json tu bytes da ky (khong con hang so viet tay)
#   7. (tuy chon) upload R2 + deploy
#
# VI SAO THU TU 4 -> 5 -> 6 QUAN TRONG:
#   Ky so lam THAY DOI bytes cua file. Neu bam SHA-256 truoc khi ky roi moi ky,
#   hash trong manifest se KHONG bao gio khop voi file khach tai ve -> app tu
#   choi cap nhat (hoac te hon: coi la ban gia mao).

param(
    [switch]$SkipUpload,
    [switch]$SkipSign,
    [switch]$Clean,
    [string]$CertThumbprint = $env:XA_SIGN_THUMBPRINT,
    [string]$TimestampUrl   = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$toolDir = $PSScriptRoot
$rootDir = Split-Path $toolDir -Parent
$appDir  = Join-Path $toolDir 'app'
$outDir  = Join-Path $toolDir 'dist-arena'
$workDir = Join-Path $toolDir '.build-arena'

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '    Build XA ARENA (mot file duy nhat)' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

# ---- 1. Kiem tra version khop -------------------------------------------------
#
# `EXE_VERSION` KHONG CON trong arena-installer.js: server doc manifest sinh
# tu bytes (xem tool/release.mjs). Vi vay chi so version that su ton tai la:
#   - APP_VERSION trong xa_arena_app.py  (app tu khai)
#   - release/manifest.json              (ban da phat hanh gan nhat)
# Neu manifest cu con ton tai thi version moi PHAI LON HON, neu khong app da
# cai se khong bao gio thay ban moi (app so sanh bang cach so version).
Write-Host '  [*] Kiem tra version...'
$appVer = (Select-String -Path (Join-Path $appDir 'xa_arena_app.py') -Pattern "^APP_VERSION\s*=\s*'([^']+)'" |
    Select-Object -First 1).Matches.Groups[1].Value
if (-not $appVer) { Write-Host '  [X] Khong doc duoc APP_VERSION trong xa_arena_app.py' -ForegroundColor Red; exit 1 }

$prevManifestPath = Join-Path $rootDir 'release\manifest.json'
if (Test-Path $prevManifestPath) {
    $prev = Get-Content $prevManifestPath -Raw | ConvertFrom-Json
    Write-Host "      App (moi) : $appVer"
    Write-Host "      Da phat hanh: $($prev.version)"
    if ($prev.version) {
        $a = ($appVer -split '\.'); $b = ($prev.version -split '\.')
        $cmp = 0
        for ($i = 0; $i -lt 4; $i++) {
            $x = if ($i -lt $a.Count -and $a[$i] -match '^\d+$') { [int]$a[$i] } else { 0 }
            $y = if ($i -lt $b.Count -and $b[$i] -match '^\d+$') { [int]$b[$i] } else { 0 }
            if ($x -gt $y) { $cmp = 1; break }
            if ($x -lt $y) { $cmp = -1; break }
        }
        if ($cmp -eq 0) {
            Write-Host ''
            Write-Host '  [X] VERSION KHONG DOI.' -ForegroundColor Red
            Write-Host '      App ep cap nhat bang cach SO VERSION. Bang nhau thi khong ai' -ForegroundColor Yellow
            Write-Host '      nhan duoc ban moi. Tang APP_VERSION roi build lai.' -ForegroundColor Yellow
            exit 1
        }
        if ($cmp -lt 0) {
            Write-Host ''
            Write-Host '  [X] VERSION LUI (nho hon ban da phat hanh).' -ForegroundColor Red
            Write-Host '      Khach da len ban moi se bi coi la "moi hon" va khong cap nhat.' -ForegroundColor Yellow
            exit 1
        }
    }
    Write-Host '  [OK] Version moi lon hon ban da phat hanh' -ForegroundColor Green
} else {
    Write-Host "      App: $appVer (chua co manifest truoc do)"
    Write-Host '  [OK] Ban phat hanh dau tien' -ForegroundColor Green
}

# ---- 2. Chuan bi moi truong MSVC ---------------------------------------------
Write-Host ''
Write-Host '  [*] Chuan bi MSVC...'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    Write-Host '  [X] Khong tim thay vswhere — can Visual Studio Build Tools' -ForegroundColor Red
    exit 1
}
$vsPath = (& $vswhere -latest -products * -property installationPath).Trim()
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) {
    Write-Host "  [X] Khong thay vcvars64.bat tai $vcvars" -ForegroundColor Red
    exit 1
}
# Nap bien moi truong MSVC vao phien PowerShell hien tai
$envDump = cmd /c "`"$vcvars`" >nul 2>&1 && set"
foreach ($line in $envDump) {
    if ($line -match '^([^=]+)=(.*)$') {
        $k = $matches[1]; $v = $matches[2]
        [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
}
if (-not (Get-Command cl -ErrorAction SilentlyContinue)) {
    Write-Host '  [X] cl.exe van khong co trong PATH' -ForegroundColor Red
    exit 1
}
Write-Host '  [OK] MSVC san sang' -ForegroundColor Green

# ---- 2b. Sinh version resource ------------------------------------------------
#
# EXE dang phat hanh co VersionInfo RONG (FileVersion 0.0.0.0, khong
# CompanyName) -> SmartScreen khong co gi de doi chieu, Properties > Details
# trong trong. Sinh file .rc tu template, thay __XA_VERSION__ bang APP_VERSION.
Write-Host ''
Write-Host '  [*] Sinh version resource...'
$rcTemplate = Join-Path $toolDir 'build\version.rc'
if (-not (Test-Path $rcTemplate)) {
    Write-Host "  [X] Khong thay template: $rcTemplate" -ForegroundColor Red
    exit 1
}
$rcOut = Join-Path $workDir 'version.rc'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$rcText = [System.IO.File]::ReadAllText($rcTemplate).Replace('__XA_VERSION__', $appVer)
# VERSIONINFO can 4 so: "3.1.0.0" -> 3,1,0,0
$vparts = ($appVer -split '\.') + @('0','0','0','0')
$vtuple = ($vparts[0..3] | ForEach-Object { if ($_ -match '^\d+$') { $_ } else { '0' } }) -join ','
$rcText = $rcText.Replace('FILEVERSION     1,0,0,0',      "FILEVERSION     $vtuple")
$rcText = $rcText.Replace('PRODUCTVERSION  1,0,0,0',     "PRODUCTVERSION  $vtuple")
[System.IO.File]::WriteAllText($rcOut, $rcText, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  [OK] version.rc ($appVer)" -ForegroundColor Green

# ---- 3. Clean ----------------------------------------------------------------
if ($Clean) {
    Write-Host ''
    Write-Host '  [*] Xoa ban build cu...'
    Remove-Item -Recurse -Force (Join-Path $toolDir '.build-arena') -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
}

# ---- 4. Build ----------------------------------------------------------------
Write-Host ''
Write-Host '  [*] Dang build (co the mat 10-30 phut)...' -ForegroundColor Yellow
Write-Host ''

$env:PYTHONPATH = "$toolDir\ui;$toolDir\src;$toolDir\grant;$toolDir\app"

# Cac module duoc import DONG (trong ham) nen Nuitka khong tu thay:
#   xa_nofog_gui_qt  <- import trong xa_nofog_pro.run()
#   xa_uninstall     <- import trong xa_arena_app
#   xa_update/xa_theme/xa_trial_rules/xa_arena_api/xa_arena_gui <- PYTHONPATH
$nuitkaArgs = @(
    '-m', 'nuitka',
    '--onefile',
    '--windows-console-mode=disable',   # subsystem GUI: bam dup la mo, khong hien console
    '--windows-version-file', $rcOut,   # P0: version resource (CompanyName/FileVersion)
    '--enable-plugin=pyqt6',
    '--output-filename=xa_arena.exe',
    '--output-dir', $outDir,
    '--assume-yes-for-downloads',
    '--remove-output',
    '--include-module=xa_update',
    '--include-module=xa_theme',
    '--include-module=xa_trial_rules',
    '--include-module=xa_arena_api',
    '--include-module=xa_arena_gui',
    '--include-module=xa_grant',
    '--include-module=xa_grant_sec',
    '--include-module=xa_grant_guard',
    '--include-module=xa_grant_const',
    '--include-module=xa_nofog_pro',
    '--include-module=xa_nofog_sec',
    '--include-module=xa_nofog_const',
    '--include-module=xa_nofog_gui_qt',
    '--include-module=xa_config',
    '--include-module=xa_uninstall',
    (Join-Path $appDir 'xa_arena_app.py')
)

& python @nuitkaArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [X] Build THAT BAI' -ForegroundColor Red
    exit 1
}

$exePath = Join-Path $outDir 'xa_arena.exe'
if (-not (Test-Path $exePath)) {
    Write-Host '  [X] Khong thay file EXE sau khi build' -ForegroundColor Red
    exit 1
}

# ---- 4b. KY AUTHENTICODE -----------------------------------------------------
#
# P0: EXE phat hanh truoc day KHONG duoc ky (Get-AuthenticodeSignature =
# NotSigned). Hau qua that:
#   - SmartScreen: "Windows protected your PC / Unknown publisher"
#   - Defender de gan nhan HackTool (EXE dung OpenProcess + CreateRemoteThread)
#   - Moi ban build lai ve 0 reputation -> khach luon gap canh bao
#   - Khong chung minh duoc file khach tai ve dung la file shop phat hanh
#
# PHai ky TRUOC khi bam SHA-256: ky lam thay doi bytes cua file.
Write-Host ''
if ($SkipSign) {
    Write-Host '  [!] BO QUA KY SO (-SkipSign).' -ForegroundColor Yellow
    Write-Host '      Chi dung cho ban thu nghiem noi bo, KHONG phat hanh ban nay.' -ForegroundColor Yellow
    $signed = $false
} else {
    Write-Host '  [*] Ky Authenticode...'
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) {
        # thu tim trong Windows SDK
        $sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
        if (Test-Path $sdkRoot) {
            $signtool = Get-ChildItem -Path $sdkRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\' } |
                Sort-Object FullName -Descending |
                Select-Object -First 1
        }
    }
    if (-not $signtool) {
        Write-Host '  [X] Khong tim thay signtool.exe (can Windows SDK).' -ForegroundColor Red
        Write-Host '      Chay lai voi -SkipSign neu chi muon build thu.' -ForegroundColor Yellow
        exit 1
    }
    if (-not $CertThumbprint) {
        Write-Host '  [X] Thieu chung chi ky so.' -ForegroundColor Red
        Write-Host '      Dat $env:XA_SIGN_THUMBPRINT = thumbprint chung chi, hoac -CertThumbprint.' -ForegroundColor Yellow
        Write-Host '      Khong the phat hanh EXE chua ky (xem phan dau file).' -ForegroundColor Yellow
        exit 1
    }
    $signArgs = @(
        'sign', '/sha1', $CertThumbprint,
        '/fd', 'SHA256',
        '/tr', $TimestampUrl, '/td', 'SHA256',
        '/d', 'XA ARENA', $exePath
    )
    & $signtool @signArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '  [X] KY THAT BAI' -ForegroundColor Red
        Write-Host '      Khong phat hanh EXE chua ky. Kiem tra lai chung chi + timestamp.' -ForegroundColor Yellow
        exit 1
    }
    $sig = Get-AuthenticodeSignature -LiteralPath $exePath
    if ($sig.Status -ne 'Valid') {
        Write-Host "  [X] Chu ky khong hop le: $($sig.Status)" -ForegroundColor Red
        Write-Host "      $($sig.StatusMessage)" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  [OK] Da ky: $($sig.SignerCertificate.Subject)" -ForegroundColor Green
    $signed = $true
}

# ---- 5. Thong tin EXE (BAM SAU KHI KY) ---------------------------------------
$item = Get-Item -LiteralPath $exePath
$sha  = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
$size = $item.Length
$verInfo = $item.VersionInfo

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host '    BUILD XONG' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Version   : $appVer"
Write-Host "  File      : $exePath"
Write-Host "  Kich thuoc: $size bytes ($([math]::Round($size/1MB,2)) MB)"
Write-Host "  SHA-256   : $sha"
Write-Host "  Ky so     : $(if ($signed) { 'CO (da ky + timestamp)' } else { 'KHONG — ban thu nghiem' })"
Write-Host "  FileVer   : $($verInfo.FileVersion)  Product: $($verInfo.ProductName)"
Write-Host ''

if (-not $signed) {
    Write-Host '  [!] Ban nay CHUA KY — KHONG duoc cap nhat hash vao server.' -ForegroundColor Yellow
    Write-Host '      Khach se thay canh bao SmartScreen va khong xac minh duoc nguon goc.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Xong (ban thu nghiem).' -ForegroundColor Cyan
    exit 0
}

# ---- 6. Sinh MANIFEST PHÁT HÀNH từ bytes của file ĐÃ KÝ ---------------------
#
# Trước đây bước này ghi tay `EXE_SHA256`/`EXE_SIZE` vào arena-installer.js và
# hỏi "y/n". Nay ba hằng số đó ĐÃ BỊ XOÁ: server đọc `release/manifest.json`
# do `tool/release.mjs` sinh ra TỪ BYTES. Nhờ vậy:
#   - không có con số nào phải sửa tay khi phát hành
#   - hash luôn là hash ĐO ĐƯỢC của file (băm SAU khi ký)
#   - server trả `verified:false` nếu chưa có manifest, thay vì bịa hash
Write-Host ''
Write-Host '  [*] Sinh release/manifest.json tu bytes cua file da ky...'
$manifestDir = Join-Path $rootDir 'release'
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

Push-Location $rootDir
try {
    & node tool/release.mjs --exe $exePath --version $appVer --channel stable
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [X] Sinh manifest THAT BAI. DUNG LAI.' -ForegroundColor Red
        exit 1
    }

    # Kiem lai: manifest phai khop dung bytes dang nam tren dia.
    if (-not $SkipUpload) {
        & node tool/release.mjs --verify release/manifest.json --exe $exePath
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  [X] Manifest KHONG khop voi file EXE. DUNG LAI.' -ForegroundColor Red
            exit 1
        }
    }
} finally {
    Pop-Location
}

$manifestPath = Join-Path $manifestDir 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    Write-Host '  [X] Khong thay release/manifest.json sau khi sinh.' -ForegroundColor Red
    exit 1
}
$mf = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($mf.sha256 -ne $sha) {
    Write-Host "  [X] Hash manifest ($($mf.sha256)) KHONG khop hash file ($sha)." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] manifest.json: v$($mf.version)  $($mf.sha256.Substring(0,16))...  $($mf.size) B" -ForegroundColor Green
Write-Host ''
Write-Host '  [!] Server doc manifest qua bien moi truong RELEASE_MANIFEST.' -ForegroundColor Yellow
Write-Host '      Dat noi dung release/manifest.json vao secret do truoc khi deploy:' -ForegroundColor Yellow
Write-Host '        npx wrangler secret put RELEASE_MANIFEST < release\manifest.json' -ForegroundColor Gray
Write-Host '      Neu khong dat, /api/app/version tra verified:false (trang tai hien' -ForegroundColor Yellow
Write-Host '      "chua xac minh" thay vi mot hash trong nhu da kiem).' -ForegroundColor Yellow

# ---- 7. Upload R2 + deploy ---------------------------------------------------
if (-not $SkipUpload) {
    Write-Host ''
    $ans = Read-Host '  Upload len R2 va deploy? (y/n)'
    if ($ans -eq 'y') {
        Push-Location $rootDir
        try {
            npx --no-install wrangler r2 object put "muabankey-assets/files/xa_arena.exe" `
                --file=$exePath --content-type="application/octet-stream" --remote
            if ($LASTEXITCODE -ne 0) { throw 'Upload R2 that bai' }
            Write-Host '  [OK] Da upload R2' -ForegroundColor Green

            npx --no-install wrangler deploy
            if ($LASTEXITCODE -ne 0) { throw 'Deploy that bai' }
            Write-Host '  [OK] Da deploy' -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
}

Write-Host ''
Write-Host '  Xong.' -ForegroundColor Cyan
Write-Host ''
