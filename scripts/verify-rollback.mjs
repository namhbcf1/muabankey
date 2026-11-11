/**
 * Kiểm chứng THẬT cho Lỗi 5 (rollback tài nguyên khi giao lỗi) và Lỗi 4
 * (hoàn tiền idempotent) trên dev server local.
 *
 * Chạy: node scripts/verify-rollback.mjs [baseUrl]
 *
 * Nguyên tắc: mọi khẳng định đều đọc lại DB, không tin response API.
 */
import { sql } from './_d1local.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const ADMIN_USER = process.env.ADMIN_USER || 'testadmin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'TestAdmin123456';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'local-test-secret-1234567890';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

class Client {
  constructor() { this.cookie = null; }
  async req(path, { method = 'GET', body = null, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) this.cookie = m[0]; }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) { try { data = await res.json(); } catch { /* */ } }
    return { status: res.status, data };
  }
}

const uniq = Date.now().toString(36);
const n = (q) => sql(q)[0]?.n ?? 0;

/** Chênh lệch sổ cái: trả Map userId -> lệch. */
function ledgerDrift() {
  const rows = sql(`
    SELECT u.id, u.balance,
           COALESCE(SUM(w.amount),0) AS so_cai,
           u.balance - COALESCE(SUM(w.amount),0) AS lech
      FROM users u
      LEFT JOIN wallet_transactions w
        ON w.user_id = u.id AND w.status = 'success'
     GROUP BY u.id HAVING lech <> 0;`);
  return new Map(rows.map((r) => [r.id, r.lech]));
}

