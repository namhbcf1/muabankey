/**
 * Kiểm thử MUA HÀNG -> QUYỀN CỘNG THẲNG VÀO TÀI KHOẢN (không sinh key cho khách).
 *
 *   node scripts/test-account-purchase.mjs [baseUrl]
 *
 * Kịch bản:
 *   1. Đăng ký tài khoản
 *   2. Chưa mua -> /api/account/token phải trả no_entitlement
 *   3. Tạo đơn mua gói "map sáng 30 ngày"
 *   4. Admin xác nhận thanh toán -> giao hàng
 *   5. /api/entitlement -> hasNofog true, hạn ~30 ngày
 *   6. /api/account/token -> cấp token xn1. thật
 *   7. Mua thêm gói tài nguyên -> hasGrant true
 *   8. Đơn hàng KHÔNG trả key cho khách
 */

const BASE = process.argv[2] || 'https://xienhl.com';
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(`${name}${extra ? ' — ' + extra : ''}`); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log(`\n${t}`); }

function fakeParts(seed) {
  return {
    guid: `guid-${seed}-4f2a-9b1c-${seed}0000000000`,
    bios: `BIOS-${seed}-A1B2C3`,
    cpu: `Intel(R) Core(TM) i7-${seed}`,
    vol: `1234-${seed}AB`,
  };
}

async function main() {
  console.log('\n🧪 MUA HÀNG -> CỘNG VÀO TÀI KHOẢN');
  console.log(`   ${BASE}\n`);

  // ---- 1. Đăng ký ----
  section('1. Tài khoản mới');
  const uname = `buy${Date.now().toString(36)}`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: 'Test123456' }),
  });
  const regD = await reg.json().catch(() => ({}));
  ok('đăng ký 201', reg.status === 201, `status=${reg.status}`);
  if (reg.status !== 201) return finish();
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const p1 = fakeParts(RUN);

  // ---- 2. Chưa có quyền ----
  section('2. Chưa mua gì');
  const t0 = await fetch(`${BASE}/api/account/token`, {
    method: 'POST', headers: H, body: JSON.stringify(p1),
  });
  const t0d = await t0.json();
  ok('account/token trả 403 no_entitlement',
    t0.status === 403 && t0d.code === 'no_entitlement',
    `status=${t0.status} code=${t0d.code}`);

  // ---- 3. Tạo đơn ----
  section('3. Mua gói map sáng 30 ngày');
  const prods = await fetch(`${BASE}/api/products?perPage=50`);
  const prodsD = await prods.json();
  const month = (prodsD.products || []).find((p) => p.slug === 'license-xarena-thang');
  ok('tìm thấy gói tháng', !!month, month?.slug);

  const order = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ items: [{ productId: month.id, quantity: 1 }] }),
  });
  const orderD = await order.json();
  ok('tạo đơn 201', order.status === 201,
    `status=${order.status} ${JSON.stringify(orderD).slice(0, 150)}`);
  const orderId = orderD.order?.id;

  // ---- 4. Admin xác nhận thanh toán ----
  section('4. Admin xác nhận -> giao hàng');
  const adminLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.ADMIN_USER || 'namhbcf',
      password: process.env.ADMIN_PASSWORD || '',
    }),
  });
  if (adminLogin.status !== 200) {
    console.log('  ⏭  bỏ qua (cần ADMIN_PASSWORD trong môi trường)');
    return finish();
  }
  const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];

  const confirm = await fetch(`${BASE}/api/admin/orders/${orderId}/confirm-payment`, {
    method: 'POST', headers: { Cookie: adminCookie },
  });
  const confirmD = await confirm.json().catch(() => ({}));
  ok('xác nhận thanh toán 200', confirm.status === 200,
    `status=${confirm.status} ${JSON.stringify(confirmD).slice(0, 200)}`);

  // ---- 5. Entitlement ----
  section('5. Quyền đã cộng vào tài khoản');
  const ent = await fetch(`${BASE}/api/entitlement`, { headers: { Cookie: cookie } });
  const entD = await ent.json();
  ok('hasNofog = true', entD.hasNofog === true, `hasNofog=${entD.hasNofog}`);
  ok('có chi tiết hạn nofog', !!entD.nofog, JSON.stringify(entD.nofog));
  const daysLeft = Number(entD.nofog?.daysLeft || 0);
  ok('hạn ~30 ngày', daysLeft >= 29 && daysLeft <= 31, `daysLeft=${daysLeft}`);

  // ---- 6. Cấp token ----
  section('6. Cấp token theo quyền tài khoản');
  const t1 = await fetch(`${BASE}/api/account/token`, {
    method: 'POST', headers: H, body: JSON.stringify(p1),
  });
  const t1d = await t1.json();
  ok('account/token 200', t1.status === 200,
    `status=${t1.status} ${JSON.stringify(t1d).slice(0, 200)}`);
  ok('có token map sáng', String(t1d.nofog?.token || '').startsWith('xn1.'),
    (t1d.nofog?.token || '').slice(0, 20));
  ok('KHÔNG có token tài nguyên (chưa mua)', !t1d.grant, JSON.stringify(t1d.grant));

  // ---- 7. Đơn hàng không trả key ----
  section('7. Khách KHÔNG thấy key');
  const od = await fetch(`${BASE}/api/orders/${orderId}`, { headers: { Cookie: cookie } });
  const odD = await od.json();
  const keys = JSON.stringify(odD);
  const hasKey = /AOE1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(keys);
  ok('đơn hàng không chứa key', !hasKey, hasKey ? 'CÓ KEY LỘ RA' : '');

  // ---- 8. Mua thêm gói tài nguyên ----
  section('8. Mua thêm gói tài nguyên');
  const gProd = (prodsD.products || []).find((p) => p.slug === 'license-xarena-grant-month');
  ok('tìm thấy gói tài nguyên', !!gProd, gProd?.slug);
  const o2 = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ items: [{ productId: gProd.id, quantity: 1 }] }),
  });
  const o2D = await o2.json();
  const o2Id = o2D.order?.id;
  const c2 = await fetch(`${BASE}/api/admin/orders/${o2Id}/confirm-payment`, {
    method: 'POST', headers: { Cookie: adminCookie },
  });
  ok('xác nhận đơn 2', c2.status === 200, `status=${c2.status}`);

  const ent2 = await fetch(`${BASE}/api/entitlement`, { headers: { Cookie: cookie } });
  const ent2D = await ent2.json();
  ok('hasGrant = true sau khi mua', ent2D.hasGrant === true, `hasGrant=${ent2D.hasGrant}`);
  ok('hasNofog vẫn true', ent2D.hasNofog === true, `hasNofog=${ent2D.hasNofog}`);

  const t2 = await fetch(`${BASE}/api/account/token`, {
    method: 'POST', headers: H, body: JSON.stringify(p1),
  });
  const t2d = await t2.json();
  ok('có token tài nguyên', String(t2d.grant?.token || '').startsWith('xg1.'),
    (t2d.grant?.token || '').slice(0, 20));

  finish();
}

function finish() {
  console.log('\n' + '─'.repeat(52));
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  if (fail) {
    console.log('\nChi tiết lỗi:');
    for (const f of fails) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log('🎉 Tất cả PASS');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
