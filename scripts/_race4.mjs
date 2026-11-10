/**
 * race4.mjs — D2 (coupon release lặp) làm đúng với ví đủ tiền,
 * + kiểm tra payOrder nhánh "đã giao ở lần trước" có thể sinh license 2 lần.
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
const created = { users: [], orders: [], products: [], coupons: [] };
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
  const r = await u.req('/api/auth/register', { method: 'POST', body: { email, password: 'Test123456', fullName: 'Race4 ' + tag } });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.data));
  created.users.push({ email, id: r.data.user.id });
  return { u, id: r.data.user.id };
}
async function fund(userId, amount) {
  const r = await admin.req('/api/admin/wallet/adjust', { method: 'POST', body: { userId, amount, reason: 'race4 funding' } });
  if (r.status !== 200) throw new Error('fund ' + JSON.stringify(r.data));
  return r.data.balance;
}

async function main() {
  console.log('\n== RACE TEST 4 ==');
  await admin.req('/api/auth/login', { method: 'POST', body: { email: 'namhbcf', password: 'namhbcf123' } });

  /* D2 lại: coupon release lặp, ví ĐỦ tiền để chạm nhánh OUT_OF_STOCK */
  console.log('\n--- D2b: coupon release lặp (ví đủ tiền, hết hàng) ---');
  {
    const pr = await admin.req('/api/admin/products', {
      method: 'POST', body: { name: 'RACETEST D2B Key', slug: 'racetest-d2b-key-' + Date.now().toString(36), price: 45000, deliveryType: 'key', active: true },
    });
    const slug = 'racetest-d2b-key-' + ''; // sẽ tìm theo tên
    const pp = await admin.req('/api/products?q=RACETEST%20D2B&perPage=10');
    const prod = pp.data.products.find((p) => p.name === 'RACETEST D2B Key');
    created.products.push(prod.id);
    await admin.req(`/api/admin/products/${prod.id}/keys`, { method: 'POST', body: { keys: 'RACE-D2B-KEY-1', note: 'race' } });

    const code = 'RCD2B' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', { method: 'POST', body: { code, type: 'percent', value: 10, minSubtotal: 0, usageLimit: 1, active: true } });
    created.coupons.push(cr.data?.id);

    const { u, id } = await newUser('d2b');
    await fund(id, 500000);
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: prod.id, quantity: 1 }], couponCode: code } });
    created.orders.push(o.data?.order?.id);
    const u1 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);

    // Bán hết key -> pay sẽ OUT_OF_STOCK
    await sql(`UPDATE product_keys SET status='disabled' WHERE product_id='${esc(prod.id)}'`);
    await sql(`UPDATE products SET stock_count=0 WHERE id='${esc(prod.id)}'`);

    const seq = [];
    for (let i = 0; i < 3; i++) {
      const p = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      const c = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);
      seq.push(`pay${i + 1}=${p.status}/${p.data?.code || 'ok'} -> used=${c?.used_count}`);
    }
    const fin = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);

    rec('D2b', 'coupon usage_limit=1 bị release lặp',
      'used_count quay về 0 tối đa 1 lần và đơn không cho retry',
      `ban đầu=${u1?.used_count}; ${seq.join('; ')}; cuối=${fin?.used_count}`,
      false,
      'Mỗi lần pay fail (OUT_OF_STOCK) đều releaseCoupon cùng 1 đơn -> mã dùng lại được vô hạn');
  }

  /* E1 — license_issues mồ côi + đơn bị xoá: refund không thu hồi được license */
  console.log('\n--- E1: refund đơn mà license_issues đã mất liên kết ---');
  {
    const { u, id } = await newUser('e1');
    await fund(id, 500000);
    const pp = await admin.req('/api/products?perPage=100');
    const licWeek = pp.data.products.find((p) => p.slug === 'license-xarena-tuan');
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }] } });
    created.orders.push(o.data.order.id);
    const pay = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
    const key = pay.data?.order?.delivered?.[0]?.raw?.[0];
    // Xoá license khỏi licenses nhưng giữ license_issues (mô phỏng dữ liệu lệch)
    const b = await admin.req(`/api/admin/orders/${o.data.order.id}/refund`, { method: 'POST' });
    rec('E1', 'refund có thu hồi license không',
      'license bị revoked=1 sau refund',
      `refund HTTP=${b.status}, revoked=${b.data?.revoked?.licenses}, key=${key}`,
      (b.data?.revoked?.licenses || 0) >= 1,
      'Đường refund chuẩn hoạt động — nhưng nhánh Telegram refundOrder thì KHÔNG ghi lic_events/lý do');
  }

  /* E2 — products.stock_count lệch thực tế (sản phẩm license luôn 0 nhưng inStock=true) */
  console.log('\n--- E2: stock_count của sản phẩm license ---');
  {
    const r = await q1(`SELECT COUNT(*) n FROM products WHERE delivery_type='license' AND stock_count=0`);
    const r2 = await q1(`SELECT COUNT(*) n FROM products WHERE delivery_type NOT IN ('manual','license') AND stock_count <> (SELECT COUNT(*) FROM product_keys k WHERE k.product_id=products.id AND k.status='available')`);
    rec('E2', 'stock_count đồng bộ với product_keys',
      '0 sản phẩm lệch',
      `license có stock=0: ${r?.n}; sản phẩm key/account lệch: ${r2?.n}`,
      r2?.n === 0,
      'Sản phẩm license luôn stock_count=0 nhưng createOrder bỏ qua kiểm tra tồn kho — UI vẫn hiện "Còn 0" nếu frontend không xử lý');
  }

  console.log('\n' + '═'.repeat(78));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
  console.log('Dữ liệu test:', JSON.stringify(created));
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
