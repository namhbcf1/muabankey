/**
 * TEST: sau khi admin reset HWID, MÁY CŨ còn chạy tool sẽ GIÀNH LẠI key
 * (tool tự /api/check mỗi 30 phút — TRIAL_RECHECK_SEC=1800)
 *
 * Kịch bản: reset -> máy cũ check (hwid=NULL => firstBind) -> máy mới activate
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

const HWID_OLD = 'o' + 'o'.repeat(31);  // máy cũ vẫn chạy tool
const HWID_NEW = 'n' + 'n'.repeat(31);  // máy mới khách vừa mua

async function main() {
  const adm = await login('namhbcf', pw);
  const demo = await login('demo@muabankey.vn', 'Demo@123456');

  // Tạo key test riêng bằng admin (không đụng key khách)
  const made = await call('/api/admin/licenses', {
    method: 'POST', cookie: adm, body: { count: 1, days: 30, prefix: 'RACE', note: 'RACE test reset-hwid' },
  });
  const KEY = made.data.keys[0];
  console.log(`\nKEY TEST: ${KEY}\n`);

  console.log('1) Máy CŨ kích hoạt');
  const a1 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: HWID_OLD, app: 'XArena No Fog' } });
  console.log(`   HTTP ${a1.status} first_bind=${a1.data.first_bind}`);

  console.log('\n2) Admin bấm "Reset máy"  (hwid = NULL)');
  const rs = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, { method: 'POST', cookie: adm });
  console.log(`   HTTP ${rs.status} hwid=${rs.data.license?.bound ? 'CÒN' : 'NULL'} status=${rs.data.license?.status}`);

  console.log('\n3) ⚠️  MÁY CŨ tự động /api/check (tool chạy nền, 30 phút/lần)');
  const chkOld = await call('/api/check', { method: 'POST', body: { key: KEY, hwid: HWID_OLD, app: 'XArena No Fog' } });
  console.log(`   HTTP ${chkOld.status} ok=${chkOld.data.ok} first_bind=${chkOld.data.first_bind} code=${chkOld.data.code || '-'}`);

  const afterOld = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm });
  const Lw = afterOld.data.licenses.find((l) => l.key === KEY);
  console.log(`   DB: hwid=${Lw?.hwidMasked} bound=${Lw?.bound}`);

  console.log('\n4) Máy MỚI kích hoạt (khách vừa cài trên máy mới)');
  const a2 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: HWID_NEW, app: 'XArena No Fog' } });
  console.log(`   HTTP ${a2.status} ok=${a2.data.ok} code=${a2.data.code || '-'} msg=${a2.data.msg || '-'}`);

  console.log('\n──────── KẾT LUẬN ────────');
  if (a2.data.ok === false && a2.data.code === 'hwid_mismatch') {
    console.log('  🚨 XÁC NHẬN LỖ HỔNG: máy CŨ đã giành lại key ngay sau khi reset.');
    console.log('     => Admin "Reset máy" xong, khách ở máy mới VẪN KHÔNG kích hoạt được.');
    console.log('     => Đây chính là "reset HWID chưa hoạt động" mà chủ shop gặp.');
  } else if (a2.data.ok) {
    console.log('  ✅ Máy mới kích hoạt được (máy cũ không giành lại trong khoảng test).');
  }

  // dọn
  await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/revoke`, { method: 'POST', cookie: adm });
  console.log(`\n  (đã thu hồi key test ${KEY})`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
