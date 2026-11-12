/**
 * Test: nút "Giao" của admin phải cấp KEY thật (không chỉ đổi status).
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}


/* ===== CUA SO GIO: tat trong luc test, bat lai sau =====
 * Cua so that 00:00-11:59 (chu shop chot). Test can tu dong giao de kiem
 * logic, nen tam tat (enabled=0 = luon tu giao) roi bat lai.
 */
const _CF_T = process.env.CLOUDFLARE_API_TOKEN;
const _CF_A = process.env.CLOUDFLARE_ACCOUNT_ID;
const _CF_D = '81f478c9-5627-458a-a35f-d483e69d400b';
async function _cfSql(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${_CF_A}/d1/database/${_CF_D}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${_CF_T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  return (await r.json()).result?.[0]?.results;
}
async function _winOff() {
  await _cfSql("UPDATE settings SET value='0' WHERE key='sepay_auto_enabled'");
  await new Promise((r) => setTimeout(r, 6000));
}
async function _winOn() {
  await _cfSql("UPDATE settings SET value='1' WHERE key='sepay_auto_enabled'");
}

(async () => {
  await _winOff();
  console.log('\n🔧 TEST NÚT "GIAO" PHẢI CẤP KEY\n');

  // Đăng ký + tạo đơn
  const u = 'dlv' + Math.random().toString(36).slice(2, 9);
  const reg = await fetch(B + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'abc123' }),
  });
  const ck = reg.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const pr = await fetch(B + '/api/products').then((r) => r.json());
  const prod = (pr.products || []).find((p) => p.deliveryType === 'license');

  const o = await fetch(B + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: JSON.stringify({ items: [{ productId: prod.id, quantity: 1 }] }),
  }).then((r) => r.json());
  console.log(`  Đơn: ${o.order.code} — ${o.order.total}đ`);

  // Admin login
  const alr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ack = alr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  // Đặt đơn thành 'paid' (mô phỏng đã nhận tiền)
  await q("UPDATE orders SET status='paid', paid_at=? WHERE id=?",
    [Date.now(), o.order.id]);
  console.log('  Đơn → paid\n');

  // Đếm license trước
  const beforeLic = await q(
    'SELECT COUNT(*) AS n FROM licenses'
  );

  // Bấm "Giao"
  const dlv = await fetch(B + `/api/admin/orders/${o.order.id}/deliver`, {
    method: 'POST', headers: { Cookie: ack },
  });
  const dlvData = await dlv.json();
  console.log(`  POST /deliver: ${dlv.status} ${JSON.stringify(dlvData).slice(0, 150)}`);
  ok('deliver 200', dlv.status === 200, `status=${dlv.status}`);

  // Kiểm tra status
  const st = await q('SELECT status FROM orders WHERE id = ?', [o.order.id]);
  ok('đơn delivered', st[0]?.status === 'delivered', st[0]?.status);

  // Kiểm tra KEY thật
    /*
   * delivered_keys trong DB được MÃ HOÁ AES-256-GCM ('enc1:...').
   * Đọc thô rồi JSON.parse sẽ ra rỗng — phải kiểm qua API của khách
   * (server tự giải mã) hoặc qua license_issues.
   */
  const lic = await q(
    `SELECT license_key FROM license_issues WHERE order_id = '${o.order.id}'`
  );
  console.log(`  license_issues: ${lic.length} dòng`);
  if (lic[0]) console.log(`    ${String(lic[0].license_key).slice(0, 40)}`);
  ok('CẤP KEY THẬT (license_issues)', lic.length > 0, `rows=${lic.length}`);

  // Kiểm qua API khách nhận được key (server giải mã)
  const asUser = await fetch(B + `/api/orders/${o.order.id}`, {
    headers: { Cookie: ck },
  }).then((r) => r.json());
  const itemsOut = asUser.order?.items || [];
  const got = itemsOut.flatMap((it) => it.keys || []);
  console.log(`  API trả khách: ${got.length} key`);
  if (got[0]) console.log(`    ${String(got[0]).slice(0, 40)}`);
  ok('khách đọc được key', got.length > 0, `keys=${got.length}`);

  // Bấm lại -> không cấp thêm
  const dlv2 = await fetch(B + `/api/admin/orders/${o.order.id}/deliver`, {
    method: 'POST', headers: { Cookie: ack },
  }).then((r) => r.json());
  ok('bấm lại không cấp thêm', dlv2.already === true,
    JSON.stringify(dlv2).slice(0, 60));

  const lic2 = await q(
    `SELECT license_key FROM license_issues WHERE order_id = '${o.order.id}'`
  );
  ok('số key không đổi', lic2.length === lic.length,
    `${lic.length} -> ${lic2.length}`);


  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  await _winOn();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { await _winOn(); console.error('💥', e.message); process.exit(1); });
