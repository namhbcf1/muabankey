/**
 * Bộ cài XAGrant — biến license key thành MỘT lệnh CMD chạy một phát.
 *
 *   GET /xg/<KEY>.cmd?t=<TOKEN>   -> file .cmd cài đặt
 *   GET /xg/<KEY>.ps1?t=<TOKEN>   -> biến thể PowerShell
 *   GET /xg/<KEY>?t=<TOKEN>       -> JSON chứa lệnh copy-paste
 *   GET /download/xa_grant.exe    -> tải EXE từ R2
 *
 * HOÀN TOÀN TÁCH khỏi No Fog: thư mục cài, tên EXE, tên shortcut, tên file
 * gỡ cài đặt đều khác. Hai tool cài song song không giẫm lên nhau.
 *
 * BẢO VỆ: /xg/* yêu cầu HOẶC session đăng nhập sở hữu key, HOẶC token cài
 * đặt còn hạn. Không có đường nào tải EXE mà không có license.
 */
import { ApiError } from '../lib/http.js';
import { readLicense, normKey } from './license.js';

/** Thư mục cài RIÊNG của XAGrant (khác No Fog). */
const INSTALL_DIR = 'C:\\Program Files\\XArena\\_re\\xagrant';
export const EXE_NAME = 'xa_grant.exe';
/** Cập nhật sau mỗi lần build bằng tool/grant/build-grant.ps1. */
export const EXE_SHA256 = 'B954767E8F9AEF943C4C36AA93470F9A8BE7CD7399342B125B905F2FC10510C7';
export const EXE_SIZE = 9622016;

const PID = 'xagrant';

function siteBase(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chỉ chấp nhận key CỦA XAGrant. Key No Fog bị từ chối rõ ràng. */
async function requireXgLicense(env, key) {
  const k = normKey(key);
  if (!/^[A-Z0-9-]{6,64}$/.test(k)) {
    throw new ApiError(404, 'Mã license không hợp lệ', 'NOT_FOUND');
  }
  const lic = await readLicense(env, k);
  if (!lic) throw new ApiError(404, 'Mã license không hợp lệ', 'NOT_FOUND');

  const isXg = lic.pid
    ? lic.pid === PID
    : String(lic.plan || '').toLowerCase() === PID;
  if (!isXg) {
    throw new ApiError(403,
      'Mã này là của sản phẩm khác (không phải XArena Grant)', 'WRONG_PRODUCT');
  }
  if (lic.revoked) throw new ApiError(403, 'Mã license đã bị thu hồi', 'REVOKED');
  if (!/^[A-Z0-9-]+$/.test(lic.key)) {
    throw new ApiError(500, 'Mã license chứa ký tự không hợp lệ', 'INVALID_KEY_CHARS');
  }
  return lic;
}

/** Kiểm tra quyền tải installer. */
async function assertCanInstall(env, request, key) {
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);

  if (user) {
    if (user.role === 'admin' || user.role === 'staff') return { via: 'staff' };
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, key).first();
    if (owns) return { via: 'owner' };
    throw new ApiError(403, 'Bạn không sở hữu mã license này', 'FORBIDDEN');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || request.headers.get('x-install-token') || '';
  if (!token) {
    throw new ApiError(401, 'Cần đăng nhập hoặc dùng đường dẫn có token', 'UNAUTHORIZED');
  }
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM install_tokens
     WHERE key = ? AND token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(key, await sha256hex(token), Math.floor(Date.now() / 1000)).first();
  if (!row) {
    throw new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn', 'UNAUTHORIZED');
  }
  return { via: 'token' };
}

