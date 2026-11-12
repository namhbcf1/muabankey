/**
 * Bộ cài đặt tự động: biến license key thành một lệnh CMD chạy một phát.
 *
 *   GET /i/<KEY>?t=<TOKEN>.cmd   -> file .cmd cá nhân hoá
 *   GET /i/<KEY>?t=<TOKEN>.ps1   -> biến thể PowerShell
 *   GET /i/<KEY>?t=<TOKEN>       -> JSON chứa lệnh copy-paste
 *   GET /download/xa_nofog_pro.exe  -> tải EXE từ R2
 *
 * BẢO VỆ: /i/* yêu cầu HOẶC session đăng nhập sở hữu key, HOẶC token ký HMAC.
 * Trước đây ai biết key đều tải được + phân biệt được key tồn tại -> oracle.
 */
import { ApiError } from '../lib/http.js';
import { readLicense, normKey } from './license.js';

const INSTALL_DIR = 'C:\\Program Files\\XArena\\_re\\chayduoc';

/*
 * NGUON DUY NHAT cho thong tin bo cai.
 *
 * Trang /tai-ve lay lai cac gia tri nay qua GET /api/app/version
 * (src/routes/app-info.js) thay vi chep tay. Truoc day hash/size chi nam o
 * day va khong noi nao doc ra duoc: moi lan phat hanh ban moi phai sua nhieu
 * cho va rat de lech -> khach tai dung file nhung so sanh hash sai.
 */
export const EXE_NAME = 'xa_nofog_pro.exe';
export const EXE_SHA256 = '053A6C494AE3EEE22BCD9044D495CC026C880EC22AC5E4B8FC3BF7B166DEEB75';
export const EXE_SIZE = 9101312;
/** Phien ban phat hanh dang phuc vu. Doi o day la trang /tai-ve tu cap nhat. */
export const EXE_VERSION = '1.4.1.0';
/** Ten hien thi cua san pham. */
export const APP_NAME = 'XArena No Fog';

function siteBase(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Token cài đặt do `randomHex(24)` sinh nên LUÔN là 24 byte hex (48 ký tự).
 *
 * Phải kiểm trước khi nội suy vào `.cmd`/`.ps1`: token đi thẳng vào
 * `set "Q=?t=${token}"`, nên một token chứa xuống dòng sẽ thoát khỏi chuỗi
 * `set` và trở thành lệnh CMD độc lập — chạy với quyền Administrator mà
 * installer tự nâng lên. Kiểm định dạng đóng luôn cả đường này.
 */
function assertTokenShape(token) {
  if (!token) {
    throw new ApiError(401, 'Cần đăng nhập hoặc dùng đường dẫn có token', 'UNAUTHORIZED');
  }
  if (!/^[0-9a-f]{48}$/.test(token)) {
    throw new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn', 'UNAUTHORIZED');
  }
}

/** Kiểm tra quyền tải installer: session sở hữu key, hoặc token hợp lệ. */
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

  // Không đăng nhập: cần token ký kèm (do trang License của tôi phát hành)
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || request.headers.get('x-install-token') || '';
  assertTokenShape(token);
  const tokenHash = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM install_tokens
     WHERE key = ? AND token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(key, tokenHash, Math.floor(Date.now() / 1000)).first();
  if (!row) {
    throw new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn', 'UNAUTHORIZED');
  }
  return { via: 'token' };
}

