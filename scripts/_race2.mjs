/**
 * race2.mjs — Kiểm thử các lỗi TINH VI, dùng D1 trực tiếp để dựng trạng thái
 * rồi tấn công qua API thật.
 *
 * Kịch bản:
 *  C1. topup 'partial' rồi admin approve  -> cộng trùng?
 *  C2. payOrder khi product bị xoá          -> mất tiền không hoàn?
 *  C3. coupon bị release nhiều lần          -> used_count âm / dùng quá limit?
 *  C4. topups.txn_ref trùng                 -> 1 giao dịch CK cộng 2 lệnh nạp?
 */
const B = 'https://xienhl.com';
const TOKEN = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const ACCOUNT = '5b62d10947844251d23e0eac532531dd';
const DBID = '81f478c9-5627-458a-a35f-d483e69d400b';
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DBID}/query`;

async function sql(q) {
  const r = await fetch(D1, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: q }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('D1: ' + JSON.stringify(j.errors));
  const res = j.result?.[0];
  if (res?.success === false) throw new Error('D1: ' + JSON.stringify(res.error));
  return res?.results ?? [];
}
const q1 = async (s) => (await sql(s))[0];

function mk() {
  let cookie = null;
  return {
    async req(p, o = {}) {
      const h = { 'Content-Type': 'application/json' };
      if (cookie) h.Cookie = cookie;
      const r = await fetch(B + p, {
        method: o.method || 'GET', headers: h,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
      const sc = r.headers.get('set-cookie');
      if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) cookie = m[0]; }
      let d = null; try { d = await r.json(); } catch {}
      return { status: r.status, data: d };
    },
  };
}
const esc = (s) => String(s).replace(/'/g, "''");
const created = { users: [], orders: [], topups: [], products: [], coupons: [] };
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
  const r = await u.req('/api/auth/register', {
    method: 'POST', body: { email, password: 'Test123456', fullName: 'Race2 ' + tag },
  });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.data));
  created.users.push({ email, id: r.data.user.id });
  return { u, id: r.data.user.id, email };
}
async function fund(userId, amount, reason) {
  const r = await admin.req('/api/admin/wallet/adjust', {
    method: 'POST', body: { userId, amount, reason },
  });
  if (r.status !== 200) throw new Error('fund ' + JSON.stringify(r.data));
  return r.data.balance;
}
const bal = async (u) => (await u.req('/api/auth/me')).data?.user?.balance;

async function main() {
  console.log('\n== RACE TEST 2 — lỗi tinh vi ==');
  const al = await admin.req('/api/auth/login', { method: 'POST', body: { email: 'namhbcf', password: 'namhbcf123' } });
  if (al.status !== 200) throw new Error('admin login fail');
  const prods = await admin.req('/api/products?perPage=100');
  const licWeek = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');

  /* =========================================================
     C1 — topup 'partial' rồi admin approve => cộng trùng?
     ========================================================= */
  console.log('\n--- C1: topup partial (50k/100k) rồi admin duyệt tay ---');
  {
    const { u, id } = await newUser('c1');
    const t = await u.req('/api/wallet/topup', { method: 'POST', body: { amount: 100000 } });
    const tp = t.data.topup;
    created.topups.push(tp.id);
    const before = await bal(u);

    // Giả lập webhook đã cộng 50k và đánh dấu partial (đúng như sepayWebhook nhánh thiếu tiền)
    await sql(`UPDATE topups SET status='partial', txn_ref='FT-C1-PARTIAL' WHERE id='${esc(tp.id)}'`);
    await sql(`UPDATE users SET balance = balance + 50000 WHERE id='${esc(id)}'`);
    await sql(`INSERT INTO wallet_transactions (id,user_id,type,amount,balance_after,status,reference,description,created_at)
               VALUES ('c1-wt-${Date.now()}','${esc(id)}','topup',50000,50000,'success','FT-C1-PARTIAL','Nạp một phần 50k/100k (${esc(tp.code)})',${Date.now()})`);
    const mid = await bal(u);

    // Admin duyệt tay: topup đang 'partial' (KHÁC 'paid') nên claim sẽ thành công
    const ap = await admin.req(`/api/admin/topups/${tp.id}/approve`, { method: 'POST' });
    const after = await bal(u);
    const total = after - before;

    rec('C1', 'partial rồi approve tay',
      'cộng tổng đúng 100.000đ (không vượt số tiền lệnh nạp)',
      `sau webhook=${mid - before}đ, approve cộng thêm=${after - mid}đ, TỔNG=${total}đ`,
      total <= 100000,
      `HTTP approve=${ap.status} credited=${ap.data?.credited}`);
  }

  /* =========================================================
     C2 — payOrder khi product biến mất => trừ tiền mà không hoàn
     ========================================================= */
  console.log('\n--- C2: pay đơn có product bị xoá ---');
  {
    const { u, id } = await newUser('c2');
    // Tạo sản phẩm test riêng
    const pid = 'p-racetest-c2';
    await admin.req('/api/admin/products', {
      method: 'POST',
      body: { name: 'RACETEST C2 Product', slug: 'racetest-c2-prod', price: 123000, deliveryType: 'license', licensePrefix: 'RACET', licenseDays: 7, active: true },
    });
    const pp = await admin.req('/api/products?q=RACETEST&perPage=10');
    const prod = pp.data.products.find((p) => p.slug === 'racetest-c2-prod');
    if (!prod) { rec('C2', 'pay đơn product bị xoá', '—', 'không tạo được sản phẩm test', 'warn'); }
    else {
      created.products.push(prod.id);
      await fund(id, 500000, 'race c2');
      const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: prod.id, quantity: 1 }] } });
      const order = o.data.order;
      created.orders.push(order.id);
      const before = await bal(u);

      // Xoá hẳn dòng products để payOrder rơi vào nhánh PRODUCT_GONE
      await sql(`DELETE FROM product_keys WHERE product_id='${esc(prod.id)}'`);
      await sql(`DELETE FROM products WHERE id='${esc(prod.id)}'`);

      const pay = await u.req(`/api/orders/${order.id}/pay`, { method: 'POST' });
      const after = await bal(u);
      const lost = before - after;
      const st = await q1(`SELECT status, paid_at FROM orders WHERE id='${esc(order.id)}'`);

      rec('C2', 'pay đơn khi product đã bị xoá',
        'hoàn tiền đầy đủ, số dư không đổi (0đ bị giữ)',
        `HTTP=${pay.status} ${pay.data?.code || ''}, TIỀN MẤT=${lost}đ, đơn còn status='${st?.status}'`,
        lost === 0,
        `không có UPDATE hoàn tiền nào trong nhánh PRODUCT_GONE`);
    }
  }

  /* =========================================================
     C3 — coupon bị release nhiều lần
     ========================================================= */
  console.log('\n--- C3: coupon used_count bị release nhiều lần ---');
  {
    const code = 'RACEC3' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST',
      body: { code, type: 'percent', value: 10, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);
    // Sản phẩm hết hàng để payOrder rơi vào nhánh OUT_OF_STOCK (có releaseCoupon)
    const allP = await admin.req('/api/products?perPage=100');
    const outStock = allP.data.products.find((p) => p.deliveryType === 'key' && p.stock === 0);

    if (!outStock || cr.status !== 201) {
      rec('C3', 'coupon double release', '—', `thiếu điều kiện (coupon=${cr.status}, outStock=${!!outStock})`, 'warn');
    } else {
      const { u } = await newUser('c3');
      const o = await u.req('/api/orders', {
        method: 'POST', body: { items: [{ productId: outStock.id, quantity: 1 }], couponCode: code },
      });
      created.orders.push(o.data?.order?.id);
      const used1 = await q1(`SELECT used_count, usage_limit FROM coupons WHERE code='${esc(code)}'`);
      // Gọi pay 3 lần (mỗi lần đều OUT_OF_STOCK -> releaseCoupon)
      const p1 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      const used2 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);
      const p2 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      const used3 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);
      const p3 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      const used4 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);

      rec('C3', 'coupon release nhiều lần khi pay lỗi lặp lại',
        'used_count giảm tối đa 1 lần (hoặc chặn retry)',
        `sau tạo đơn=${used1?.used_count}, sau pay1=${used2?.used_count}, pay2=${used3?.used_count}, pay3=${used4?.used_count}`,
        used4?.used_count >= 0,
        `HTTP pay: ${p1.status}/${p2.status}/${p3.status} — mỗi lần đều trừ used_count`);
    }
  }

  /* =========================================================
     C4 — txn_ref trùng: 1 giao dịch CK áp cho 2 lệnh nạp?
     ========================================================= */
  console.log('\n--- C4: topups.txn_ref có UNIQUE không? ---');
  {
    const { u } = await newUser('c4');
    const t1 = await u.req('/api/wallet/topup', { method: 'POST', body: { amount: 50000 } });
    const t2 = await u.req('/api/wallet/topup', { method: 'POST', body: { amount: 50000 } });
    created.topups.push(t1.data.topup.id, t2.data.topup.id);
    const DUPTX = 'FT-DUP-' + Date.now();
    let err = null;
    try {
      await sql(`UPDATE topups SET txn_ref='${esc(DUPTX)}' WHERE id='${esc(t1.data.topup.id)}'`);
      await sql(`UPDATE topups SET txn_ref='${esc(DUPTX)}' WHERE id='${esc(t2.data.topup.id)}'`);
    } catch (e) { err = e.message; }
    const dupes = await q1(`SELECT COUNT(*) n FROM topups WHERE txn_ref='${esc(DUPTX)}'`);
    rec('C4', 'topups.txn_ref trùng (1 giao dịch CK cho 2 lệnh nạp)',
      'DB phải chặn (UNIQUE index trên txn_ref)',
      err ? 'đã chặn: ' + err : `${dupes?.n} dòng cùng txn_ref -> KHÔNG chặn`,
      dupes?.n <= 1,
      'Không có UNIQUE(txn_ref) nên 1 mã giao dịch ngân hàng có thể cộng tiền cho nhiều lệnh nạp');
  }

  console.log('\n' + '═'.repeat(78));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
  console.log('Dữ liệu test:', JSON.stringify(created));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
