/**
 * race-test.mjs — Kiểm thử race condition THẬT trên production https://xienhl.com
 *
 * Yêu cầu: admin namhbcf/namhbcf123, user demo/Demo@123456
 * Chiến lược: tạo user test riêng, nạp tiền bằng admin adjust, rồi bắn request đồng thời.
 * Mọi thay đổi được liệt kê ở cuối để dọn dẹp.
 */
const B = 'https://xienhl.com';
const ADMIN = { email: 'namhbcf', password: 'namhbcf123' };

let pass = 0, fail = 0, warn = 0;
const rows = [];
function rec(id, name, expect, actual, ok, extra) {
  rows.push({ id, name, expect, actual, ok: ok === true ? 'ĐÚNG' : (ok === 'warn' ? 'CẢNH BÁO' : 'SAI'), extra: extra || '' });
  if (ok === true) pass++; else if (ok === 'warn') warn++; else fail++;
  const mark = ok === true ? 'OK  ' : (ok === 'warn' ? 'WARN' : 'FAIL');
  console.log(`[${mark}] #${id} ${name}\n        kỳ vọng: ${expect}\n        thực tế : ${actual}${extra ? '\n        ' + extra : ''}`);
}

/* ---------- HTTP client có cookie ---------- */
function mk() {
  let cookie = null;
  return {
    async req(p, o = {}) {
      const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (cookie) h.Cookie = cookie;
      const r = await fetch(B + p, {
        method: o.method || 'GET',
        headers: { ...h, ...(o.headers || {}) },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
      const sc = r.headers.get('set-cookie');
      if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) cookie = m[0]; }
      let d = null; try { d = await r.json(); } catch {}
      return { status: r.status, data: d };
    },
    get cookie() { return cookie; },
  };
}