async function requireUsableLicense(env, key) {
  const k = normKey(key);
  if (!/^[A-Z0-9-]{6,64}$/.test(k)) {
    throw new ApiError(404, 'Mã license không hợp lệ', 'NOT_FOUND');
  }
  const lic = await readLicense(env, k);
  // Trả cùng một thông báo cho mọi trường hợp để không lộ key nào tồn tại
  if (!lic) throw new ApiError(404, 'Mã license không hợp lệ', 'NOT_FOUND');
  if (lic.revoked) throw new ApiError(403, 'Mã license đã bị thu hồi', 'REVOKED');

  // KHÔNG cho key của tool khác đi qua bộ cài No Fog.
  //
  // Trước đây hàm này chỉ kiểm revoked: khách mua key XAGR (tool tăng tài
  // nguyên) vẫn tải được bộ cài No Fog, cài No Fog, rồi tool No Fog gọi
  // /api/activate với key đó. Kết quả: khách nhận SAI sản phẩm, và bản No Fog
  // chiếm mất lượt bind HWID của key XAGR.
  if (isOtherProduct(lic)) {
    throw new ApiError(403,
      'Mã này là của sản phẩm khác (không phải XArena No Fog)', 'WRONG_PRODUCT');
  }

  // Lớp phòng thủ cuối: key nhúng vào .cmd/.ps1 chạy quyền ADMIN
  if (!/^[A-Z0-9-]+$/.test(lic.key)) {
    throw new ApiError(500, 'Mã license chứa ký tự không hợp lệ', 'INVALID_KEY_CHARS');
  }
  return lic;
}

/**
 * License này có thuộc một sản phẩm KHÁC No Fog không?
 *
 * Dữ liệu cũ không có cột `pid` -> coi là No Fog (tương thích ngược).
 * Tiền tố XAGR- cũng bị chặn kể cả khi cột pid chưa được migrate.
 */
function isOtherProduct(lic) {
  if (lic.pid) return lic.pid !== 'nofog';
  return String(lic.key || '').toUpperCase().startsWith('XAGR-');
}