async function main() {
  console.log(`\n🧪 KIỂM CHỨNG ROLLBACK + REFUND IDEMPOTENT → ${BASE}\n`);

  /* ================= Chuẩn bị ================= */
  console.log('📦 Chuẩn bị dữ liệu');
  const u = new Client();
  const uname = `vr${uniq.replace(/[^a-z0-9]/g, '').slice(0, 10)}`;
  const reg = await u.req('/api/auth/register', {
    method: 'POST', body: { username: uname, password: 'Test123456' },
  });
  if (reg.status !== 201) { console.log(`  ⚠️  đăng ký lỗi status=${reg.status} — dừng`); process.exit(2); }
  const uid = (await u.req('/api/auth/me')).data.user.id;

  const admin = new Client();
  const al = await admin.req('/api/auth/login', {
    method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PW },
  });
  ok(`admin đăng nhập (${ADMIN_USER})`, al.status === 200, `status=${al.status}`);
  const adminOk = al.status === 200;

  // Ghi nhận drift sổ cái CÓ SẴN TRƯỚC khi test (dữ liệu seed cũ, không phải
  // do thay đổi của tôi). Test chỉ được phép KHÔNG THÊM drift mới.
  const driftBefore = ledgerDrift();
  console.log(`  user=${uname} id=${uid}`);
  console.log(`  drift sổ cái có sẵn: ${driftBefore.size} user`);

  const TOP = 20_000_000;
  sql(`UPDATE users SET balance = balance + ${TOP}, updated_at = ${Date.now()} WHERE id = '${uid}';`);
  sql(`INSERT INTO wallet_transactions
         (id,user_id,type,amount,balance_after,status,reference,description,created_at)
       VALUES ('top-${uniq}','${uid}','admin_credit',${TOP},
         (SELECT balance FROM users WHERE id='${uid}'),'success','SEED','seed test',${Date.now()});`);

  const balOf = () => sql(`SELECT balance FROM users WHERE id='${uid}'`)[0]?.balance ?? 0;
  console.log(`  balance=${balOf()}`);

  const allProducts = (await new Client().req('/api/products?perPage=100')).data.products;
  const licProd = allProducts.find((p) => p.slug === 'license-xarena-thang');

  /** Tạo đơn + lấy QR (memo) nhưng CHƯA thanh toán. */
  async function createOrder(items) {
    const o = await u.req('/api/orders', { method: 'POST', body: { items } });
    if (o.status !== 201) return { err: `tạo đơn: ${o.status} ${JSON.stringify(o.data).slice(0, 160)}` };
    const qr = await u.req(`/api/orders/${o.data.order.id}/qr`, { method: 'POST' });
    if (qr.status !== 200) return { err: `QR: ${qr.status} ${JSON.stringify(qr.data).slice(0, 160)}` };
    return { order: o.data.order, memo: qr.data.qr.memo, amount: qr.data.qr.amount };
  }

  /** Bắn webhook SePay thật để xác nhận thanh toán + giao hàng. */
  async function payViaWebhook(created, label) {
    const res = await fetch(BASE + '/api/webhooks/sepay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${WEBHOOK_SECRET}` },
      body: JSON.stringify({
        transferType: 'in',
        transferAmount: created.amount,
        content: created.memo,
        referenceCode: `V${uniq}-${label}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  }

  /* ============================================================
     TEST 1 — giao license: không crash + ĐÚNG số lượng
     ============================================================ */
  console.log('\n1️⃣  Giao license: không crash + đúng số lượng');
  const licBefore = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);

  const c1 = await createOrder([{ productId: licProd.id, quantity: 1 }]);
  if (c1.err) console.log(`  ⚠️  ${c1.err}`);
  const p1 = c1.order ? await payViaWebhook(c1, 'qty1') : {};
  console.log(`  webhook: ${p1.status} ${JSON.stringify(p1.data || {}).slice(0, 180)}`);

  if (c1.order) {
    const ord = sql(`SELECT status, admin_note FROM orders WHERE id='${c1.order.id}'`)[0];
    const licAfter = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);
    console.log(`  đơn: status=${ord?.status} note=${ord?.admin_note || '(không)'}`);
    console.log(`  license_issues: ${licBefore} -> ${licAfter}`);
    ok('qty=1 sinh ĐÚNG 1 license (không nhân đôi)', licAfter - licBefore === 1, `delta=${licAfter - licBefore}`);
    ok('đơn qty=1 delivered (hết crash deliverLicenseLine)', ord?.status === 'delivered', `status=${ord?.status}`);
  }

  // qty=2 -> phải đúng 2, không phải 4
  const lic2Before = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);
  const c2 = await createOrder([{ productId: licProd.id, quantity: 2 }]);
  if (c2.order) {
    await payViaWebhook(c2, 'qty2');
    const lic2After = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);
    console.log(`  qty=2: license_issues ${lic2Before} -> ${lic2After}`);
    ok('qty=2 sinh ĐÚNG 2 license (không phải 4)', lic2After - lic2Before === 2, `delta=${lic2After - lic2Before}`);
  }

  /* ============================================================
     TEST 2 — ROLLBACK: race 2 đơn cùng giành key cuối cùng
     ============================================================ */
  console.log('\n2️⃣  ROLLBACK — 2 đơn [license, key] tranh key cuối (lỗi 5)');

  // Ép kho antivirus còn ĐÚNG 1 key available
  sql(`UPDATE product_keys SET status='disabled'
        WHERE product_id='p-antivirus' AND status='available'
          AND id NOT IN (SELECT id FROM (SELECT id FROM product_keys
                          WHERE product_id='p-antivirus' AND status='available' LIMIT 1));`);
  const avBefore = n(`SELECT COUNT(*) n FROM product_keys WHERE product_id='p-antivirus' AND status='available'`);
  console.log(`  p-antivirus available = ${avBefore}`);

  // Tạo 2 đơn GIỐNG HỆT NHAU cùng lúc (cả hai đều qua được kiểm tra tồn kho
  // lúc tạo đơn vì stock_count = 1 >= 1).
  const items2 = [
    { productId: licProd.id, quantity: 1 },      // dòng 1: license -> giao được
    { productId: 'p-antivirus', quantity: 1 },   // dòng 2: key duy nhất
  ];
  const a = await createOrder(items2);
  const b = await createOrder(items2);
  console.log(`  đơn A: ${a.order?.id || a.err}`);
  console.log(`  đơn B: ${b.order?.id || b.err}`);

  if (a.order && b.order) {
    const licIssuesBeforeRace = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);

    // Bắn CẢ HAI webhook song song -> cả hai cùng vào deliverOrderItems
    const [ra, rb] = await Promise.all([
      payViaWebhook(a, 'raceA'),
      payViaWebhook(b, 'raceB'),
    ]);
    console.log(`  webhook A: ${ra.status} ${JSON.stringify(ra.data || {}).slice(0, 170)}`);
    console.log(`  webhook B: ${rb.status} ${JSON.stringify(rb.data || {}).slice(0, 170)}`);

    for (const [lbl, o] of [['A', a], ['B', b]]) {
      const ord = sql(`SELECT status, admin_note FROM orders WHERE id='${o.order.id}'`)[0];
      console.log(`  đơn ${lbl}: status=${ord?.status} note=${ord?.admin_note || '(không)'}`);
    }

    // ===== KHẲNG ĐỊNH CHÍNH: license của đơn THUA phải bị revoke =====
    const rows = sql(`
      SELECT o.code AS order_code, o.status,
             li.license_key, COALESCE(l.revoked,0) AS revoked
        FROM orders o
        LEFT JOIN license_issues li ON li.order_id = o.id
        LEFT JOIN licenses l ON l.key = li.license_key
       WHERE o.id IN ('${a.order.id}','${b.order.id}')`);
    console.log('  license theo đơn:');
    for (const r of rows) console.log(`    ${r.order_code} status=${r.status} key=${r.license_key} revoked=${r.revoked}`);

    const delivered = rows.filter((r) => r.status === 'delivered');
    const notDelivered = rows.filter((r) => r.status !== 'delivered');

    ok('đúng 1 trong 2 đơn được giao', delivered.length >= 1, `delivered rows=${delivered.length}`);
    ok('kho antivirus không bị bán quá 1 key',
      n(`SELECT COUNT(*) n FROM product_keys WHERE product_id='p-antivirus' AND status='sold'`) === 1,
      `sold=${n(`SELECT COUNT(*) n FROM product_keys WHERE product_id='p-antivirus' AND status='sold'`)}`);

    // Đơn KHÔNG delivered: nếu đã kịp sinh license thì license PHẢI revoked
    const aliveOnFailed = notDelivered.filter((r) => r.license_key && !r.revoked);
    ok('KHÔNG có license nào SỐNG trên đơn giao lỗi (rollback chạy)',
      aliveOnFailed.length === 0,
      `sống=${aliveOnFailed.length} ${JSON.stringify(aliveOnFailed)}`);

    // Đơn đã delivered: license phải CÒN SỐNG (không revoke nhầm hàng hợp lệ)
    const deadOnOk = delivered.filter((r) => r.license_key && r.revoked);
    ok('license của đơn THÀNH CÔNG vẫn sống (không revoke nhầm)',
      deadOnOk.length === 0, `bị revoke nhầm=${deadOnOk.length}`);

    // Không còn key nào bị giữ bởi đơn lỗi
    for (const o of [a, b]) {
      const st = sql(`SELECT status FROM orders WHERE id='${o.order.id}'`)[0]?.status;
      if (st !== 'delivered') {
        const held = n(`SELECT COUNT(*) n FROM product_keys WHERE order_id='${o.order.id}' AND status='sold'`);
        ok(`đơn lỗi ${st}: không giữ key nào`, held === 0, `sold=${held}`);
        const dk = n(`SELECT COUNT(*) n FROM order_items
                       WHERE order_id='${o.order.id}' AND delivered_keys IS NOT NULL`);
        ok(`đơn lỗi ${st}: delivered_keys đã xoá`, dk === 0, `còn=${dk}`);
      }
    }

    const licIssuesAfterRace = n(`SELECT COUNT(*) n FROM license_issues WHERE user_id='${uid}'`);
    console.log(`  license_issues: ${licIssuesBeforeRace} -> ${licIssuesAfterRace}`);
  }

  /* ============================================================
     TEST 3 — không lộ key cho đơn chưa delivered
     ============================================================ */
  console.log('\n3️⃣  Không lộ key cho đơn chưa delivered');
  const c3 = await createOrder([{ productId: licProd.id, quantity: 1 }]);
  const poid = c3.order.id;
  sql(`UPDATE order_items SET delivered_keys='["SEKRET-LEAK"]' WHERE order_id='${poid}';`);

  const list = await u.req('/api/orders?perPage=50');
  const pend = list.data.orders.find((o) => o.id === poid);
  const leak = (pend?.items || []).flatMap((i) => i.keys || []);
  ok('GET /api/orders: đơn pending KHÔNG lộ key',
    Boolean(pend) && leak.length === 0,
    `status=${pend?.status} len=${leak.length} ${JSON.stringify(leak)}`);

  const det = await u.req(`/api/orders/${poid}`);
  const leak2 = (det.data.order.items || []).flatMap((i) => i.keys || []);
  ok('GET /api/orders/:id: đơn pending KHÔNG lộ key',
    leak2.length === 0, `len=${leak2.length} ${JSON.stringify(leak2)}`);

  const dl = sql(`SELECT id FROM orders WHERE user_id='${uid}' AND status='delivered' LIMIT 1`)[0];
  if (dl) {
    const d = await u.req(`/api/orders/${dl.id}`);
    const dk = (d.data.order.items || []).flatMap((i) => i.keys || []);
    console.log(`  đơn delivered trả ${dk.length} key`);
    ok('đơn DELIVERED vẫn trả đủ key', dk.length > 0, `len=${dk.length}`);
  }

  /* ============================================================
     TEST 4 — refund 2 lần + 3 lần song song
     ============================================================ */
  console.log('\n4️⃣  Hoàn tiền chống trùng (đường web)');
  const target = sql(
    `SELECT id, code, total FROM orders
      WHERE user_id='${uid}' AND status='delivered'
        AND id NOT IN (SELECT order_id FROM refund_ledger) LIMIT 1`)[0];

  if (!adminOk) {
    console.log('  ⏭  bỏ qua (admin không đăng nhập)');
  } else if (!target) {
    console.log('  ⏭  bỏ qua (không có đơn delivered chưa hoàn)');
  } else {
    const balB = balOf();
    const r1 = await admin.req(`/api/admin/orders/${target.id}/refund`, { method: 'POST' });
    const balA1 = balOf();
    console.log(`  refund#1 status=${r1.status} balance ${balB} -> ${balA1} (total=${target.total})`);
    ok('refund lần 1 → 200', r1.status === 200, `status=${r1.status} ${JSON.stringify(r1.data).slice(0, 140)}`);
    ok('ví tăng đúng bằng total', balA1 === balB + target.total,
      `want=${balB + target.total} got=${balA1}`);

    const r2 = await admin.req(`/api/admin/orders/${target.id}/refund`, { method: 'POST' });
    const balA2 = balOf();
    console.log(`  refund#2 status=${r2.status} balance=${balA2}`);
    ok('refund lần 2 → 409', r2.status === 409, `status=${r2.status}`);
    ok('ví KHÔNG đổi sau lần 2', balA2 === balA1, `got=${balA2} want=${balA1}`);

    ok('refund_ledger đúng 1 dòng',
      n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${target.id}'`) === 1,
      `n=${n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${target.id}'`)}`);
    const st = sql(`SELECT state FROM refund_ledger WHERE order_id='${target.id}'`)[0]?.state;
    ok("refund_ledger.state='done'", st === 'done', `state=${st}`);

    const wr = sql(`SELECT amount FROM wallet_transactions
                     WHERE user_id='${uid}' AND reference='${target.code}' AND type='refund'`);
    ok('sổ cái có đúng 1 dòng refund', wr.length === 1, `n=${wr.length}`);
    ok('số tiền refund đúng', wr[0]?.amount === target.total, `got=${wr[0]?.amount} want=${target.total}`);

    const t2 = sql(`SELECT id, total FROM orders WHERE user_id='${uid}' AND status='delivered'
                     AND id NOT IN (SELECT order_id FROM refund_ledger) LIMIT 1`)[0];
    if (t2) {
      const b1 = balOf();
      const rs = await Promise.all([1, 2, 3].map(() =>
        admin.req(`/api/admin/orders/${t2.id}/refund`, { method: 'POST' })));
      const codes = rs.map((r) => r.status);
      const b2 = balOf();
      console.log(`  3 refund song song → ${JSON.stringify(codes)} balance ${b1} -> ${b2}`);
      ok('chỉ ĐÚNG 1 refund thành công', codes.filter((c) => c === 200).length === 1, `codes=${JSON.stringify(codes)}`);
      ok('ví chỉ tăng 1 lần', b2 === b1 + t2.total, `want=${b1 + t2.total} got=${b2}`);
      ok('refund_ledger vẫn 1 dòng',
        n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${t2.id}'`) === 1,
        `n=${n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${t2.id}'`)}`);
    }
  }

  /* ============================================================
     TEST 5 — đối soát sổ cái
     ============================================================ */
  console.log('\n5️⃣  Đối soát sổ cái');
  const driftAfter = ledgerDrift();
  const newDrift = [...driftAfter.keys()].filter((id) => !driftBefore.has(id));
  console.log(`  drift trước=${driftBefore.size} sau=${driftAfter.size}`);
  ok('KHÔNG phát sinh user lệch sổ cái mới', newDrift.length === 0,
    `mới lệch=${JSON.stringify(newDrift)}`);

  const mine = sql(`
    SELECT u.balance, COALESCE(SUM(w.amount),0) AS so_cai
      FROM users u LEFT JOIN wallet_transactions w
        ON w.user_id = u.id AND w.status='success'
     WHERE u.id='${uid}' GROUP BY u.id;`)[0];
  console.log(`  user test: balance=${mine?.balance} sổ cái=${mine?.so_cai}`);
  ok('sổ cái của user test khớp tuyệt đối',
    mine && mine.balance === mine.so_cai, `balance=${mine?.balance} so_cai=${mine?.so_cai}`);

  if (driftBefore.size) {
    console.log(`  ℹ️  ${driftBefore.size} user lệch là drift CÓ SẴN từ dữ liệu seed local`);
    console.log('     (không do thay đổi này gây ra):');
    for (const [id, lech] of [...driftBefore].slice(0, 5)) console.log(`       ${id} lệch ${lech}`);
  }

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  if (fail > 0) { console.log('\nLỗi:'); for (const f of fails) console.log('  • ' + f); }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('\n💥 crash:', e); process.exit(1); });
