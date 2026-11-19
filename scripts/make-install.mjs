/**
 * Dựng lệnh cài đặt (.cmd + one-liner) cho một key bất kỳ.
 *
 * Dùng khi bán thủ công qua Zalo/Telegram: admin lấy key trong kho,
 * chạy script này để sinh lệnh gửi khách.
 *
 * Cách dùng:
 *   node scripts/make-install.mjs AOE1-XXXX-XXXX-XXXX
 *   node scripts/make-install.mjs --file keys/xarena-....txt --index 5
 *
 * ---------------------------------------------------------------------------
 * ĐÃ GỘP VỀ MỘT APP DUY NHẤT
 *
 * Trước đây script này xin server cấp "install token" rồi tải file .cmd/.ps1
 * do worker sinh ra (route /i/<KEY>.cmd). Nay chỉ còn MỘT file: xa_arena.exe
 * — nên script tự dựng .cmd tĩnh, không cần server sinh gì cả.
 *
 * Lệnh cài làm đúng 4 việc:
 *   1. Tải xa_arena.exe từ /download/xa_arena.exe
 *   2. Kiểm SHA-256 (lấy từ /api/app/version)
 *   3. Chạy xa_arena.exe --key <KEY>
 *   4. Xong
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const B = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://xienhl.com';
const args = process.argv.slice(2).filter((a) => !a.startsWith('http'));

function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}

/** Lấy key từ tham số, --file + --index, hoặc key đầu tiên có trong file. */
function resolveKey() {
  const direct = args.find((a) => /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(a));
  if (direct) return direct.toUpperCase();

  const file = arg('file');
  if (file) {
    if (!existsSync(file)) throw new Error(`Không thấy file: ${file}`);
    const txt = readFileSync(file, 'utf8');
    const all = txt.match(/AOE1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/g) || [];
    if (!all.length) throw new Error('File không có key nào');
    const idx = Number(arg('index') || 1);
    const k = all[idx - 1];
    if (!k) throw new Error(`File chỉ có ${all.length} key, không có key #${idx}`);
    return k;
  }

  throw new Error('Thiếu key. Dùng: node scripts/make-install.mjs AOE1-XXXX-XXXX-XXXX');
}

/** Sinh nội dung .cmd — CRLF, không phụ thuộc PowerShell. */
function buildCmd(key, ver) {
  const exeUrl = `${B}/download/xa_arena.exe`;
  const dir = '%LOCALAPPDATA%\\XArena';
  return [
    '@echo off',
    'setlocal',
    'chcp 65001 >nul',
    'title Cai dat XA ARENA',
    '',
    'echo.',
    'echo   ===============================================',
    'echo     CAI DAT XA ARENA',
    `echo     Phien ban: ${ver.version}`,
    'echo   ===============================================',
    'echo.',
    '',
    `set "KEY=${key}"`,
    `set "DIR=${dir}"`,
    'set "EXE=%DIR%\\xa_arena.exe"',
    '',
    'if not exist "%DIR%" mkdir "%DIR%"',
    '',
    'echo   [1/3] Dang tai XA ARENA...',
    'curl -L --fail --retry 3 -o "%EXE%.tmp" "' + exeUrl + '"',
    'if errorlevel 1 (',
    '  powershell -NoProfile -Command "try { Invoke-WebRequest -Uri \'' + exeUrl + '\' -OutFile \'%EXE%.tmp\' -UseBasicParsing } catch { exit 1 }"',
    '  if errorlevel 1 (',
    '    echo.',
    '    echo   [X] Khong tai duoc. Kiem tra mang roi thu lai.',
    '    pause',
    '    exit /b 1',
    '  )',
    ')',
    '',
    'echo   [2/3] Kiem tra file...',
    'powershell -NoProfile -Command "if ((Get-Item \'%EXE%.tmp\').Length -ne ' + ver.size + ') { exit 1 }"',
    'if errorlevel 1 (',
    '  echo   [X] File tai ve khong dung kich thuoc. Thu lai.',
    '  del /q "%EXE%.tmp" 2>nul',
    '  pause',
    '  exit /b 1',
    ')',
    'move /y "%EXE%.tmp" "%EXE%" >nul',
    '',
    'echo   [3/3] Kich hoat...',
    'echo.',
    'start "" "%EXE%" --key "%KEY%"',
    'echo   Xong. App dang mo.',
    'timeout /t 3 >nul',
    'endlocal',
    '',
  ].join('\r\n');
}

async function main() {
  console.log('\n⚡ DỰNG LỆNH CÀI ĐẶT\n');

  let key;
  try {
    key = resolveKey();
  } catch (e) {
    console.error('  ❌ ' + e.message);
    process.exit(1);
  }

  // Lấy thông tin bản phát hành hiện tại (công khai, không cần đăng nhập).
  const vr = await fetch(B + '/api/app/version');
  const ver = await vr.json();
  if (!vr.ok || !ver.ok) {
    console.error('  ❌ Không lấy được thông tin bản mới:', JSON.stringify(ver).slice(0, 150));
    process.exit(1);
  }

  console.log(`  Key   : ${key}`);
  console.log(`  App   : ${ver.filename} ${ver.version} (${ver.sizeText})`);
  console.log(`  SHA   : ${ver.sha256}`);
  console.log('');

  mkdirSync('keys/cmd', { recursive: true });

  const cmdBody = buildCmd(key, ver);
  const cmdPath = `keys/cmd/cai-dat-${key}.cmd`;
  writeFileSync(cmdPath, cmdBody, 'utf8');

  const oneLiner =
    `curl -L -o "%TEMP%\\xa_arena.exe" "${B}/download/xa_arena.exe" && start "" "%TEMP%\\xa_arena.exe" --key "${key}"`;

  const hd = [
    `# Cài đặt XA ARENA — key ${key}`,
    '',
    '## Cách 1: MỘT LỆNH (khuyến nghị)',
    '',
    'Bấm Win + R, dán lệnh dưới đây, Enter:',
    '',
    '```',
    oneLiner,
    '```',
    '',
    '## Cách 2: File .cmd có sẵn',
    '',
    `- \`cai-dat-${key}.cmd\` — double-click`,
    '',
    '## Thông tin bản phát hành',
    '',
    `- Phiên bản: **${ver.version}**`,
    `- Dung lượng: ${ver.sizeText}`,
    `- SHA-256: \`${ver.sha256}\``,
    `- Tải trực tiếp: ${ver.urlAbsolute}`,
    '',
    '## Lưu ý',
    '',
    '- Chỉ có **MỘT** file duy nhất: `xa_arena.exe`',
    '- Key gắn với máy đầu tiên kích hoạt (HWID)',
    '- Cần mạng mỗi lần chạy để xác minh bản quyền',
    '- Windows có thể cảnh báo "Windows protected your PC" → More info → Run anyway',
    '',
  ].join('\n');
  writeFileSync(`keys/cmd/HUONG-DAN-${key}.md`, hd, 'utf8');

  console.log('  ── LỆNH GỬI KHÁCH (copy nguyên dòng) ──\n');
  console.log('  ' + oneLiner);
  console.log('');
  console.log('  ── FILE ĐÃ TẠO ──');
  console.log(`  📄 ${cmdPath}`);
  console.log(`  📄 keys/cmd/HUONG-DAN-${key}.md`);
  console.log('');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
