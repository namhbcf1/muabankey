# Ky so cac file .exe phat hanh
#
#   powershell -ExecutionPolicy Bypass -File tool\sign\sign-exe.ps1
#
# VI SAO CAN KY SO
# ---------------
# Mot file .exe KHONG co chu ky se bi:
#   - SmartScreen: "Windows protected your PC" / "Unknown publisher"
#   - Defender / antivirus: hay bao nham la "Trojan"/"HackTool" vi file
#     khong ro nguon goc + co hanh vi doc/ghi vao process khac (game)
#   - Chrome/Edge: chan tai file "khong an toan"
#
# Ky so KHONG lam file "sach" theo nghia antivirus, nhung:
#   1. Windows hien TEN NHA PHAT HANH thay vi "Unknown publisher"
#   2. SmartScreen dung duoc danh tieng (reputation) theo chung chi
#   3. Sau vai tram luot tai, canh bao tu het
#   4. Co the nop Microsoft de go false-positive (xem cuoi file)
#
# BA LOAI CHUNG CHI
# -----------------
#   (1) EV Code Signing  ~$300-600/nam  -> tin cay NGAY, khong can "dang tieng"
#       Nhung: can USB token phan cung, khong export .pfx duoc.
#   (2) OV Code Signing  ~$150-350/nam  -> van can "dang tieng" (vai tram luot tai)
#   (3) Azure Trusted Signing ~$10/thang -> Microsoft ky ho, re nhat, nhung
#       can lich su kinh doanh 3 nam (hoac danh gia ca nhan)
#
#   Self-signed CHI dung de test noi bo, KHONG giup khach (may khach khong
#   tin CA cua ban).
#
# CACH DUNG VOI CHUNG CHI THAT
# ----------------------------
#   # Neu co file .pfx:
#   $env:XA_PFX = 'C:\path\cert.pfx'
#   $env:XA_PFX_PASS = 'matkhau'
#   powershell -File tool\sign\sign-exe.ps1
#
#   # Neu chung chi da cai trong kho (USB token / EV):
#   $env:XA_CERT_SHA1 = 'THUMBPRINT'
#   powershell -File tool\sign\sign-exe.ps1
#
# TIMESTAMP: bat buoc. Khong co timestamp thi chu ky het han khi cert het han
# -> moi file da phat hanh thanh "chu ky khong hop le".

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$signDir = $PSScriptRoot

# ---- Tim signtool ----
$signtool = $null
$kits = @(
    'C:\Program Files (x86)\Windows Kits\10\bin',
    'C:\Program Files\Windows Kits\10\bin'
)
foreach ($k in $kits) {
    if (Test-Path $k) {
        $f = Get-ChildItem $k -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
        if ($f) { $signtool = $f.FullName; break }
    }
}
if (-not $signtool) {
    Write-Host '  [X] Khong tim thay signtool.exe. Cai Windows SDK:' -ForegroundColor Red
    Write-Host '      https://developer.microsoft.com/windows/downloads/windows-sdk/'
    exit 1
}
Write-Host "  [OK] signtool: $signtool" -ForegroundColor Green

# ---- File can ky ----
#
# P0: ban cu chi ky 3 file DA KHONG CON TON TAI (dist-setup/xa_setup.exe,
# dist-grant/xa_grant.exe, dist-nuitka/xa_nofog_pro.exe) va KHONG he ky file
# dang duoc phat hanh la `tool\dist-arena\xa_arena.exe`. Ket qua: script nay
# chay xong bao "XONG" trong khi EXE khach tai ve van NotSigned.
$targets = @(
    (Join-Path $root 'tool\dist-arena\xa_arena.exe')
) | Where-Object { Test-Path $_ }

if ($targets.Count -eq 0) {
    Write-Host '  [X] Khong co file .exe nao de ky. Build truoc:' -ForegroundColor Red
    Write-Host '      powershell -ExecutionPolicy Bypass -File tool\build-arena.ps1 -SkipSign'
    exit 1
}

Write-Host ''
Write-Host '=== File se ky ===' -ForegroundColor Cyan
$targets | ForEach-Object {
    $i = Get-Item $_
    Write-Host ("  {0,-24} {1,10} B" -f $i.Name, $i.Length)
}

# ---- Chon cach ky ----
$mode = $null
if ($env:XA_PFX -and (Test-Path $env:XA_PFX)) {
    $mode = 'pfx'
} elseif ($env:XA_CERT_SHA1) {
    $mode = 'store'
}