/** Phát hành token cài đặt (gọi từ trang License của tôi). */
export async function issueXgInstallToken(env, request, rawKey) {
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { randomHex } = await import('../lib/crypto.js');
  const user = await requireUser(env, request);

  const k = normKey(rawKey);
  if (user.role !== 'admin' && user.role !== 'staff') {
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, k).first();
    if (!owns) throw new ApiError(403, 'Bạn không sở hữu mã này', 'FORBIDDEN');
  }
  const lic = await requireXgLicense(env, k);

  const token = randomHex(24);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO install_tokens (token_hash, key, user_id, created_at, expires_at)
     VALUES (?,?,?,?,?)`
  ).bind(await sha256hex(token), k, user.id, now, now + 86400).run();

  const base = siteBase(request);
  const ps1Url = `${base}/xg/${k}.ps1?t=${token}`;
  return ok({
    key: k,
    token,
    expiresIn: 86400,
    oneLiner: `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm ${ps1Url})"`,
    cmd: `curl -L -o "%TEMP%\\xg.cmd" "${base}/xg/${k}.cmd?t=${token}" && "%TEMP%\\xg.cmd"`,
    downloadCmd: `${base}/xg/${k}.cmd?t=${token}`,
    downloadPs1: ps1Url,
    exeUrl: `${base}/download/${EXE_NAME}`,
    expiresAt: lic.expires_at,
  });
}

/* ============================ Mẫu CMD ============================ */

