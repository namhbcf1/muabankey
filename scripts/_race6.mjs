/**
 * race6.mjs — coupon race + total=0, dùng user/session tạo trực tiếp qua D1
 * để không bị rate limit đăng ký (20/giờ/IP).
 */
import { createHash, randomUUID, randomBytes } from 'node:crypto';

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
const esc = (s) => String(s).replace(/'/g, "''");
// sha256 base64 giống lib/crypto.js sha256()
const sha256b64 = (t) => createHash('sha256').update(t, 'utf8').digest('base64');

const created = { users: [], orders: [], coupons: [], products: [] };
const out = [];
function rec(id, name, expect, actual, ok, extra) {
  out.push({ id, name, expect, actual, ok });
  const m = ok === true ? 'OK  ' : ok === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${m}] ${id} ${name}\n      kỳ vọng: ${expect}\n      thực tế : ${actual}${extra ? '\n      ' + extra : ''}`);
}

/** Tạo user + session trực tiếp trong D1; trả cookie + client. */
async function mkUser(tag, balance = 0) {
  const id = randomUUID();
  const email = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}@test.vn`;
  const now = Date.now();
  await sql(`INSERT INTO users (id,email,password_hash,password_salt,full_name,phone,role,status,balance,created_at,updated_at,username)
             VALUES ('${esc(id)}','${esc(email)}','x','x','${tag}','','user','active',${balance},${now},${now},NULL)`);
  const token = randomBytes(32).toString('hex');
  await sql(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at,ip,ua)
             VALUES ('${esc(sha256b64(token))}','${esc(id)}',${now},${now + 86400000},'race','race')`);
  created.users.push({ id, email });
  const cookie = `mbk_session=${encodeURIComponent(token)}`;
  return {
    id, email,
    req(p, o = {}) {
      return fetch(B + p, {
        method: o.method || 'GET',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
    },
  };
}
function mkAdmin() {
  let c = null;
  return { async req(p, o = {}) {
    const h = { 'Content-Type': 'application/json' }; if (c) h.Cookie = c;
    const r = await fetch(B + p, { method: o.method || 'GET', headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) c = m[0]; }
    return { status: r.status, data: await r.json().catch(() => null) };
  } };
}

async function main() {
  console.log('\n== RACE TEST 6 — coupon & total=0 ==');
  const admin = mkAdmin();
  const al = await admin.req('/api/auth/login', { method: 'POST', body: { email: 'namhbcf', password: 'namhbcf123' } });
  if (al.status !== 200) throw new Error('admin login fail');
  const pp = await admin.req('/api/products?perPage=100');
  const licWeek = pp.data.products.find((p) => p.slug === 'license-xarena-tuan');
  console.log('sản phẩm:', licWeek.name, licWeek.price + 'đ');

  /* F1 — 8 user khác nhau tạo đơn đồng thời, coupon usage_limit=1 */
  console.log('\n--- F1: 8 user tạo đơn ĐỒNG THỜI, coupon usage_limit=1, giảm 50% ---');
  {
    const code = 'RCF' + Date.now().toString(36).slice(-5).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 50, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);
    const users = [];
    for (let i = 0; i < 8; i++) users.push(await mkUser('f1_' + i, 500000));
    const res = await Promise.all(users.map((x) => x.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    })));
    const okd = res.filter((r) => r.status === 201);
    okd.forEach((r) => created.orders.push(r.data.order.id));
    const used = await q1(`SELECT used_count, usage_limit FROM coupons WHERE code='${esc(code)}'`);
    const discounted = okd.filter((r) => (r.data?.order?.discount || 0) > 0).length;
    rec('F1', '8 createOrder đồng thời, coupon usage_limit=1',
      'chỉ 1 đơn áp được mã, used_count = 1',
      `tạo được ${okd.length}/8, được giảm giá ${discounted} đơn, used_count=${used?.used_count}/${used?.usage_limit}`,
      discounted <= 1 && (used?.used_count || 0) <= 1,
      `HTTP: ${res.map(r => r.status).join(',')} | lỗi: ${res.filter(r => r.status !== 201).map(r => r.data?.code).join(',')}`);
  }

  /* F2 — 1 user, 10 đơn đồng thời cùng coupon */
  console.log('\n--- F2: 1 user tạo 10 đơn ĐỒNG THỜI cùng coupon limit=1 ---');
  {
    const code = 'RCG' + Date.now().toString(36).slice(-5).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 50, minSubtotal: 0, usageLimit: 1, active: true },
    });
    created.coupons.push(cr.data?.id);
    const u = await mkUser('f2', 2000000);
    const res = await Promise.all(Array.from({ length: 10 }, () => u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    })));
    const okd = res.filter((r) => r.status === 201);
    okd.forEach((r) => created.orders.push(r.data.order.id));
    const used = await q1(`SELECT used_count, usage_limit FROM coupons WHERE code='${esc(code)}'`);
    const discounted = okd.filter((r) => (r.data?.order?.discount || 0) > 0).length;
    const lost = discounted * Math.round(licWeek.price * 0.5);
    rec('F2', '1 user 10 createOrder đồng thời, coupon limit=1',
      'chỉ 1 đơn được giảm giá',
      `tạo ${okd.length}/10, giảm giá ${discounted} đơn, used_count=${used?.used_count}/${used?.usage_limit}`,
      discounted <= 1 && (used?.used_count || 0) <= 1,
      discounted > 1 ? `THẤT THOÁT ~${lost.toLocaleString('vi-VN')}đ do mã dùng vượt lượt` : '');
  }

  /* F3 — coupon 100% -> đơn total=0 -> giao license miễn phí? */
  console.log('\n--- F3: coupon 100% tạo đơn 0đ ---');
  {
    const code = 'RCH' + Date.now().toString(36).slice(-5).toUpperCase();
    const cr = await admin.req('/api/admin/coupons', {
      method: 'POST', body: { code, type: 'percent', value: 100, minSubtotal: 0, usageLimit: 5, active: true },
    });
    created.coupons.push(cr.data?.id);
    const u = await mkUser('f3', 0); // ví 0 đồng
    const o = await u.req('/api/orders', {
      method: 'POST', body: { items: [{ productId: licWeek.id, quantity: 1 }], couponCode: code },
    });
    const totalZero = o.data?.order?.total === 0;
    rec('F3', 'coupon 100% tạo được đơn total=0?',
      'chặn (không cho mua miễn phí)',
      `HTTP=${o.status} ${o.data?.code || ''} total=${o.data?.order?.total}`,
      o.status !== 201,
      'createOrder chỉ chặn "total===0 && subtotal>0"... cần kiểm chứng nhánh pay');
    if (o.status === 201) {
      created.orders.push(o.data.order.id);
      const pay = await u.req(`/api/orders/${o.data.order.id}/pay`, { method: 'POST' });
      const got = pay.data?.order?.delivered?.[0]?.keys?.length || 0;
      rec('F3b', 'trả đơn total=0 với ví 0đ',
        'Không giao hàng (total=0 phải bị chặn từ đầu)',
        `HTTP=${pay.status} ${pay.data?.code || ''}, giao ${got} license, status=${pay.data?.order?.status}`,
        pay.status !== 200,
        pay.status === 200 ? '🔴 LẤY ĐƯỢC LICENSE MIỄN PHÍ: đơn 0đ được giao key dù ví 0 đồng' : '');
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
  console.log('Dữ liệu test:', JSON.stringify(created));
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