if (-not $mode) {
    Write-Host ''
    Write-Host '=== CHUA CO CHUNG CHI KY SO ===' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Hien tai cac file .exe CHUA DUOC KY -> Windows se hien'
    Write-Host '  "Unknown publisher" va Defender hay bao nham.'
    Write-Host ''
    Write-Host '  De ky that, can mua chung chi code signing (xem dau file nay):'
    Write-Host '    - EV Code Signing : tin cay ngay, ~$300-600/nam'
    Write-Host '    - OV Code Signing : ~$150-350/nam, can vai tram luot tai'
    Write-Host '    - Azure Trusted Signing : ~$10/thang (can 3 nam kinh doanh)'
    Write-Host ''
    Write-Host '  Sau khi co chung chi, dat bien moi truong roi chay lai:'
    Write-Host '    $env:XA_PFX = "C:\path\cert.pfx"; $env:XA_PFX_PASS = "pass"'
    Write-Host '    powershell -File tool\sign\sign-exe.ps1'
    Write-Host ''
    Write-Host '  ---- Ky TAM bang chung chi self-signed de test noi bo ----' -ForegroundColor DarkGray

    $answer = Read-Host '  Ky tam bang self-signed? (y/N)'
    if ($answer -notmatch '^[yY]') {
        Write-Host '  Bo qua ky so.' -ForegroundColor Yellow
        exit 0
    }

    # Tao self-signed cert (chi de test)
    $name = 'CN=XArena Test Signing'
    $cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq $name -and $_.HasPrivateKey } |
            Select-Object -First 1
    if (-not $cert) {
        Write-Host '  [*] Tao self-signed cert...' -ForegroundColor Yellow
        $cert = New-SelfSignedCertificate -Type CodeSigningCert `
            -Subject $name -KeyUsage DigitalSignature `
            -CertStoreLocation 'Cert:\CurrentUser\My' `
            -NotAfter (Get-Date).AddYears(3)
    }
    $env:XA_CERT_SHA1 = $cert.Thumbprint
    $mode = 'store'
    Write-Host "  [OK] Dung cert tam: $($cert.Thumbprint)" -ForegroundColor Green
    Write-Host '  [!] CHI dung de test. May khach se VAN canh bao.' -ForegroundColor Yellow
}

# ---- Ky ----
$ts = 'http://timestamp.digicert.com'

Write-Host ''
Write-Host '=== Dang ky ===' -ForegroundColor Cyan

$failed = 0
foreach ($f in $targets) {
    Write-Host ''
    Write-Host "  -> $(Split-Path -Leaf $f)" -ForegroundColor Cyan

    if ($mode -eq 'pfx') {
        $pwd = $env:XA_PFX_PASS
        & $signtool sign /fd SHA256 /f $env:XA_PFX `
            $(if ($pwd) { '/p'; $pwd }) `
            /tr $ts /td SHA256 /d 'MuaBanKey' $f
    } else {
        & $signtool sign /fd SHA256 /sha1 $env:XA_CERT_SHA1 `
            /tr $ts /td SHA256 /d 'MuaBanKey' $f
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "     [X] Ky that bai (exit $LASTEXITCODE)" -ForegroundColor Red
        $failed++
        continue
    }

    # Kiem lai
    & $signtool verify /pa $f | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $sha = (Get-FileHash $f -Algorithm SHA256).Hash
        $size = (Get-Item $f).Length
        Write-Host "     [OK] Da ky" -ForegroundColor Green
        Write-Host "     size = $size"
        Write-Host "     sha  = $sha"
    } else {
        Write-Host '     [!] Da ky nhung verify that bai' -ForegroundColor Yellow
        $failed++
    }
}

Write-Host ''
if ($failed -gt 0) {
    Write-Host "=== $failed file loi ===" -ForegroundColor Red
    exit 1
}

Write-Host '=== XONG ===' -ForegroundColor Green
Write-Host ''
Write-Host '  QUAN TRONG: hash phai duoc tinh SAU khi ky (ky lam doi bytes file).'
Write-Host '  Cach dung: build-arena.ps1 da tu ky VA tu cap nhat hash — hay dung script do'
Write-Host '  thay vi chay rieng file nay. Neu van chay rieng, cap nhat hash theo:'
Write-Host ''
Write-Host '    src/routes/arena-installer.js -> EXE_SHA256, EXE_SIZE'
Write-Host ''
Write-Host '  Upload R2:'
Write-Host '    npx wrangler r2 object put "muabankey-assets/files/xa_arena.exe" --file=tool\dist-arena\xa_arena.exe --content-type=application/octet-stream --remote'