function buildCmd({ key, base, exeSha, exeSize, installDir, token }) {
  const q = token ? `?t=${token}` : '';
  return `@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title XArena Grant - Cai dat tu dong
color 0A

set "KEY=${key}"
set "BASE=${base}"
set "Q=${q}"
set "EXEURL=%BASE%/download/${EXE_NAME}"
set "EXESHA=${exeSha}"
set "EXESIZE=${exeSize}"
set "TARGET=${installDir}"
set "EXE=%TARGET%\\${EXE_NAME}"

cls
echo.
echo  ============================================================
echo    XArena Grant - Bo cai dat tu dong
echo    Ma license: %KEY%
echo  ============================================================
echo.

rem ---- 1. Bat buoc quyen Administrator ----
rem fltmc chinh xac hon "net session" (tra 0 ca khi Server service da tat)
fltmc >nul 2>&1
if not "%errorlevel%"=="0" (
  echo  [*] Can quyen Administrator. Dang yeu cau...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [X] KHONG THE LAY QUYEN ADMINISTRATOR.
    echo      Bam "Yes" khi Windows hoi. Neu khong thay hop thoai:
    echo        - Chuot phai file .cmd nay -^> "Run as administrator"
    echo.
    pause
    exit /b 5
  )
  exit /b 0
)
echo  [OK] Da co quyen Administrator.
echo.

rem ---- 2. Tao thu muc dich ----
echo  [*] Tao thu muc cai dat...
if not exist "%TARGET%" mkdir "%TARGET%" 2>nul
if not exist "%TARGET%" (
  echo  [X] Khong tao duoc: %TARGET%
  pause
  exit /b 6
)
echo  [OK] %TARGET%
echo.

rem ---- 3. Tai bo xu ly ----
echo  [*] Dang tai bo xu ly...
set "GOT="
set "FROMCACHE="
del /f /q "%EXE%.new" >nul 2>&1

rem ===== CACHE: KICH THUOC KHONG DU CHUNG MINH NOI DUNG =====
rem Truoc day nhanh nay chi so sanh %%~zA voi %EXESIZE% roi dung luon file
rem dang co. Chi can dat mot file CUNG KICH THUOC vao dung duong dan cai dat
rem la no duoc chay bang quyen Administrator -> chay ma doc tuy y.
rem Nay LUON bam SHA-256 cua file cache roi verify, giong installer No Fog.
if exist "%EXE%" (
  for /f "usebackq delims=" %%H in (\`powershell -NoProfile -Command "if((Get-Item -LiteralPath '%EXE%' -EA SilentlyContinue).Length -eq %EXESIZE%){'OK'}"\`) do set "GOT=%%H"
)
if not defined GOT goto :cache_done

echo       Kiem tra toan ven file da co san...
call :hashfile "%EXE%"
call :verifyhash
if errorlevel 1 goto :cache_bad
set "FROMCACHE=1"
echo       Da co san, bo qua tai.
goto :cache_done

:cache_bad
rem File cu sai chu ky -> xoa han roi tai lai tu dau.
rem Khong dung "[!]" o day: script bat EnableDelayedExpansion nen dau "!" bi an.
echo       File co san sai chu ky. Da xoa, tai lai tu dau...
del /f /q "%EXE%" >nul 2>&1
rem Khong xoa duoc (file dang bi giu) -> dung han. Neu chay tiep, move ben duoi
rem se that bai trong im lang va file SAI van con nguyen o duong dan cai dat.
if exist "%EXE%" goto :fail_abort
set "GOT="
set "FROMCACHE="

:cache_done
if not defined GOT (
  echo       Thu cach 1: curl...
  curl.exe -L --fail --retry 3 --retry-delay 2 -o "%EXE%.new" "%EXEURL%" 2>nul
  call :checksize
)

if not defined GOT (
  echo       Thu cach 2: PowerShell...
  del /f /q "%EXE%.new" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;[Net.WebClient]::new().DownloadFile('%EXEURL%','%EXE%.new')}catch{}" 2>nul
  call :checksize
)

if not defined GOT (
  echo       Thu cach 3: certutil...
  del /f /q "%EXE%.new" >nul 2>&1
  certutil -urlcache -split -f "%EXEURL%" "%EXE%.new" >nul 2>&1
  call :checksize
)

if not defined GOT (
  echo.
  echo  [X] Khong tai duoc bo xu ly ^(hoac file tai ve bi thieu^).
  echo      Kiem tra ket noi mang roi chay lai file nay.
  del /f /q "%EXE%.new" >nul 2>&1
  pause
  exit /b 7
)

rem Kiem tra toan ven - BAT BUOC, sai la dung han.
rem verifyhash CHI tra errorlevel; no khong the tu dung script chinh.
if defined FROMCACHE goto :verify_done
echo  [*] Kiem tra toan ven file...
call :hashfile "%EXE%.new"
call :verifyhash
if errorlevel 1 goto :fail_abort
:verify_done

move /y "%EXE%.new" "%EXE%" >nul 2>&1
if not exist "%EXE%" (
  echo  [X] Khong ghi duoc file vao %TARGET%
  pause
  exit /b 8
)
echo  [OK] Da cai: %EXE%
echo.

rem ---- 4. EP RUN AS ADMIN cho EXE ----
echo  [*] Cau hinh EXE luon chay voi quyen Administrator...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try{" ^
  "  $k='HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';" ^
  "  if(-not(Test-Path $k)){New-Item -Path $k -Force | Out-Null};" ^
  "  Set-ItemProperty -Path $k -Name '%EXE%' -Value '~ RUNASADMIN' -Force;" ^
  "  Write-Host '  [OK] Da bat RUNASADMIN (HKCU).'" ^
  "}catch{ Write-Host '  [!] Khong dat duoc HKCU.' }" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try{" ^
  "  $k='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';" ^
  "  if(-not(Test-Path $k)){New-Item -Path $k -Force | Out-Null};" ^
  "  Set-ItemProperty -Path $k -Name '%EXE%' -Value '~ RUNASADMIN' -Force;" ^
  "  Write-Host '  [OK] Da bat RUNASADMIN (HKLM).'" ^
  "}catch{ Write-Host '  [!] Khong dat duoc HKLM.' }" 2>nul

rem ---- 5. Kich hoat license ----
echo.
echo  [*] Kich hoat license...
"%EXE%" --key "%KEY%"
set "ACT=%errorlevel%"
echo.
if not "%ACT%"=="0" (
  echo  ============================================================
  echo    [X] KICH HOAT THAT BAI  ^(ma loi %ACT%^)
  echo  ============================================================
  echo.
  if "%ACT%"=="3" (
    echo      Ma license khong hop le, da het han, hoac da dung
    echo      tren may khac.
  )
  if "%ACT%"=="5" (
    echo      Thieu quyen Administrator.
  )
  echo.
  echo      Cach xu ly:
  echo        1. Dang nhap website, vao muc "License cua toi"
  echo        2. Kiem tra trang thai key con han khong
  echo        3. Neu doi may: bam "Doi may" de cap lai luot
  echo        4. Chay lai file cai dat nay
  echo.
  pause
  exit /b 10
)
echo  [OK] Kich hoat thanh cong.

rem ---- 6. Tao file chay bang CMD + shortcut Desktop ----
rem Tool nay CHI chay bang CMD. Shortcut mo thang cmd.exe /k de khach
rem thay dung nhung gi tool in ra va go duoc lenh tiep theo.
echo  [*] Tao launcher CMD va shortcut...
> "%TARGET%\\xa.cmd" echo @echo off
>> "%TARGET%\\xa.cmd" echo chcp 65001 ^>nul 2^>^&1
>> "%TARGET%\\xa.cmd" echo title XArena Grant
>> "%TARGET%\\xa.cmd" echo "%%~dp0${EXE_NAME}" %%*

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "$paths=@([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'));" ^
  "foreach($p in $paths){" ^
  "  $lnk=Join-Path $p 'XArena Grant.lnk';" ^
  "  $s=$w.CreateShortcut($lnk);" ^
  "  $s.TargetPath='%COMSPEC%';" ^
  "  $s.Arguments='/k \\"%TARGET%\\xa.cmd\\"';" ^
  "  $s.WorkingDirectory='%TARGET%';" ^
  "  $s.Description='XArena Grant - Ban quyen %KEY%';" ^
  "  $s.IconLocation='%EXE%,0';" ^
  "  $s.Save();" ^
  "}" 2>nul

powershell -NoProfile -Command "if(Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'XArena Grant.lnk')){exit 0}else{exit 1}"
if not errorlevel 1 (
  echo  [OK] Da tao shortcut ngoai Desktop.
) else (
  echo  [!] Khong tao duoc shortcut. Mo CMD va chay: %TARGET%\\xa.cmd
)
echo.

rem ---- 7. Script go cai dat ----
> "%TARGET%\\go-cai-dat.cmd" echo @echo off
>> "%TARGET%\\go-cai-dat.cmd" echo chcp 65001 ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo fltmc ^>nul 2^>^&1 ^|^| (powershell -NoProfile -Command "Start-Process -FilePath '%%~f0' -Verb RunAs" ^& exit /b)
>> "%TARGET%\\go-cai-dat.cmd" echo echo Dang go cai dat XArena Grant...
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%USERPROFILE%%\\Desktop\\XArena Grant.lnk" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%APPDATA%%\\Microsoft\\Windows\\Start Menu\\Programs\\XArena Grant.lnk" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%LOCALAPPDATA%%\\XArenaGrant\\lic.bin" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo reg delete "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers" /v "%EXE%" /f ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers" /v "%EXE%" /f ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%EXE%" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo echo Xong. Da go cai dat.
>> "%TARGET%\\go-cai-dat.cmd" echo pause

echo  ============================================================
echo    HOAN TAT
echo  ============================================================
echo.
echo   - Shortcut "XArena Grant" da co ngoai Desktop
echo   - Mo shortcut hoac: %TARGET%\\xa.cmd
echo   - Cai dat tai: %TARGET%
echo   - Go cai dat:  %TARGET%\\go-cai-dat.cmd
echo.
echo   Cach dung trong CMD:
echo     xa.cmd who              xem ban la ai
echo     xa.cmd check            xem tai nguyen
echo     xa.cmd t 500            +500 thit
echo     xa.cmd v 1000           +1000 vang
echo     xa.cmd full 5000        +5000 ca 4 loai
echo     xa.cmd quit             thoat
echo.
echo   Luu y: key chi dung duoc tren 1 may tinh.
echo          Doi may thi bam "Doi may" tren website.
echo.
pause
exit /b 0

rem ============================================================
rem  SUBROUTINE
rem ============================================================

:checksize
if not exist "%EXE%.new" exit /b 0
set "SZ="
for %%A in ("%EXE%.new") do set "SZ=%%~zA"
if "%SZ%"=="%EXESIZE%" set "GOT=1"
exit /b 0

:sethash
if defined ACTUALSHA exit /b 0
set "ACTUALSHA=%~1"
exit /b 0

:hashfile
rem Tinh SHA-256 cua file trong %~1 vao ACTUALSHA (rong neu doc loi).
rem Tach rieng de ca nhanh cache va nhanh tai deu dung chung.
set "ACTUALSHA="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile "%~1" SHA256 2^>nul') do call :sethash "%%H"
if defined ACTUALSHA set "ACTUALSHA=!ACTUALSHA: =!"
exit /b 0

:verifyhash
rem CHI bao ket qua qua errorlevel: 0 = khop, 1 = sai/khong doc duoc.
rem KHONG duoc "exit /b 9" o day: "call" chi thoat khoi subroutine, script
rem chinh van chay tiep. Noi goi PHAI kiem errorlevel roi goto :fail_abort.
if not defined ACTUALSHA (
  rem Khong dung "[!]" trong echo: EnableDelayedExpansion se an dau "!".
  echo  [X] Khong doc duoc chu ky file.
  exit /b 1
)
if /i "%ACTUALSHA%"=="%EXESHA%" (
  echo  [OK] Chu ky file khop.
  exit /b 0
)
echo.
echo  [X] FILE TAI VE KHONG DUNG CHU KY.
echo      Co the do mang chap chon hoac bi can thiep.
del /f /q "%EXE%.new" >nul 2>&1
exit /b 1

:fail_abort
echo.
echo  Da huy cai dat: khong xac minh duoc bo xu ly.
echo  Vui long chay lai file nay khi mang on dinh.
del /f /q "%EXE%.new" >nul 2>&1
pause
exit /b 9
`;
}

