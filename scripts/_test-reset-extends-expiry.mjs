/**
 * TEST: reset HWID có làm TĂNG HẠN không?
 *
 * bindFirstTime() (license-server.js:123-138) tính lại hạn:
 *   days = round((expires_at - created_at) / 86400)
 *   exp  = now + days*86400
 * => created_at là mốc TẠO, không phải mốc kích hoạt.
 * => Reset HWID sau N ngày => mỗi lần reset cộng thêm ~N ngày.
 *
 * Test: chọn 1 key CHƯA BÁN, tạo cách đây vài ngày, còn hạn.
 */
import { readFileSync } from 'node:fs';

const B = process.argv[2] || 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0] || null;
}
async function call(path, { method = 'GET', body, cookie } = {}) {
  const h = { Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const nowSec = () => Math.floor(Date.now() / 1000);
const d = (s) => (s / 86400).toFixed(2) + 'd';
const ts = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');

async function main() {
  const adm = await login('namhbcf', pw);
  if (!adm) { console.log('❌ admin login fail'); return; }

  /* Tìm key chưa bán, tạo cách đây >= 3 ngày, còn hạn >= 1 ngày */
  const list = await call('/api/admin/licenses?q=AOE1', { cookie: adm });
  const now = nowSec();
  const cands = (list.data.licenses || []).filter((l) =>
    !l.bound && l.status === 'unbound'
    && l.createdAt && (now - l.createdAt) > 3 * 86400
    && l.expiresAt && (l.expiresAt - now) > 1 * 86400);
  cands.sort((a, b) => a.createdAt - b.createdAt);
  console.log(`\nỨng viên (chưa bán, tạo >3 ngày trước): ${cands.length}`);
  if (!cands.length) { console.log('  (không có) -> dùng key vừa tạo, chỉ kiểm tra công thức'); }
  const pick = cands[0];
  if (pick) {
    console.log(`  chọn: ${pick.key}  tạo=${ts(pick.createdAt)}  hạn=${ts(pick.expiresAt)}`);
    console.log(`        tuổi key = ${d(now - pick.createdAt)}, còn lại = ${d(pick.expiresAt - now)}`);
  }

  const KEY = pick ? pick.key : null;
  if (!KEY) return;

  const HWID_X = 'x' + 'x'.repeat(31);
  const HWID_Y = 'y' + 'y'.repeat(31);

  console.log('\n──────── BƯỚC 1: activate máy X ────────');
  const a1 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: HWID_X, app: 'XArena No Fog' } });
  console.log(`  HTTP ${a1.status} first_bind=${a1.data.first_bind} expires_at=${a1.data.expires_at} (${ts(a1.data.expires_at || 0)})`);
  const E1 = a1.data.expires_at;

  console.log('\n──────── BƯỚC 2: admin reset-hwid ────────');
  const rs = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, { method: 'POST', cookie: adm });
  console.log(`  HTTP ${rs.status} hwid=${rs.data.license?.bound ? 'CÒN' : 'NULL'} status=${rs.data.license?.status}`);
  const expAfterReset = rs.data.license?.expiresAt;
  console.log(`  expires_at trong DB sau reset = ${expAfterReset} (${ts(expAfterReset || 0)})`);
  console.log(`  → reset có đụng vào expires_at? ${expAfterReset === E1 ? 'KHÔNG (giữ nguyên)' : 'CÓ'}`);

  console.log('\n──────── BƯỚC 3: activate máy Y ────────');
  const a2 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: HWID_Y, app: 'XArena No Fog' } });
  console.log(`  HTTP ${a2.status} first_bind=${a2.data.first_bind} expires_at=${a2.data.expires_at} (${ts(a2.data.expires_at || 0)})`);
  const E2 = a2.data.expires_at;

  console.log('\n──────── KẾT QUẢ ────────');
  const delta = E2 - E1;
  console.log(`  Hạn trước reset (E1) : ${E1}  ${ts(E1)}`);
  console.log(`  Hạn sau  reset (E2) : ${E2}  ${ts(E2)}`);
  console.log(`  CHÊNH LỆCH           : ${delta} giây = ${d(delta)}`);
  console.log(`  Tuổi key lúc tạo test: ${d(now - pick.createdAt)}`);
  if (delta > 60) {
    console.log(`\n  🚨 LỖ HỔNG: reset HWID CỘNG THÊM ${d(delta)} vào hạn dùng!`);
    console.log(`     ≈ đúng bằng tuổi key (${d(now - pick.createdAt)}).`);
    console.log('     Nguyên nhân: bindFirstTime() lấy created_at làm mốc, không phải activated_at.');
    console.log('     Hệ quả: cứ mỗi lần admin "Reset máy" là tặng thêm thời gian = tuổi key.');
  } else {
    console.log('  ✅ Không đổi hạn (hoặc đổi không đáng kể vì key vừa tạo).');
  }

  /* dọn: reset lại để key về trạng thái chưa gán */
  const rs2 = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, { method: 'POST', cookie: adm });
  console.log(`\n  (đã reset lại key để trả về chưa gán: HTTP ${rs2.status}, status=${rs2.data.license?.status}, hạn=${ts(rs2.data.license?.expiresAt || 0)})`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
