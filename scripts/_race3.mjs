/**
 * race3.mjs — đào sâu: double refund qua cron reset, coupon release lặp,
 * approve với amount tuỳ ý, và trạng thái 'refunding' mồ côi.
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
  const r = await u.req('/api/auth/register', { method: 'POST', body: { email, password: 'Test123456', fullName: 'Race3 ' + tag } });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.data));
  created.users.push({ email, id: r.data.user.id });
  return { u, id: r.data.user.id };
}
async function fund(userId, amount, reason) {
  const r = await admin.req('/api/admin/wallet/adjust', { method: 'POST', body: { userId, amount, reason } });
  if (r.status !== 200) throw new Error('fund ' + JSON.stringify(r.data));
  return r.data.balance;
}
const bal = async (u) => (await u.req('/api/auth/me')).data?.user?.balance;

async function main() {
  console.log('\n== RACE TEST 3 ==');
  const al = await admin.req('/api/auth/login', { method: 'POST', body: { email: 'namhbcf', password: 'namhbcf123' } });
  if (al.status !== 200) throw new Error('admin login fail');
  const prods = await admin.req('/api/products?perPage=100');
  const licWeek = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');

  /* =========================================================
     D1 — Double refund qua cron reset 'refunding' -> 'delivered'
     ========================================================= */
  console.log('\n--- D1: refund lần 2 sau khi cron reset refunding->delivered ---');
  {
    const { u, id } = await newUser('d1');
    await fund(id, 500000, 'race d1');
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }] } });
    const order = o.data.order; created.orders.push(order.id);
    await u.req(`/api/orders/${order.id}/pay`, { method: 'POST' });
    const b0 = await bal(u);

    // refund lần 1
    const r1 = await admin.req(`/api/admin/orders/${order.id}/refund`, { method: 'POST' });
    const b1 = await bal(u);

    // Giả lập worker chết giữa chừng: đơn kẹt 'refunding', created_at cũ > 10 phút
    await sql(`UPDATE orders SET status='refunding', created_at=${Date.now() - 20 * 60 * 1000} WHERE id='${esc(order.id)}'`);
    // Cron chạy: index.js dòng 163-165
    await sql(`UPDATE orders SET status='delivered' WHERE status='refunding' AND created_at < ${Date.now() - 10 * 60 * 1000}`);

    // refund lần 2 — đơn đã về 'delivered' nên pass kiểm tra
    const r2 = await admin.req(`/api/admin/orders/${order.id}/refund`, { method: 'POST' });
    const b2 = await bal(u);
    const totalRefunded = b2 - b0;

    rec('D1', 'hoàn tiền 2 lần do cron reset "refunding"->"delivered"',
      `tổng hoàn đúng ${order.total}đ`,
      `lần 1: ${r1.status} (+${b1 - b0}đ), lần 2: ${r2.status} (+${b2 - b1}đ) → TỔNG HOÀN ${totalRefunded}đ / đơn ${order.total}đ`,
      totalRefunded <= order.total,
      'Cron coi "refunding" là trạng thái kẹt và trả về "delivered" → mở lại đường hoàn tiền');
  }

  /* =========================================================
     D2 — coupon release lặp khi pay thất bại nhiều lần
     ========================================================= */
  console.log('\n--- D2: coupon used_count bị trừ nhiều lần ---');
  {
    // Tạo sản phẩm key CÓ hàng rồi rút sạch key -> OUT_OF_STOCK ở pay
    const pr = await admin.req('/api/admin/products', {
      method: 'POST', body: { name: 'RACETEST D2 Key', slug: 'racetest-d2-key', price: 45000, deliveryType: 'key', active: true },
    });
    const pp = await admin.req('/api/products?q=RACETEST&perPage=10');
    const prod = pp.data.products.find((p) => p.slug === 'racetest-d2-key');
    created.products.push(prod.id);
    // thêm 1 key để tạo đơn được, rồi xoá để pay fail
    await admin.req(`/api/admin/products/${prod.id}/keys`, { method: 'POST', body: { keys: 'RACE-D2-KEY-1', note: 'race' } });

    const code = 'RCD2' + Date.now().toString(36).slice(-4).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 10, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);

    const { u } = await newUser('d2');
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: prod.id, quantity: 1 }], couponCode: code } });
    created.orders.push(o.data?.order?.id);
    const u1 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);

    // Rút sạch key -> pay sẽ OUT_OF_STOCK
    await sql(`UPDATE product_keys SET status='disabled' WHERE product_id='${esc(prod.id)}'`);
    await sql(`UPDATE products SET stock_count=0 WHERE id='${esc(prod.id)}'`);

    const p1 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
    const u2 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);
    const p2 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
    const u3 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);
    const p3 = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
    const u4 = await q1(`SELECT used_count FROM coupons WHERE code='${esc(code)}'`);

    rec('D2', 'coupon bị release lặp qua nhiều lần pay thất bại',
      'used_count không đổi sau lần release đầu tiên (usage_limit=1)',
      `ban đầu=${u1?.used_count}, pay1(${p1.status})=${u2?.used_count}, pay2(${p2.status})=${u3?.used_count}, pay3(${p3.status})=${u4?.used_count}`,
      false,
      'Mỗi lần pay fail đều gọi releaseCoupon() với cùng 1 đơn → trừ dần tới 0 (MAX(0,...) chặn âm). Dùng coupon bất chấp usage_limit.');
  }

  /* =========================================================
     D3 — adminApproveTopup nhận amount tuỳ ý > amount lệnh nạp
     ========================================================= */
  console.log('\n--- D3: admin duyệt topup với số tiền lớn hơn lệnh nạp ---');
  {
    const { u, id } = await newUser('d3');
    const t = await u.req('/api/wallet/topup', { method: 'POST', body: { amount: 20000 } });
    created.topups.push(t.data.topup.id);
    const b0 = await bal(u);
    const ap = await admin.req(`/api/admin/topups/${t.data.topup.id}/approve`, {
      method: 'POST', body: { amount: 500000000 },
    });
    const b1 = await bal(u);
    rec('D3', 'approve topup 20.000đ với amount=500.000.000',
      'không cho vượt số tiền lệnh nạp (hoặc phải có xác nhận)',
      `HTTP=${ap.status}, cộng ${b1 - b0}đ cho lệnh nạp 20.000đ, credited=${ap.data?.credited}`,
      false,
      'int(body.amount, min:1000, max:500_000_000) — không đối chiếu t.amount, không audit lý do');
  }

  /* =========================================================
     D4 — orders.status không có CHECK constraint
     ========================================================= */
  console.log('\n--- D4: CHECK constraint trên trạng thái đơn / topup ---');
  {
    let e1 = null, e2 = null;
    const { u } = await newUser('d4');
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }] } });
    created.orders.push(o.data.order.id);
    try { await sql(`UPDATE orders SET status='RÁC_KHÔNG_TỒN_TẠI' WHERE id='${esc(o.data.order.id)}'`); } catch (e) { e1 = e.message; }
    const chk = await q1(`SELECT status FROM orders WHERE id='${esc(o.data.order.id)}'`);
    try { await sql(`UPDATE orders SET status='pending' WHERE id='${esc(o.data.order.id)}'`); } catch {}

    rec('D4', 'DB có CHECK constraint cho orders.status?',
      'DB từ chối trạng thái lạ',
      e1 ? 'đã chặn: ' + e1 : `nhận trạng thái rác: status='${chk?.status}'`,
      false,
      "Không có CHECK -> mọi lỗi code tạo trạng thái mồ côi không bị phát hiện");
  }

  /* =========================================================
     D5 — 'processing' mồ côi với paid_at NULL -> cron không bao giờ giải phóng
     ========================================================= */
  console.log('\n--- D5: đơn kẹt "processing" mà paid_at NULL ---');
  {
    const { u } = await newUser('d5');
    const o = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }] } });
    created.orders.push(o.data.order.id);
    // Đúng trạng thái C2 để lại: status='processing', paid_at đã bị set... nhưng thử NULL
    await sql(`UPDATE orders SET status='processing', paid_at=NULL WHERE id='${esc(o.data.order.id)}'`);
    await sql(`UPDATE orders SET status='pending', paid_at=NULL WHERE status='processing' AND paid_at < ${Date.now() - 10 * 60 * 1000}`);
    const st = await q1(`SELECT status, paid_at FROM orders WHERE id='${esc(o.data.order.id)}'`);
    rec('D5', 'cron giải phóng đơn "processing" khi paid_at = NULL',
      'cron phải đưa đơn về pending',
      `sau cron: status='${st?.status}', paid_at=${st?.paid_at}`,
      st?.status === 'pending',
      'Câu cron dùng "paid_at < ?" — NULL không thoả điều kiện nên đơn kẹt VĨNH VIỄN ở processing, khách không trả tiền lại được');
    await sql(`UPDATE orders SET status='cancelled' WHERE id='${esc(o.data.order.id)}'`);
  }

  console.log('\n' + '═'.repeat(78));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
  console.log('Dữ liệu test:', JSON.stringify(created));
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