/* ============================ Mẫu PowerShell ============================ */

function buildPs1({ key, base, installDir, selfUrl }) {
  return `# XArena Grant - Bo cai dat tu dong (PowerShell)
# Ma license: ${key}
#
# Cach dung 1 lenh:
#   irm ${selfUrl} | iex

$ErrorActionPreference = 'Stop'
$Key      = '${key}'
$Base     = '${base}'
$Target   = '${installDir}'
$ExeName  = '${EXE_NAME}'
$Exe      = Join-Path $Target $ExeName
$Url      = "$Base/download/$ExeName"
$WantSha  = '${EXE_SHA256}'
$WantSize = ${EXE_SIZE}

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }
function Halt([int]$code, [string]$msg) {
  if ($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
  try {
    if (-not [Console]::IsInputRedirected) {
      Write-Host ''
      Read-Host 'Nhan Enter de thoat' | Out-Null
    }
  } catch { }
  exit $code
}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host '    XArena Grant - Bo cai dat tu dong' -ForegroundColor White
Write-Host "    Ma license: $Key" -ForegroundColor DarkGray
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host ''

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Step 'Can quyen Administrator. Dang yeu cau...'
  $selfTmp = Join-Path $env:TEMP ('xg-install-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.ps1')
  $ok = $false
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile('${selfUrl}', $selfTmp)
    $ok = (Test-Path -LiteralPath $selfTmp)
  } catch { }
  if (-not $ok) {
    Halt 6 'Khong chuan bi duoc bo cai dat. Kiem tra mang roi chay lai.'
  }
  try {
    Start-Process powershell -Verb RunAs -ArgumentList @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File', $selfTmp
    ) | Out-Null
  } catch {
    Halt 5 'Khong lay duoc quyen admin. Chuot phai file .ps1 -> Run as administrator.'
  }
  exit
}
Good 'Da co quyen Administrator.'

Step "Tao thu muc $Target"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Good 'Da tao thu muc.'

$needDownload = $true
if (Test-Path -LiteralPath $Exe) {
  if ((Get-Item -LiteralPath $Exe).Length -eq $WantSize) {
    Good 'Bo xu ly da co san, bo qua tai.'
    $needDownload = $false
  }
}

if ($needDownload) {
  Step 'Dang tai bo xu ly...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = "$Exe.download"
  Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  $ok = $false
  foreach ($try in 1..3) {
    try {
      $wc = New-Object Net.WebClient
      $wc.Headers.Add('User-Agent', 'XArenaGrantInstaller/1.0')
      $wc.DownloadFile($Url, $tmp)
      if ((Get-Item -LiteralPath $tmp).Length -eq $WantSize) { $ok = $true; break }
    } catch {
      Warn "Lan $try that bai: $($_.Exception.Message)"
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ok) {
    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    Halt 7 'Khong tai duoc bo xu ly. Kiem tra mang roi chay lai.'
  }

  $sha = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash
  if ($sha -ine $WantSha) {
    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    Halt 9 'FILE TAI VE KHONG DUNG CHU KY. Da huy cai dat.'
  }
  Good 'Chu ky file khop.'

  Move-Item -Force -LiteralPath $tmp -Destination $Exe
  Good "Da cai: $Exe"
}

Step 'Ep EXE chay voi quyen Administrator...'
foreach ($hive in @('HKCU:','HKLM:')) {
  try {
    $path = "$hive\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers"
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    Set-ItemProperty -Path $path -Name $Exe -Value '~ RUNASADMIN' -Force
    Good "Da bat RUNASADMIN ($hive)"
  } catch { Warn "Khong dat duoc $hive" }
}

Step 'Kich hoat license...'
& $Exe --key $Key
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Warn "KICH HOAT THAT BAI (ma $LASTEXITCODE)."
  Warn 'Kiem tra trang thai key tai muc "License cua toi" tren website.'
  Halt 10 "KICH HOAT THAT BAI (ma $LASTEXITCODE)."
}
Good 'Kich hoat thanh cong.'
Write-Host ''

Step 'Tao launcher CMD va shortcut...'
$launcher = Join-Path $Target 'xa.cmd'
$lb = @"
@echo off
chcp 65001 >nul 2>&1
title XArena Grant
"%~dp0$ExeName" %*
"@
$lb | Set-Content -LiteralPath $launcher -Encoding ASCII

$wsh = New-Object -ComObject WScript.Shell
foreach ($p in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))) {
  try {
    $lnk = Join-Path $p 'XArena Grant.lnk'
    $s = $wsh.CreateShortcut($lnk)
    $s.TargetPath = $env:COMSPEC
    $s.Arguments = "/k \`"$launcher\`""
    $s.WorkingDirectory = $Target
    $s.Description = "XArena Grant - Ban quyen $Key"
    $s.IconLocation = "$Exe,0"
    $s.Save()
  } catch { Warn "Khong tao duoc shortcut tai $p" }
}
Good 'Da tao shortcut ngoai Desktop va Start Menu.'

$uninst = Join-Path $Target 'go-cai-dat.ps1'
$ub = @'
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Dang go cai dat XArena Grant...'
$desk  = [Environment]::GetFolderPath('Desktop')
$progs = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
Remove-Item -Force -LiteralPath (Join-Path $desk  'XArena Grant.lnk')
Remove-Item -Force -LiteralPath (Join-Path $progs 'XArena Grant.lnk')
$licDir = Join-Path $env:LOCALAPPDATA 'XArenaGrant'
Remove-Item -Force -LiteralPath $licDir -Recurse
foreach ($hive in @('HKCU:','HKLM:')) {
  $p = "$hive/Software/Microsoft/Windows NT/CurrentVersion/AppCompatFlags/Layers"
  Remove-ItemProperty -Path $p -Name $Exe -Force
}
Write-Host 'Xong.'
try { if (-not [Console]::IsInputRedirected) { Read-Host 'Nhan Enter' | Out-Null } } catch { }
'@
$ub | Set-Content -LiteralPath $uninst -Encoding UTF8

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host '    HOAN TAT' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Green
Write-Host ''
Write-Host "   - Shortcut da co ngoai Desktop"
Write-Host "   - Go cai dat: $uninst"
Write-Host ''
Warn 'Key chi dung duoc tren 1 may tinh.'
Write-Host ''
try { if (-not [Console]::IsInputRedirected) { Read-Host 'Nhan Enter de dong' | Out-Null } } catch { }
`;
}

