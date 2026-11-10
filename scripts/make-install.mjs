/**
 * Dựng lệnh cài đặt (.cmd + one-liner) cho một key bất kỳ.
 *
 * Dùng khi bán thủ công qua Zalo/Telegram: admin lấy key trong kho,
 * chạy script này để sinh lệnh gửi khách.
 *
 * Cách dùng:
 *   node scripts/make-install.mjs AOE1-XXXX-XXXX-XXXX
 *   node scripts/make-install.mjs --file keys/xarena-....txt --index 5
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

  // Mặc định: key đầu tiên trong file mới nhất
  const dir = 'keys';
  if (existsSync(dir)) {
    const files = readFileSync('/dev/null', 'utf8').toString();
    void files;
  }
  throw new Error('Thiếu key. Dùng: node scripts/make-install.mjs AOE1-XXXX-XXXX-XXXX');
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

  // Đăng nhập admin
  const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];
  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: pw }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
  if (!ck) { console.error('  ❌ Không đăng nhập được'); process.exit(1); }

  // Kiểm tra key tồn tại
  const lic = await fetch(B + '/api/admin/licenses?q=' + encodeURIComponent(key), { headers: { Cookie: ck } })
    .then((r) => r.json()).catch(() => ({}));
  const found = (lic.licenses || []).find((x) => x.key === key);
  if (!found) {
    console.error(`  ❌ Key ${key} không có trong hệ thống`);
    process.exit(1);
  }

  const exp = found.expires_at ?? 0;
  // Key chưa kích hoạt: expires_at có thể null (chưa set) hoặc 0 (vĩnh viễn).
  // Phân biệt bằng activated_at: có activated_at mà expires_at=0 -> vĩnh viễn.
  let hanTxt;
  if (found.activated_at) {
    hanTxt = exp === 0 ? 'VĨNH VIỄN' : Math.round((exp - Date.now() / 1000) / 86400) + ' ngày';
  } else {
    hanTxt = exp === 0 ? 'VĨNH VIỄN (chưa kích hoạt)' : '(chưa kích hoạt — bắt đầu tính khi khách cài)';
  }
  console.log(`  Key   : ${key}`);
  console.log(`  Hạn   : ${hanTxt}`);
  console.log(`  HWID  : ${found.hwid || '(chưa kích hoạt)'}`);
  console.log(`  Thu hồi: ${found.revoked ? 'CÓ' : 'không'}`);
  console.log('');

  // Lấy install token
  const tr = await fetch(B + `/api/licenses/${encodeURIComponent(key)}/install-token`, {
    method: 'POST', headers: { Cookie: ck },
  });
  const tok = await tr.json();
  if (!tr.ok || !tok.ok) {
    console.error('  ❌ Không tạo được token:', JSON.stringify(tok).slice(0, 150));
    process.exit(1);
  }

  mkdirSync('keys/cmd', { recursive: true });

  // 1. File .cmd tải về
  const cmdUrl = tok.downloadCmd;
  const cmdResp = await fetch(cmdUrl);
  if (!cmdResp.ok) {
    console.error('  ❌ Không tải được .cmd:', cmdResp.status);
    process.exit(1);
  }
  const cmdBody = await cmdResp.text();
  const cmdPath = `keys/cmd/cai-dat-${key}.cmd`;
  // Ghi CRLF (cmd.exe bắt buộc)
  writeFileSync(cmdPath, cmdBody.replace(/\r?\n/g, '\r\n'), 'utf8');

  // 2. File .ps1
  const psResp = await fetch(tok.downloadPs1);
  const psBody = await psResp.text();
  const psPath = `keys/cmd/cai-dat-${key}.ps1`;
  writeFileSync(psPath, psBody, 'utf8');

  // 3. File hướng dẫn
  const hd = [
    `# Cài đặt XArena No Fog — key ${key}`,
    '',
    '## Cách 1: MỘT LỆNH (khuyến nghị)',
    '',
    'Bấm Win + R, dán lệnh dưới đây, Enter, rồi bấm Yes khi Windows hỏi:',
    '',
    '```',
    tok.oneLiner,
    '```',
    '',
    '## Cách 2: Tải file .cmd',
    '',
    `1. Tải: ${cmdUrl}`,
    '2. Double-click file vừa tải',
    '3. Bấm Yes khi Windows hỏi',
    '',
    '## Cách 3: File có sẵn trong thư mục này',
    '',
    `- \`cai-dat-${key}.cmd\` — double-click`,
    `- \`cai-dat-${key}.ps1\` — chuột phải → Run with PowerShell`,
    '',
    '## Lưu ý',
    '',
    '- Lệnh có hiệu lực **24 giờ** (hết hạn thì tạo lại)',
    '- Key gắn với máy đầu tiên kích hoạt (HWID)',
    '- Cần mạng mỗi lần chạy để xác minh bản quyền',
    '- Windows có thể cảnh báo "Windows protected your PC" → More info → Run anyway',
    '',
  ].join('\n');
  writeFileSync(`keys/cmd/HUONG-DAN-${key}.md`, hd, 'utf8');

  console.log('  ── LỆNH GỬI KHÁCH (copy nguyên dòng) ──\n');
  console.log('  ' + tok.oneLiner);
  console.log('');
  console.log('  ── FILE ĐÃ TẠO ──');
  console.log(`  📄 ${cmdPath}`);
  console.log(`  📄 ${psPath}`);
  console.log(`  📄 keys/cmd/HUONG-DAN-${key}.md`);
  console.log('');
  console.log(`  Hết hạn token: ${new Date(Date.now() + tok.expiresIn * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
  console.log('');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
