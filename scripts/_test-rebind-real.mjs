/**
 * TEST THẬT luồng "Đổi máy / Reset HWID" trên production.
 * Dùng tài khoản demo (có số dư) + admin/reset.
 * Có ghi DB thật qua API chính thức của shop (mua license, activate, rebind, reset).
 */
import { readFileSync } from 'node:fs';

const B = process.argv[2] || 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

const log = [];
function step(t) { console.log(`\n──────── ${t} ────────`); }

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const ck = r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0] || null;
  return { status: r.status, cookie: ck, data: await r.json().catch(() => null) };
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const h = { Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: r.status, data };
}

const lic = (path, payload) => call(path, { method: 'POST', body: payload }); // KHÔNG cookie = như client EXE

const HWID_A = 'aaaa1111' + 'a'.repeat(24);   // máy cũ
const HWID_B = 'bbbb2222' + 'b'.repeat(24);   // máy mới (sau khi khách bấm Đổi máy)
const HWID_C = 'cccc3333' + 'c'.repeat(24);   // máy mới (sau khi admin reset)

function row(name, r, extra = '') {
  const s = r.status;
  const ok = s < 400;
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(46)} HTTP ${s} ${extra}`);
  const j = typeof r.data === 'object' ? JSON.stringify(r.data) : r.data;
  console.log(`      ${String(j).slice(0, 240)}`);
  log.push({ name, status: s, body: String(j).slice(0, 300) });
  return r;
}

async function main() {
  console.log(`\n===== TEST THẬT RESET HWID @ ${B} =====`);

  /* ---------- chuẩn bị ---------- */
  step('0. Đăng nhập demo + admin');
  const demo = await login('demo@muabankey.vn', 'Demo@123456');
  console.log(`  demo login ${demo.status}, balance=${demo.data?.user?.balance}`);
  const adm = await login('namhbcf', pw);
  console.log(`  admin login ${adm.status}`);
  if (!demo.cookie || !adm.cookie) { console.log('❌ không đăng nhập được'); return; }

  /* ---------- A. license demo cũ 1/1 ---------- */
  step('A. License demo sẵn có: quota đã hết (1/1)');
  const mine0 = await call('/api/licenses/mine', { cookie: demo.cookie });
  const old = mine0.data.licenses?.[0];
  console.log(`  key=${old?.key} status=${old?.status} đổi máy=${old?.rebinds}/${old?.maxRebind}`);
  const btnVisible = ['active', 'forever', 'expiring', 'unbound'].includes(old?.status)
    && old?.rebinds < old?.maxRebind;
  console.log(`  → Nút "Đổi máy" có hiện trên UI? ${btnVisible ? 'CÓ' : 'KHÔNG (bị ẩn)'}`);
  const rbOld = await call(`/api/licenses/${old.key}/rebind`, { method: 'POST', cookie: demo.cookie });
  row('rebind license đã hết lượt', rbOld, `code=${rbOld.data?.code}`);

  /* ---------- B. mua license mới ---------- */
  step('B. Mua license tuần mới bằng số dư demo');
  const prods = await call('/api/products?category=license-xarena&perPage=20');
  const week = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');
  console.log(`  sản phẩm: ${week?.name} ${week?.price}đ prefix=${week?.licensePrefix}`);

  const order = await call('/api/orders', {
    method: 'POST', cookie: demo.cookie,
    body: { items: [{ productId: week.id, quantity: 1 }] },
  });
  row('tạo đơn', order, order.data?.order?.code || '');
  const oid = order.data?.order?.id;
  const pay = await call(`/api/orders/${oid}/pay`, { method: 'POST', cookie: demo.cookie });
  row('thanh toán', pay, JSON.stringify(pay.data?.order?.status || '').slice(0, 80));
  const line = pay.data?.order?.delivered?.[0];
  const KEY = line?.raw?.[0] || line?.keys?.[0];
  console.log(`  🔑 KEY MỚI = ${KEY}`);
  if (!KEY) { console.log('❌ không lấy được key'); return; }

  /* ---------- C. kích hoạt máy A ---------- */
  step('C. Client kích hoạt trên MÁY CŨ (A)');
  const actA = await lic('/api/activate', { key: KEY, hwid: HWID_A, app: 'XArena No Fog' });
  row('activate máy A', actA, `first_bind=${actA.data?.first_bind}`);

  const dbAfterA = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm.cookie });
  const L1 = dbAfterA.data.licenses?.find((l) => l.key === KEY);
  console.log(`  DB: hwid=${L1?.hwidMasked} rebinds=${L1?.rebinds}/${L1?.maxRebind} status=${L1?.status}`);

  /* ---------- D. khách bấm nút "Đổi máy" ---------- */
  step('D. Khách bấm "🔄 Đổi máy" trên /#/licenses');
  const rb1 = await call(`/api/licenses/${KEY}/rebind`, { method: 'POST', cookie: demo.cookie });
  row('POST /api/licenses/:key/rebind', rb1, `rebindsLeft=${rb1.data?.rebindsLeft}`);
  const TOKEN = rb1.data?.token;
  console.log(`  token nhận được: ${TOKEN ? TOKEN.slice(0, 16) + '…' : '(KHÔNG CÓ)'}`);
  console.log(`  command server trả: ${rb1.data?.command || '(KHÔNG CÓ)'}`);

  const dbAfterToken = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm.cookie });
  const L2 = dbAfterToken.data.licenses?.find((l) => l.key === KEY);
  console.log(`  DB SAU KHI BẤM NÚT: hwid=${L2?.hwidMasked} rebinds=${L2?.rebinds}/${L2?.maxRebind}`);
  console.log(`  → HWID có bị reset không? ${L2?.hwid ? 'KHÔNG (vẫn là máy cũ)' : 'CÓ'}`);
  console.log(`  → rebinds có tăng không? ${L2?.rebinds > L1?.rebinds ? 'CÓ' : 'KHÔNG'}`);

  /* ---------- E. máy mới activate trực tiếp (khách làm theo hướng dẫn cũ) ---------- */
  step('E. Máy mới (B) chạy installer --key NGAY sau khi bấm Đổi máy');
  const actBdirect = await lic('/api/activate', { key: KEY, hwid: HWID_B, app: 'XArena No Fog' });
  row('activate máy B (chưa gọi /api/rebind)', actBdirect, `code=${actBdirect.data?.code}`);

  /* ---------- F. máy mới gọi /api/rebind bằng token ---------- */
  step('F. Máy mới gọi POST /api/rebind {key,hwid,token} như client EXE');
  const rbB = await lic('/api/rebind', { key: KEY, hwid: HWID_B, token: TOKEN, app: 'XArena No Fog' });
  row('POST /api/rebind (token)', rbB, `rebinds_left=${rbB.data?.rebinds_left}`);

  const dbAfterB = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm.cookie });
  const L3 = dbAfterB.data.licenses?.find((l) => l.key === KEY);
  console.log(`  DB: hwid=${L3?.hwidMasked} rebinds=${L3?.rebinds}/${L3?.maxRebind} status=${L3?.status}`);

  const actB2 = await lic('/api/activate', { key: KEY, hwid: HWID_B, app: 'XArena No Fog' });
  row('activate máy B sau rebind', actB2, `first_bind=${actB2.data?.first_bind}`);

  /* ---------- G. dùng lại token (phải bị chặn) ---------- */
  step('G. Dùng lại token cũ (phải bị chặn)');
  const rbB2 = await lic('/api/rebind', { key: KEY, hwid: HWID_C, token: TOKEN, app: 'XArena No Fog' });
  row('POST /api/rebind token đã dùng', rbB2, `code=${rbB2.data?.code}`);

  /* ---------- H. hết quota ---------- */
  step('H. Bấm "Đổi máy" lần 2 — max_rebind = 1');
  const rb2 = await call(`/api/licenses/${KEY}/rebind`, { method: 'POST', cookie: demo.cookie });
  row('POST /api/licenses/:key/rebind (lần 2)', rb2, `code=${rb2.data?.code}`);
  console.log(`  → Thông báo khách thấy: ${rb2.data?.msg || rb2.data?.error}`);

  /* ---------- I. admin reset HWID ---------- */
  step('I. Admin bấm "Reset máy" trong tab License');
  const reset = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, {
    method: 'POST', cookie: adm.cookie,
  });
  row('POST /api/admin/licenses/:key/reset-hwid', reset,
    `sau reset hwid=${reset.data?.license?.key ? (reset.data.license.bound ? 'CÒN' : 'NULL') : '?'}`);
  const R = reset.data?.license;
  console.log(`  DB: hwid=${R?.bound ? R?.hwidMasked : 'NULL'} rebinds=${R?.rebinds}/${R?.maxRebind} status=${R?.status}`);

  /* ---------- J. máy mới activate sau reset ---------- */
  step('J. Máy mới (C) activate sau khi admin reset');
  const actC = await lic('/api/activate', { key: KEY, hwid: HWID_C, app: 'XArena No Fog' });
  row('activate máy C', actC, `first_bind=${actC.data?.first_bind}`);

  /* ---------- K. LỖ HỔNG: máy cũ online giành lại ---------- */
  step('K. ⚠️ Máy CŨ (A) còn chạy tool — tool tự check mỗi 30 phút');
  const steal = await lic('/api/check', { key: KEY, hwid: HWID_A, app: 'XArena No Fog' });
  row('máy cũ A gọi /api/check sau reset', steal, `first_bind=${steal.data?.first_bind}`);

  const dbSteal = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm.cookie });
  const L4 = dbSteal.data.licenses?.find((l) => l.key === KEY);
  console.log(`  DB: hwid=${L4?.hwidMasked}  → máy nào đang giữ key?`);
  const actC2 = await lic('/api/activate', { key: KEY, hwid: HWID_C, app: 'XArena No Fog' });
  row('máy C activate lại sau khi bị giành', actC2, `code=${actC2.data?.code}`);

  /* ---------- tổng kết ---------- */
  step('TỔNG KẾT');
  const fails = log.filter((x) => x.status >= 400);
  console.log(`  Tổng lời gọi: ${log.length}, lỗi HTTP: ${fails.length}`);
  const KEYOUT = KEY;
  console.log(`\n  KEY DÙNG TEST: ${KEYOUT}`);
  writeFileSync('scripts/_test-key.txt', KEYOUT + '\n');
}

import { writeFileSync } from 'node:fs';
main().catch((e) => { console.error('💥', e); process.exit(1); });
