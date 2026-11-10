/**
 * race5.mjs — Coupon race: nhiều createOrder đồng thời cùng 1 mã usage_limit=1.
 * createOrder dùng check-then-increment KHÔNG nguyên tử (resolveCoupon đọc,
 * rồi batch mới UPDATE used_count).
 */
const B = 'https://xienhl.com';
const TOKEN = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const ACCOUNT = '5b62d10947844251d23e0eac532531dd';
const DBID = '81f478c9-5627-458a-a35f-d483e69d400b';
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DBID}/query`;
async function sql(q) {
  const r = await fetch(D1, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q }) });
  const j = await r.json();
  if (!j.success) throw new Error('D1: ' + JSON.stringify(j.errors));
  const res = j.result?.[0];
  if (res?.success === false) throw new Error('D1: ' + JSON.stringify(res.error));
  return res?.results ?? [];
}
const q1 = async (s) => (await sql(s))[0];
function mk() {
  let c = null;
  return { async req(p, o = {}) {
    const h = { 'Content-Type': 'application/json' }; if (c) h.Cookie = c;
    const r = await fetch(B + p, { method: o.method || 'GET', headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) c = m[0]; }
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  } };
}
const esc = (s) => String(s).replace(/'/g, "''");
const created = { users: [], orders: [], coupons: [] };
const out = [];
function rec(id, name, expect, actual, ok, extra) {
  out.push({ id, name, expect, actual, ok });
  const m = ok === true ? 'OK  ' : ok === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${m}] ${id} ${name}\n      kỳ vọng: ${expect}\n      thực tế : ${actual}${extra ? '\n      ' + extra : ''}`);
}
const admin = mk();
async function newUser(tag) {
  const u = mk();
  const email = `${tag}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.vn`;
  const r = await u.req('/api/auth/register', { method: 'POST', body: { email, password: 'Test123456', fullName: 'Race5 ' + tag } });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.data));
  created.users.push({ email, id: r.data.user.id });
  return { u, id: r.data.user.id, email };
}
async function fund(userId, amount) {
  const r = await admin.req('/api/admin/wallet/adjust', { method: 'POST', body: { userId, amount, reason: 'race5' } });
  if (r.status !== 200) throw new Error('fund ' + JSON.stringify(r.data));
  return r.data.balance;
}

async function main() {
  console.log('\n== RACE TEST 5 — coupon ==');
  await admin.req('/api/auth/login', { method: 'POST', body: { email: 'namhbcf', password: 'namhbcf123' } });
  const pp = await admin.req('/api/products?perPage=100');
  const licWeek = pp.data.products.find((p) => p.slug === 'license-xarena-tuan');

  /* F1 — 8 user khác nhau, cùng lúc tạo đơn với 1 mã usage_limit=1 */
  console.log('\n--- F1: 8 user tạo đơn ĐỒNG THỜI, coupon usage_limit=1 ---');
  {
    const code = 'RCF' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 50, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);
    const users = [];
    for (let i = 0; i < 8; i++) {
      const x = await newUser('f1' + i);
      await fund(x.id, 500000);
      users.push(x);
    }
    const res = await Promise.all(users.map((x) => x.u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    })));
    const okd = res.filter((r) => r.status === 201);
    okd.forEach((r) => created.orders.push(r.data.order.id));
    const used = await q1(`SELECT used_count, usage_limit FROM coupons WHERE code='${esc(code)}'`);
    const discounted = okd.filter((r) => r.data.order.discount > 0).length;

    rec('F1', '8 createOrder đồng thời, coupon usage_limit=1',
      'chỉ 1 đơn áp được mã, used_count = 1',
      `tạo được ${okd.length}/8, trong đó ${discounted} đơn được giảm giá, used_count=${used?.used_count}/${used?.usage_limit}`,
      discounted <= 1 && used?.used_count <= 1,
      `HTTP: ${res.map(r => r.status).join(',')} | mã lỗi: ${res.filter(r => r.status !== 201).map(r => r.data?.code).join(',')}`);
  }

  /* F2 — cùng 1 user, 10 đơn đồng thời với coupon */
  console.log('\n--- F2: 1 user tạo 10 đơn ĐỒNG THỜI cùng coupon usage_limit=1 ---');
  {
    const code = 'RCG' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 50, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);
    const { u, id } = await newUser('f2');
    await fund(id, 2000000);
    const res = await Promise.all(Array.from({ length: 10 }, () => u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    })));
    const okd = res.filter((r) => r.status === 201);
    okd.forEach((r) => created.orders.push(r.data.order.id));
    const used = await q1(`SELECT used_count, usage_limit FROM coupons WHERE code='${esc(code)}'`);
    const discounted = okd.filter((r) => r.data.order.discount > 0).length;
    rec('F2', '1 user 10 createOrder đồng thời cùng coupon limit=1',
      'chỉ 1 đơn được giảm giá',
      `tạo được ${okd.length}/10, được giảm giá ${discounted} đơn, used_count=${used?.used_count}/${used?.usage_limit}`,
      discounted <= 1 && used?.used_count <= 1,
      discounted > 1 ? `THẤT THOÁT ${discounted * 90000}đ do dùng mã nhiều lần` : '');
  }

  /* F3 — coupon percent với max_discount NULL và subtotal lớn */
  console.log('\n--- F3: coupon 100% (miễn phí) ---');
  {
    const code = 'RCH' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 100, minSubtotal: 0, usageLimit: 5, active: true },
    });
    created.coupons.push(cr.data?.id);
    const { u, id } = await newUser('f3');
    const o = await u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    });
    rec('F3', 'coupon 100% -> đơn total=0',
      'chặn tạo đơn total = 0 (không thể mua miễn phí)',
      `HTTP=${o.status} ${o.data?.code || ''} total=${o.data?.order?.total}`,
      o.status !== 201,
      o.status === 201 ? 'mã 100% tạo được đơn 0đ -> pay đơn 0đ sẽ giao license MIỄN PHÍ' : '');
    if (o.status === 201) {
      created.orders.push(o.data.order.id);
      const pay = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      rec('F3b', 'trả đơn 0đ', 'không giao hàng khi total=0',
        `HTTP=${pay.status}, giao ${pay.data?.order?.delivered?.[0]?.keys?.length || 0} license, status=${pay.data?.order?.status}`,
        false, pay.status === 200 ? 'LẤY ĐƯỢC LICENSE MIỄN PHÍ BẰNG COUPON 100%' : '');
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
  console.log('Dữ liệu test:', JSON.stringify(created));
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