/** Phát hành token cài đặt (gọi từ trang License của tôi). */
export async function issueInstallToken(env, request, key) {
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { randomHex } = await import('../lib/crypto.js');
  const user = await requireUser(env, request);

  const k = normKey(key);
  if (user.role !== 'admin' && user.role !== 'staff') {
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, k).first();
    if (!owns) throw new ApiError(403, 'Bạn không sở hữu mã này', 'FORBIDDEN');
  }
  const lic = await requireUsableLicense(env, k);

  const token = randomHex(24);
  const tokenHash = await sha256hex(token);
  const now = Math.floor(Date.now() / 1000);
  // Token sống 24h — đủ để khách copy và chạy
  await env.DB.prepare(
    `INSERT INTO install_tokens (token_hash, key, user_id, created_at, expires_at)
     VALUES (?,?,?,?,?)`
  ).bind(tokenHash, k, user.id, now, now + 86400).run();

  const base = siteBase(request);
  const ps1Url = `${base}/i/${k}.ps1?t=${token}`;
  return ok({
    key: k,
    token,
    expiresIn: 86400,
    // MỘT LỆNH, không ma sát: Win+R -> dán -> Enter -> Yes (UAC).
    // Dùng "iex (irm URL)" chứ KHÔNG phải "irm URL | iex":
    // pipe truyen TUNG DONG, dong trong thanh chuoi rong -> iex loi
    // "Cannot bind argument to parameter 'Command' because it is an empty string".
    oneLiner: `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm ${ps1Url})"`,
    // Dành cho ai quen CMD
    cmd: `curl -L -o "%TEMP%\\xa.cmd" "${base}/i/${k}.cmd?t=${token}" && "%TEMP%\\xa.cmd"`,
    downloadCmd: `${base}/i/${k}.cmd?t=${token}`,
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
title XArena No Fog - Cai dat tu dong
color 0B

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
echo    XArena No Fog - Bo cai dat tu dong
echo    Ma license: %KEY%
echo  ============================================================
echo.

rem ---- 1. Bat buoc quyen Administrator ----
rem fltmc chinh xac hon net session (net session tra 0 ca khi Server service da tat)
fltmc >nul 2>&1
if not "%errorlevel%"=="0" (
  echo  [*] Can quyen Administrator. Dang yeu cau...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [X] KHONG THE LAY QUYEN ADMINISTRATOR.
    echo.
    echo      Bam "Yes" khi Windows hoi. Neu khong thay hop thoai:
    echo        - Chuot phai file .cmd nay -^> "Run as administrator"
    echo        - Hoac tat UAC trong Windows Settings
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

rem ---- 3. Tai EXE ----
echo  [*] Dang tai bo xu ly ^(12 MB^)...
set "GOT="
set "FROMCACHE="

rem Xoa file tam con sot tu lan chay truoc - tranh cai dat file hong
del /f /q "%EXE%.new" >nul 2>&1

if not exist "%EXE%" goto :cache_done
for /f "usebackq delims=" %%H in (\`powershell -NoProfile -Command "if((Get-Item -LiteralPath '%EXE%' -EA SilentlyContinue).Length -eq %EXESIZE%){'OK'}"\`) do set "GOT=%%H"
if not defined GOT goto :cache_done

rem File da co san: KICH THUOC khop KHONG chung minh duoc noi dung. Truoc day
rem nhanh nay bo qua toan bo buoc kiem hash, nen chi can dat mot file 13.2 MB
rem bat ky vao dung duong dan cai dat la no duoc chay bang quyen Administrator.
rem LUON verify, ke ca khi lay tu cache.
echo  [*] Kiem tra toan ven file da co san...
call :hashfile "%EXE%"
call :verifyhash
if errorlevel 1 goto :cache_bad
set "FROMCACHE=1"
echo       Da co san, bo qua tai.
goto :cache_done

:cache_bad
rem File cu sai chu ky -> xoa han roi tai lai tu dau (ben duoi).
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
rem verifyhash CHI tra errorlevel; no khong the tu dung script chinh. Phai
rem kiem errorlevel o day va goto :fail_abort, neu khong dong move ben duoi
rem van ghi de EXE bang file sai roi chay no bang quyen Administrator.
if defined FROMCACHE goto :verify_done
echo  [*] Kiem tra toan ven file...
call :hashfile "%EXE%.new"
call :verifyhash
if errorlevel 1 goto :fail_abort
move /y "%EXE%.new" "%EXE%" >nul 2>&1
:verify_done
rem Chan cuoi: neu move that bai trong khi mot file CU van nam o %EXE% thi
rem "if not exist" ben duoi se khong bat duoc, va script chay file chua verify.
rem Vi vay kiem lai hash ngay tai duong dan cai dat truoc khi dung toi no.
set "QUIETOK=1"
call :hashfile "%EXE%"
call :verifyhash
set "QUIETOK="
if errorlevel 1 goto :fail_abort
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
rem Ma TR- = dung thu -> tool nhan bang --trial-key (khong hoi gi)
rem Ma khac = key mua -> --key
set "IS_TRIAL=0"
echo %KEY% | findstr /b /c:"TR-" >nul 2>&1 && set "IS_TRIAL=1"
if "%IS_TRIAL%"=="1" (
  echo  [*] Kich hoat dung thu %KEY%...
  "%EXE%" --trial-key "%KEY%"
) else (
  echo  [*] Kich hoat license...
  "%EXE%" --key "%KEY%"
)
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
    echo      Thieu quyen Administrator. Hay chay lai file nay
    echo      bang cach chuot phai -^> "Run as administrator".
  )
  echo.
  echo      Cach xu ly:
  echo        1. Dang nhap website, vao muc "License cua toi"
  echo        2. Kiem tra trang thai key con han khong
  echo        3. Neu doi may: bam "Doi may" de cap lai luot
  echo        4. Chay lai file cai dat nay
  echo.
  echo      Lien he ho tro neu van khong duoc.
  echo.
  pause
  exit /b 10
)
echo  [OK] Kich hoat thanh cong.

rem ---- 6. Tao shortcut ----
echo  [*] Tao shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "$paths=@([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'));" ^
  "foreach($p in $paths){" ^
  "  $lnk=Join-Path $p 'XArena No Fog.lnk';" ^
  "  $s=$w.CreateShortcut($lnk);" ^
  "  $s.TargetPath='%EXE%';" ^
  "  $s.WorkingDirectory='%TARGET%';" ^
  "  $s.Description='XArena No Fog - Ban quyen %KEY%';" ^
  "  $s.IconLocation='%EXE%,0';" ^
  "  $s.Save();" ^
  "}" 2>nul

set "LNOK="
powershell -NoProfile -Command "if(Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'XArena No Fog.lnk')){exit 0}else{exit 1}"
if not errorlevel 1 (
  echo  [OK] Da tao shortcut ngoai Desktop.
) else (
  echo  [!] Khong tao duoc shortcut. Mo truc tiep: %EXE%
)
echo.

rem ---- 7. Script go cai dat ----
> "%TARGET%\\go-cai-dat.cmd" echo @echo off
>> "%TARGET%\\go-cai-dat.cmd" echo chcp 65001 ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo fltmc ^>nul 2^>^&1 ^|^| (powershell -NoProfile -Command "Start-Process -FilePath '%%~f0' -Verb RunAs" ^& exit /b)
>> "%TARGET%\\go-cai-dat.cmd" echo echo Dang go cai dat XArena No Fog...
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%USERPROFILE%%\\Desktop\\XArena No Fog.lnk" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%APPDATA%%\\Microsoft\\Windows\\Start Menu\\Programs\\XArena No Fog.lnk" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%%LOCALAPPDATA%%\\XArenaNoFog\\lic.bin" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo reg delete "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers" /v "%EXE%" /f ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers" /v "%EXE%" /f ^>nul 2^>^&1
>> "%TARGET%\\go-cai-dat.cmd" echo del /f /q "%EXE%" 2^>nul
>> "%TARGET%\\go-cai-dat.cmd" echo echo Xong. Da go cai dat.
>> "%TARGET%\\go-cai-dat.cmd" echo pause

echo  ============================================================
echo    HOAN TAT
echo  ============================================================
echo.
echo   - Shortcut "XArena No Fog" da co ngoai Desktop
echo   - EXE da duoc ep chay voi quyen Administrator
echo   - Cai dat tai: %TARGET%
echo   - Go cai dat:  %TARGET%\\go-cai-dat.cmd
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
rem Dat GOT=1 neu file .new ton tai va dung kich thuoc
if not exist "%EXE%.new" exit /b 0
set "SZ="
for %%A in ("%EXE%.new") do set "SZ=%%~zA"
if "%SZ%"=="%EXESIZE%" set "GOT=1"
exit /b 0

:sethash
rem Luu hash dau tien doc duoc (bo qua dong header/footer cua certutil)
if defined ACTUALSHA exit /b 0
set "ACTUALSHA=%~1"
exit /b 0

:hashfile
rem Tinh SHA-256 cua file trong %~1 vao bien ACTUALSHA (rong neu doc loi).
rem Tach rieng khoi :verifyhash de ca nhanh cache va nhanh tai deu dung chung.
set "ACTUALSHA="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile "%~1" SHA256 2^>nul') do call :sethash "%%H"
if defined ACTUALSHA set "ACTUALSHA=!ACTUALSHA: =!"
exit /b 0

:verifyhash
rem CHI bao ket qua qua errorlevel: 0 = khop, 1 = sai/khong doc duoc.
rem KHONG duoc "exit /b 9" o day de roi tuong script da dung: "call" chi thoat
rem khoi subroutine, script chinh van chay tiep. Noi goi PHAI kiem errorlevel
rem roi goto :fail_abort.
if not defined ACTUALSHA (
  rem Khong dung "[!]" trong echo: script bat EnableDelayedExpansion nen "!" bi an.
  echo  [X] Khong doc duoc chu ky file.
  exit /b 1
)
if /i "%ACTUALSHA%"=="%EXESHA%" (
  rem Lan kiem lai o chan cuoi dat QUIETOK de khong in trung thong bao.
  if not defined QUIETOK echo  [OK] Chu ky file khop.
  exit /b 0
)
echo.
echo  [X] FILE TAI VE KHONG DUNG CHU KY.
echo      Co the do mang chap chon hoac bi can thiep.
exit /b 1

:fail_abort
rem Diem dung DUY NHAT khi hash sai: khong move, khong chay EXE.
echo      Da huy cai dat. Vui long chay lai file nay.
del /f /q "%EXE%.new" >nul 2>&1
pause
exit /b 9
`;
}

/* ============================ Mẫu PowerShell ============================ */

function buildPs1({ key, base, installDir, selfUrl, token }) {
  // CHU Y: KHONG dung comment khoi <# ... #> o dau file.
  // Khi chay qua "irm ... | iex", PowerShell doc theo TUNG DONG, nen comment
  // khoi nhieu dong lam vo parser ("The terminator '#>' is missing").
  // Dung comment tung dong '#' thay the.
  return `# XArena No Fog - Bo cai dat tu dong (PowerShell)
#
# Cach dung 1 lenh (khuyen dung):
#
# Hoac tai file roi chay:
#   powershell -NoProfile -ExecutionPolicy Bypass -File cai-dat.ps1
#
# Script KHONG co BOM va KHONG dung $PSCommandPath, de chay duoc ca khi
# pipe vao iex. Khi can quyen admin, no tu tai lai chinh minh bang URL.

$ErrorActionPreference = 'Stop'
$Key      = '${key}'
$Base     = '${base}'
$Target   = '${installDir}'
$ExeName  = '${EXE_NAME}'
$Exe      = Join-Path $Target $ExeName
# PowerShell đọc "$Base/download/..." là PHÉP CHIA (vì /download/
$Url      = "\${Base}/download/$ExeName"
$WantSha  = '${EXE_SHA256}'
$WantSize = ${EXE_SIZE}

# ---------------------------------------------------------------------------
# BAM SHA-256 - TUONG THICH MOI WINDOWS
#
# Get-FileHash chi co tu PowerShell 4.0 (Windows 8.1+). Windows 7 mac dinh
# co PowerShell 2.0 -> goi Get-FileHash se bao CommandNotFoundException.
# Ham nay thu 3 cach: Get-FileHash -> certutil -> .NET SHA256.
# certutil.exe co tu Windows XP nen gan nhu may nao cung co.
# ---------------------------------------------------------------------------
function Get-Sha256 {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return '' }

  # Cach 1: Get-FileHash (PowerShell 4.0+)
  $hasGFH = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($hasGFH) {
    try {
      return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash
    } catch { }
  }

  # Cach 2: certutil (Windows XP+) - loc dong chi chua hex 64 ky tu
  try {
    $out = & certutil.exe -hashfile "$Path" SHA256 2>$null
    foreach ($line in $out) {
      $t = ($line -replace '[^0-9A-Fa-f]', '')
      if ($t.Length -eq 64) { return $t.ToUpper() }
    }
  } catch { }

  # Cach 3: .NET (PowerShell 2.0+)
  try {
    $fs = [System.IO.File]::OpenRead($Path)
    try {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try { $bytes = $sha.ComputeHash($fs) } finally { $sha.Dispose() }
    } finally { $fs.Dispose() }
    return ([System.BitConverter]::ToString($bytes) -replace '-', '')
  } catch { }

  return ''
}

function Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }
# Read-Host crash khi PowerShell chay o che do NonInteractive (irm | iex,
# hoac -NonInteractive). Halt() chi hoi khi that su co console.
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
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '    XArena No Fog - Bo cai dat tu dong' -ForegroundColor White
Write-Host "    Ma license: $Key" -ForegroundColor DarkGray
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Step 'Can quyen Administrator. Dang yeu cau...'
  # KHONG dung $PSCommandPath: no rong khi chay qua "irm ... | iex".
  # Thay vao do tu tai lai chinh script nay bang URL roi chay lai o che do admin.
  $selfTmp = Join-Path $env:TEMP ('xa-install-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.ps1')
  $ok = $false
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile('${selfUrl}', $selfTmp)
    $ok = (Test-Path -LiteralPath $selfTmp)
  } catch { }
  if (-not $ok -and (Test-Path -LiteralPath $PSCommandPath)) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $selfTmp -Force
    $ok = $true
  }
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
  # KHONG duoc chi so kich thuoc. Truoc day chi can dung $WantSize la
  # "bo qua tai" -> dat mot binary tuy y dung 13.2 MB vao duong dan cai dat
  # la duoc chay bang quyen Administrator ma khong bi phat hien.
  # Luon bam lai SHA-256; certutil tren 13 MB chi mat ~30ms.
  $cacheSha = ''
  try {
    $cacheSha = Get-Sha256 -Path $Exe
  } catch { $cacheSha = '' }
  if ($cacheSha -and ($cacheSha -eq $WantSha)) {
    Good 'Bo xu ly da co san va dung chu ky, bo qua tai.'
    $needDownload = $false
  } else {
    Step 'Bo xu ly cu sai chu ky - xoa va tai lai.'
    Remove-Item -Force -LiteralPath $Exe -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Exe) {
      Write-Host '  [X] Khong xoa duoc file cu (dang bi khoa). Huy cai dat.' -ForegroundColor Red
      exit 9
    }
  }
}

if ($needDownload) {
  Step 'Dang tai bo xu ly (12 MB)...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = "$Exe.download"
  Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  $ok = $false
  foreach ($try in 1..3) {
    try {
      $wc = New-Object Net.WebClient
      $wc.Headers.Add('User-Agent', 'XArenaInstaller/1.0')
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

  $sha = Get-Sha256 -Path $tmp
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
# Ma TR- = dung thu -> --trial-key (khong hoi gi)
if ($Key -like 'TR-*') {
  & $Exe --trial-key $Key
} else {
  & $Exe --key $Key
}
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Warn "KICH HOAT THAT BAI (ma $LASTEXITCODE)."
  Warn 'Kiem tra trang thai key tai muc "License cua toi" tren website.'
  Remove-Item -Force -LiteralPath (Join-Path $env:LOCALAPPDATA 'XArenaNoFog/lic.bin') -ErrorAction SilentlyContinue
  Halt 10 "KICH HOAT THAT BAI (ma $LASTEXITCODE). Kiem tra key tren website."
}
Good 'Kich hoat thanh cong.'
Write-Host ''

Step 'Tao shortcut...'
$wsh = New-Object -ComObject WScript.Shell
foreach ($p in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))) {
  try {
    $lnk = Join-Path $p 'XArena No Fog.lnk'
    $s = $wsh.CreateShortcut($lnk)
    $s.TargetPath = $Exe
    $s.WorkingDirectory = $Target
    $s.Description = "XArena No Fog - Ban quyen $Key"
    $s.IconLocation = "$Exe,0"
    $s.Save()
  } catch { Warn "Khong tao duoc shortcut tai $p" }
}
Good 'Da tao shortcut ngoai Desktop va Start Menu.'

# ---- Go cai dat ----
$uninst = Join-Path $Target 'go-cai-dat.ps1'
$ub = @'
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Dang go cai dat XArena No Fog...'

$desk  = [Environment]::GetFolderPath('Desktop')
$progs = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
Remove-Item -Force -LiteralPath (Join-Path $desk  'XArena No Fog.lnk')
Remove-Item -Force -LiteralPath (Join-Path $progs 'XArena No Fog.lnk')
Write-Host '  Da xoa shortcut Desktop va Start Menu.'

$licDir = Join-Path $env:LOCALAPPDATA 'XArenaNoFog'
Remove-Item -Force -LiteralPath (Join-Path $licDir 'lic.bin')
Remove-Item -Force -LiteralPath $licDir -Recurse
Write-Host '  Da xoa state license.'

foreach ($hive in @('HKCU:','HKLM:')) {
  $p = "$hive/Software/Microsoft/Windows NT/CurrentVersion/AppCompatFlags/Layers"
  Remove-ItemProperty -Path $p -Name $Exe -Force
}
Write-Host '  Da xoa cau hinh RUNASADMIN.'
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
Write-Host "   - EXE da duoc ep chay voi quyen Administrator"
Write-Host "   - Go cai dat: $uninst"
Write-Host ''
Warn 'Key chi dung duoc tren 1 may tinh.'
Write-Host ''
try { if (-not [Console]::IsInputRedirected) { Read-Host 'Nhan Enter de dong' | Out-Null } } catch { }
`;
}

/* ============================ Handlers ============================ */

export async function serveInstaller(env, request, rawKey) {
  const lic = await requireUsableLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  // assertCanInstall() trả sớm khi đã đăng nhập, nên token PHẢI được kiểm ở đây
  // trước khi nội suy vào script — nếu không, newline trong `t` = command injection.
  if (token) assertTokenShape(token);
  const body = buildCmd({
    key: lic.key, base: siteBase(request),
    exeSha: EXE_SHA256, exeSize: EXE_SIZE, installDir: INSTALL_DIR, token,
  });
  // QUAN TRỌNG: cmd.exe yêu cầu CRLF. File LF thuần gây lỗi
  // ". was unexpected at this time." ở các khối if/for nhiều dòng.
  const crlf = body.replace(/\r?\n/g, '\r\n');
  return new Response(crlf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream; charset=utf-8',
      'Content-Disposition': `attachment; filename="cai-dat-XArena-${lic.key}.cmd"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function servePs1(env, request, rawKey) {
  const lic = await requireUsableLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  if (token) assertTokenShape(token);
  const base = siteBase(request);
  const selfUrl = `${base}/i/${lic.key}.ps1?t=${token}`;
  const body = buildPs1({
    key: lic.key, base, installDir: INSTALL_DIR, selfUrl, token,
  });
  // KHONG co BOM: '\uFEFF' lam hong tokenizer khi chay qua "irm | iex".
  // Content-Type phai la text/plain: neu la application/octet-stream thi
  // Invoke-RestMethod nhan byte[] thay vi string -> iex khong chay duoc.
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="cai-dat-XArena-${lic.key}.ps1"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function installerCommand(env, request, rawKey) {
  const lic = await requireUsableLicense(env, rawKey);
  await assertCanInstall(env, request, lic.key);

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  if (token) assertTokenShape(token);
  const base = siteBase(request);
  const q = token ? `?t=${token}` : '';
  return new Response(JSON.stringify({
    ok: true,
    key: lic.key,
    cmd: `curl -L -o "%TEMP%\\xa.cmd" "${base}/i/${lic.key}.cmd${q}" && "%TEMP%\\xa.cmd"`,
    powershell: `iwr -OutFile "$env:TEMP\\xa.ps1" "${base}/i/${lic.key}.ps1${q}"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\xa.ps1"`,
    downloadCmd: `${base}/i/${lic.key}.cmd${q}`,
    downloadPs1: `${base}/i/${lic.key}.ps1${q}`,
    exeUrl: `${base}/download/${EXE_NAME}`,
    exeSha256: EXE_SHA256,
    installDir: INSTALL_DIR,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Stream EXE từ R2. Hỗ trợ Range để resume. */
export async function downloadExe(env, request) {
  if (!env.MEDIA) throw new ApiError(503, 'Chưa cấu hình R2', 'NOT_CONFIGURED');

  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(`files/${EXE_NAME}`, range ? { range: request.headers } : {});
  if (!obj) throw new ApiError(404, 'Không tìm thấy bộ cài', 'NOT_FOUND');

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${EXE_NAME}"`);
  headers.set('Accept-Ranges', 'bytes');
  // no-cache + ETag: trình duyệt vẫn hỏi lại (304 nếu chưa đổi), nhưng KHÔNG
  // dùng bản cũ sau khi cập nhật EXE (max-age trước đây gây cài hỏng vì SHA fail).
  headers.set('Cache-Control', 'no-cache');
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (obj.range) {
    const offset = obj.range.offset || 0;
    const length = obj.range.length !== undefined ? obj.range.length : obj.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