/** Bắn N request đồng thời, trả mảng kết quả. Dùng Promise.all trên cùng 1 tick. */
async function burst(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

const created = { users: [], orders: [], topups: [] };

async function main() {
  console.log('\n== RACE CONDITION TEST — production xienhl.com ==');
  const admin = mk();
  const al = await admin.req('/api/auth/login', { method: 'POST', body: ADMIN });
  if (al.status !== 200) throw new Error('admin login fail ' + al.status);
  console.log('admin OK, balance=', al.data.user.balance);

  /* =========================================================
     Dựng user test
     ========================================================= */
  async function newUser(tag) {
    const u = mk();
    const email = `${tag}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.vn`;
    const r = await u.req('/api/auth/register', {
      method: 'POST', body: { email, password: 'Test123456', fullName: 'Race ' + tag },
    });
    if (r.status !== 201) throw new Error(`register ${tag} fail ${r.status} ${JSON.stringify(r.data)}`);
    created.users.push({ email, id: r.data.user.id });
    return { u, id: r.data.user.id, email };
  }
  async function fund(userId, amount, reason) {
    const r = await admin.req('/api/admin/wallet/adjust', {
      method: 'POST', body: { userId, amount, reason: reason || 'race-test funding' },
    });
    if (r.status !== 200) throw new Error('fund fail ' + r.status + ' ' + JSON.stringify(r.data));
    return r.data.balance;
  }
  async function bal(u) {
    const r = await u.req('/api/auth/me');
    return r.data?.user?.balance;
  }

  // Sản phẩm license (kho vô hạn) để tránh OUT_OF_STOCK che lấp kết quả
  const prods = await admin.req('/api/products?perPage=100');
  const licWeek = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');
  const licMonth = prods.data.products.find((p) => p.slug === 'license-xarena-thang');
  if (!licWeek) throw new Error('không thấy sản phẩm license-xarena-tuan');
  console.log('sản phẩm test:', licWeek.name, licWeek.price, 'đ |', licMonth?.name, licMonth?.price);

  async function makeOrder(u, qty = 1, prod = licWeek) {
    const r = await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: prod.id, quantity: qty }] } });
    if (r.status !== 201) throw new Error('createOrder fail ' + r.status + ' ' + JSON.stringify(r.data));
    created.orders.push(r.data.order.id);
    return r.data.order;
  }

  /* =========================================================
     #8 — 2 request /pay ĐỒNG THỜI cùng 1 đơn
     ========================================================= */
  console.log('\n--- #8: 2 request pay đồng thời ---');
  {
    const { u, id } = await newUser('r8');
    await fund(id, 500000, 'race8');
    const o = await makeOrder(u);
    const before = await bal(u);
    const res = await burst(2, () => u.req(`/api/orders/${o.id}/pay`, { method: 'POST' }));
    const after = await bal(u);
    const okCount = res.filter((r) => r.status === 200).length;
    const debited = before - after;
    const licCount = res.filter((r) => r.status === 200)
      .reduce((s, r) => s + (r.data?.order?.delivered?.[0]?.keys?.length || 0), 0);
    rec(8, '2 pay cùng lúc 1 đơn',
      `1 thành công, trừ đúng ${o.total}đ, giao 1 license`,
      `ok=${okCount}/2, trừ=${debited}đ, license=${licCount}`,
      okCount === 1 && debited === o.total && licCount === 1,
      `trạng thái HTTP: ${res.map((r) => r.status).join(',')}`);
  }

  /* =========================================================
     #9 — 5 request /pay ĐỒNG THỜI
     ========================================================= */
  console.log('\n--- #9: 5 request pay đồng thời ---');
  {
    const { u, id } = await newUser('r9');
    await fund(id, 2000000, 'race9');
    const o = await makeOrder(u);
    const before = await bal(u);
    const res = await burst(5, () => u.req(`/api/orders/${o.id}/pay`, { method: 'POST' }));
    const after = await bal(u);
    const okCount = res.filter((r) => r.status === 200).length;
    const debited = before - after;
    const licCount = res.filter((r) => r.status === 200)
      .reduce((s, r) => s + (r.data?.order?.delivered?.[0]?.keys?.length || 0), 0);
    rec(9, '5 pay cùng lúc 1 đơn',
      `1 thành công, trừ đúng ${o.total}đ, giao 1 license`,
      `ok=${okCount}/5, trừ=${debited}đ, license=${licCount}`,
      okCount === 1 && debited === o.total && licCount === 1,
      `HTTP: ${res.map((r) => r.status).join(',')} | mã lỗi: ${res.filter(r=>r.status!==200).map(r=>r.data?.code).join(',')}`);
  }

  /* =========================================================
     #10 — 2 request /admin/orders/:id/refund ĐỒNG THỜI
     ========================================================= */
  console.log('\n--- #10: 2 admin refund đồng thời ---');
  {
    const { u, id } = await newUser('r10');
    await fund(id, 500000, 'race10');
    const o = await makeOrder(u);
    await u.req(`/api/orders/${o.id}/pay`, { method: 'POST' });
    const before = await bal(u);
    const res = await burst(2, () => admin.req(`/api/admin/orders/${o.id}/refund`, { method: 'POST' }));
    const after = await bal(u);
    const okCount = res.filter((r) => r.status === 200).length;
    const credited = after - before;
    rec(10, '2 refund cùng lúc 1 đơn',
      `1 thành công, cộng đúng ${o.total}đ`,
      `ok=${okCount}/2, cộng=${credited}đ`,
      okCount === 1 && credited === o.total,
      `HTTP: ${res.map((r) => r.status).join(',')} | mã: ${res.map(r=>r.data?.code||'ok').join(',')}`);
  }

  /* =========================================================
     #11 — 2 request /admin/topups/:id/approve ĐỒNG THỜI
     ========================================================= */
  console.log('\n--- #11: 2 admin approve topup đồng thời ---');
  {
    const { u, id } = await newUser('r11');
    const t = await u.req('/api/wallet/topup', { method: 'POST', body: { amount: 100000 } });
    if (t.status !== 201) throw new Error('topup fail ' + JSON.stringify(t.data));
    created.topups.push(t.data.topup.id);
    const before = await bal(u);
    const res = await burst(2, () => admin.req(`/api/admin/topups/${t.data.topup.id}/approve`, { method: 'POST' }));
    const after = await bal(u);
    const okCount = res.filter((r) => r.status === 200).length;
    const credited = after - before;
    rec(11, '2 approve topup cùng lúc',
      `1 thành công, cộng đúng 100000đ`,
      `ok=${okCount}/2, cộng=${credited}đ`,
      okCount === 1 && credited === 100000,
      `HTTP: ${res.map((r) => r.status).join(',')} | mã: ${res.map(r=>r.data?.code||'ok').join(',')}`);
  }

  /* =========================================================
     #12 — 2 request /wallet/topup ĐỒNG THỜI (cùng user, cùng số tiền)
     ========================================================= */
  console.log('\n--- #12: 2 createTopup đồng thời ---');
  {
    const { u } = await newUser('r12');
    const res = await burst(2, () => u.req('/api/wallet/topup', { method: 'POST', body: { amount: 50000 } }));
    const ids = res.map((r) => r.data?.topup?.id).filter(Boolean);
    const codes = res.map((r) => r.data?.topup?.code).filter(Boolean);
    const uniqId = new Set(ids).size, uniqCode = new Set(codes).size;
    const list = await u.req('/api/wallet?perPage=50');
    const pend = (list.data?.transactions || []).length;
    rec(12, '2 createTopup cùng lúc',
      'Tạo 2 lệnh nạp riêng biệt (mã khác nhau) — không gộp, không trùng mã',
      `HTTP=${res.map(r=>r.status).join(',')}, id riêng=${uniqId}, code riêng=${uniqCode}`,
      ids.length === 2 && uniqId === 2 && uniqCode === 2,
      `code: ${codes.join(' / ')}`);
    // kiểm tra trùng mã với topup cũ trong DB (qua admin list)
    const d = await admin.req('/api/admin/topups?status=pending');
    const all = (d.data?.topups || []).map((x) => x.code);
    rec(12.1, 'mã NAP không trùng trong bảng topups',
      'tất cả code duy nhất', `${all.length} topup pending, ${new Set(all).size} code duy nhất`,
      all.length === new Set(all).size);
  }

  /* =========================================================
     #13 — 2 request /trial/start ĐỒNG THỜI cùng HWID
     ========================================================= */
  console.log('\n--- #13: 2 trial/start đồng thời cùng HWID ---');
  {
    const hwidParts = {
      guid: 'race13-' + Date.now().toString(36),
      bios: 'American Megatrends Inc.',
      cpu: 'Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz',
      vol: 'AAAA-BBBB',
      app: 'XArena No Fog', ver: '1.0',
    };
    const res = await burst(2, () => fetch(B + '/api/trial/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hwidParts),
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) })));
    const keys = res.map((r) => r.data?.key).filter(Boolean);
    const oks = res.filter((r) => r.status === 200 && r.data?.ok);
    const uniqKey = new Set(keys).size;
    rec(13, '2 trial/start cùng HWID',
      'chỉ 1 trial được tạo — cả 2 trả cùng 1 key (hoặc 1 bị chặn)',
      `ok=${oks.length}/2, key duy nhất=${uniqKey}, key=${keys.join(' / ')}`,
      uniqKey <= 1,
      `kind: ${res.map(r=>r.data?.trial_kind||r.data?.code).join(',')}`);
  }

  /* =========================================================
     #14 — 10 request TẠO ĐƠN ĐỒNG THỜI khi ví chỉ đủ 1 đơn
     ========================================================= */
  console.log('\n--- #14a: 10 tạo đơn đồng thời, ví đủ 1 đơn ---');
  {
    const { u, id } = await newUser('r14');
    await fund(id, licWeek.price, 'race14'); // đủ đúng 1 đơn
    const before = await bal(u);
    const res = await burst(10, () => u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }] },
    }));
    const createdOk = res.filter((r) => r.status === 201);
    createdOk.forEach((r) => created.orders.push(r.data.order.id));
    const after = await bal(u);
    rec('14a', '10 createOrder đồng thời',
      'Tạo đơn KHÔNG trừ tiền → cả 10 đều tạo được (pending), số dư không đổi',
      `tạo được ${createdOk.length}/10, số dư ${before}→${after}`,
      createdOk.length === 10 && before === after,
      `HTTP: ${[...new Set(res.map(r=>r.status))].join(',')}`);

    // #14b — trả tiền cả 10 đơn ĐỒNG THỜI, ví chỉ đủ 1
    console.log('\n--- #14b: trả tiền 10 đơn đó ĐỒNG THỜI ---');
    const ids = createdOk.map((r) => r.data.order.id);
    const payRes = await Promise.all(ids.map((oid) => u.req(`/api/orders/${oid}/pay`, { method: 'POST' })));
    const paid = payRes.filter((r) => r.status === 200);
    const after2 = await bal(u);
    const spent = after - after2;
    const licCount = paid.reduce((s, r) => s + (r.data?.order?.delivered?.[0]?.keys?.length || 0), 0);
    rec('14b', '10 pay đồng thời, ví đủ 1 đơn',
      `bán được đúng 1 đơn, trừ ${licWeek.price}đ, giao 1 license`,
      `bán được ${paid.length} đơn, trừ ${spent}đ, license ${licCount}`,
      paid.length === 1 && spent === licWeek.price && licCount === 1,
      `HTTP: ${payRes.map(r=>r.status).join(',')}`);
  }

  /* =========================================================
     #15 — 2 telegram webhook duyệt cùng topup
     (không có TG_WEBHOOK_SECRET nên ghi nhận giới hạn)
     ========================================================= */
  console.log('\n--- #15: 2 telegram/webhook duyệt cùng topup ---');
  {
    const r = await fetch(B + '/api/telegram/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'guess' },
      body: JSON.stringify({ callback_query: { id: '1', data: 'tp:ok:x', from: { id: 1 }, message: { chat: { id: 1 } } } }),
    });
    const d = await r.json().catch(() => null);
    rec(15, '2 telegram/webhook duyệt cùng topup',
      '1 duyệt thành công, 1 báo đã duyệt (nhờ UPDATE ... WHERE status!=\'paid\')',
      `KHÔNG TEST ĐƯỢC qua HTTP: thiếu TG_WEBHOOK_SECRET (trả ${r.status} ${d?.code || ''})`,
      'warn',
      'Sẽ kiểm chứng bằng harness local (wrangler.audit.toml có secret test)');
  }

  /* =========================================================
     Phụ — lộ trình tiền: partial topup rồi approve
     ========================================================= */
  console.log('\n--- #P1: approve một topup đã partial (cộng trùng?) ---');

  console.log('\n' + '═'.repeat(78));
  console.log(`KẾT QUẢ: ${pass} ĐÚNG | ${warn} CẢNH BÁO | ${fail} SAI`);
  console.log('═'.repeat(78));
  console.log('\n--- Dữ liệu test đã tạo (cần dọn) ---');
  console.log(JSON.stringify(created, null, 1));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