/* ============================ Handlers ============================ */

export async function serveXgCmd(env, request, rawKey) {
  const lic = await requireXgLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const body = buildCmd({
    key: lic.key, base: siteBase(request),
    exeSha: EXE_SHA256, exeSize: EXE_SIZE, installDir: INSTALL_DIR, token,
  });
  // cmd.exe yêu cầu CRLF; file LF thuần gây lỗi ". was unexpected at this time."
  const crlf = body.replace(/\r?\n/g, '\r\n');
  return new Response(crlf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream; charset=utf-8',
      'Content-Disposition': `attachment; filename="cai-dat-XArena-Grant-${lic.key}.cmd"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function serveXgPs1(env, request, rawKey) {
  const lic = await requireXgLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const base = siteBase(request);
  const selfUrl = `${base}/xg/${lic.key}.ps1?t=${token}`;
  const body = buildPs1({
    key: lic.key, base, installDir: INSTALL_DIR, selfUrl,
  });
  // KHONG co BOM: '\uFEFF' lam hong tokenizer khi chay qua "irm | iex".
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="cai-dat-XArena-Grant-${lic.key}.ps1"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function xgInstallerCommand(env, request, rawKey) {
  const lic = await requireXgLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const base = siteBase(request);
  const q = token ? `?t=${token}` : '';
  return new Response(JSON.stringify({
    ok: true,
    key: lic.key,
    cmd: `curl -L -o "%TEMP%\\xg.cmd" "${base}/xg/${lic.key}.cmd${q}" && "%TEMP%\\xg.cmd"`,
    powershell: `iwr -OutFile "$env:TEMP\\xg.ps1" "${base}/xg/${lic.key}.ps1${q}"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\xg.ps1"`,
    downloadCmd: `${base}/xg/${lic.key}.cmd${q}`,
    downloadPs1: `${base}/xg/${lic.key}.ps1${q}`,
    exeUrl: `${base}/download/${EXE_NAME}`,
    exeSha256: EXE_SHA256,
    installDir: INSTALL_DIR,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Stream EXE từ R2. Hỗ trợ Range để resume. */
export async function downloadXgExe(env, request) {
  if (!env.MEDIA) throw new ApiError(503, 'Chưa cấu hình R2', 'NOT_CONFIGURED');

  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(`files/${EXE_NAME}`, range ? { range: request.headers } : {});
  if (!obj) throw new ApiError(404, 'Không tìm thấy bộ cài', 'NOT_FOUND');

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${EXE_NAME}"`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-cache');
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  // CHỈ trả 206 khi client THỰC SỰ xin Range. Miniflare (chạy local) luôn
  // điền obj.range kể cả khi không xin, nên phải kiểm tra `range` trước:
  // nếu không, mọi GET thường sẽ trả 206 kèm Content-Range sai ngữ nghĩa.
  if (range && obj.range) {
    const offset = obj.range.offset || 0;
    const length = obj.range.length !== undefined ? obj.range.length : obj.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

/** Xuất hằng số cho build script đọc (tránh sửa tay 2 nơi). */
export const XG_BUILD_INFO = { EXE_NAME, INSTALL_DIR, EXE_SHA256, EXE_SIZE, PID };
