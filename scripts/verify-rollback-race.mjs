/**
 * Ép ROLLBACK thật sự chạy: lỗi phải xảy ra SAU khi dòng license đã giao.
 *
 * Vì sao cần script riêng: deliverOrderItems kiểm tra tồn kho TOÀN BỘ dòng
 * ở BƯỚC 1 trước khi giao bất cứ thứ gì. Với 2 đơn song song, đơn thua
 * thường fail ngay ở pre-check -> chưa sinh license nào -> rollback không
 * có gì để chạy, và ta KHÔNG chứng minh được guard có tác dụng.
 *
 * Cửa sổ nguy hiểm thật là: cả N request CÙNG pass pre-check (đều thấy còn
 * 1 key), rồi cùng tranh nhau claim key ở BƯỚC 2. Khi đó request thua đã
 * kịp giao license của dòng 1 -> rollback PHẢI revoke nó.
 *
 * Script này lặp nhiều vòng với N request song song để chạm đúng cửa sổ đó,
 * rồi kiểm bất biến. Chạy: node scripts/verify-rollback-race.mjs
 */
import { sql } from './_d1local.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'local-test-secret-1234567890';
const ROUNDS = Number(process.argv[3] || 12);
const CONCURRENCY = Number(process.argv[4] || 6);

let pass = 0, fail = 0;

class Client {
  constructor() { this.cookie = null; }
  async req(path, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
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

const n = (q) => sql(q)[0]?.n ?? 0;
const uniq = Date.now().toString(36);

async function main() {
  console.log(`\n🎯 ÉP ROLLBACK THẬT (${ROUNDS} vòng × ${CONCURRENCY} request song song)\n`);

  const u = new Client();
  const uname = `rr${uniq.replace(/[^a-z0-9]/g, '').slice(0, 10)}`;
  const reg = await u.req('/api/auth/register', {
    method: 'POST', body: { username: uname, password: 'Test123456' },
  });
  if (reg.status !== 201) { console.error(`đăng ký lỗi ${reg.status}`); process.exit(2); }
  const uid = (await u.req('/api/auth/me')).data.user.id;

  const TOP = 50_000_000;
  sql(`UPDATE users SET balance = balance + ${TOP} WHERE id='${uid}';`);
  sql(`INSERT INTO wallet_transactions
         (id,user_id,type,amount,balance_after,status,reference,description,created_at)
       VALUES ('rtop-${uniq}','${uid}','admin_credit',${TOP},
         (SELECT balance FROM users WHERE id='${uid}'),'success','SEED2','seed',${Date.now()});`);

  const prods = (await new Client().req('/api/products?perPage=100')).data.products;
  const licProd = prods.find((p) => p.slug === 'license-xarena-thang');

  let rollbackHits = 0;
  let midFailures = 0;
  let violations = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    // Đưa kho antivirus về ĐÚNG 1 key available mỗi vòng
    sql(`UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL
          WHERE product_id='p-antivirus';`);
    sql(`UPDATE product_keys SET status='disabled'
          WHERE product_id='p-antivirus' AND status='available'
            AND id NOT IN (SELECT id FROM (SELECT id FROM product_keys
                            WHERE product_id='p-antivirus' AND status='available' LIMIT 1));`);
    const avail = n(`SELECT COUNT(*) n FROM product_keys WHERE product_id='p-antivirus' AND status='available'`);
    if (avail !== 1) { console.log(`  vòng ${round}: ⚠️ avail=${avail}, bỏ qua`); continue; }

    // Tạo N đơn giống nhau; tất cả đều thấy "còn 1 key" lúc tạo đơn
    const items = [
      { productId: licProd.id, quantity: 1 },     // dòng 1: license
      { productId: 'p-antivirus', quantity: 1 },  // dòng 2: key duy nhất
    ];
    const created = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const o = await u.req('/api/orders', { method: 'POST', body: { items } });
      if (o.status !== 201) continue;
      const qr = await u.req(`/api/orders/${o.data.order.id}/qr`, { method: 'POST' });
      if (qr.status !== 200) continue;
      created.push({ id: o.data.order.id, memo: qr.data.qr.memo, amount: qr.data.qr.amount });
    }
    if (created.length === 0) continue;

    // Bắn TOÀN BỘ webhook song song -> tranh nhau claim key ở BƯỚC 2
    await Promise.all(created.map((c) => fetch(BASE + '/api/webhooks/sepay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${WEBHOOK_SECRET}` },
      body: JSON.stringify({
        transferType: 'in', transferAmount: c.amount, content: c.memo,
        referenceCode: `R${uniq}-${round}-${c.id.slice(0, 8)}`,
      }),
    })));

    const ids = created.map((c) => `'${c.id}'`).join(',');
    const rows = sql(`
      SELECT o.id, o.code, o.status, o.admin_note,
             li.license_key, COALESCE(l.revoked,0) AS revoked
        FROM orders o
        LEFT JOIN license_issues li ON li.order_id = o.id
        LEFT JOIN licenses l ON l.key = li.license_key
       WHERE o.id IN (${ids})`);

    // Số order có note "không đủ hàng" = fail ở pre-check (license chưa sinh)
    // Số order có license_key nhưng status != delivered = FAIL GIỮA CHỪNG
    //   -> đây là ca rollback bắt buộc phải chạy
    const mid = rows.filter((r) => r.status !== 'delivered' && r.license_key);
    const alive = mid.filter((r) => !r.revoked);
    const delivered = rows.filter((r) => r.status === 'delivered');
    const soldKeys = n(`SELECT COUNT(*) n FROM product_keys WHERE product_id='p-antivirus' AND status='sold'`);

    if (mid.length) {
      midFailures += mid.length;
      rollbackHits += mid.filter((r) => r.revoked).length;
      console.log(`  vòng ${round}: delivered=${delivered.length}, fail-giữa-chừng=${mid.length} `
        + `(revoked=${mid.filter((r) => r.revoked).length}), soldKeys=${soldKeys}`);
      for (const r of mid) {
        console.log(`     ${r.code} status=${r.status} key=${r.license_key} revoked=${r.revoked} note=${r.admin_note || ''}`);
      }
    }

    // ===== BẤT BIẾN =====
    if (delivered.length !== 1) {
      violations++; console.log(`  ❌ vòng ${round}: phải có đúng 1 đơn delivered, có ${delivered.length}`);
    }
    if (soldKeys !== 1) {
      violations++; console.log(`  ❌ vòng ${round}: phải bán đúng 1 key, sold=${soldKeys}`);
    }
    if (alive.length) {
      violations++;
      console.log(`  ❌ vòng ${round}: ${alive.length} license SỐNG trên đơn giao lỗi: ${JSON.stringify(alive)}`);
    }
    // License của đơn delivered phải còn sống
    const deadOk = delivered.filter((r) => r.license_key && r.revoked);
    if (deadOk.length) {
      violations++; console.log(`  ❌ vòng ${round}: revoke NHẦM license đơn thành công: ${JSON.stringify(deadOk)}`);
    }
  }

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  fail-giữa-chừng (license đã sinh rồi mới lỗi): ${midFailures}`);
  console.log(`  trong đó license được revoke đúng:              ${rollbackHits}`);
  console.log(`  vi phạm bất biến:                               ${violations}`);

  pass = violations === 0 ? 1 : 0;
  fail = violations;

  if (midFailures === 0) {
    console.log('\n  ⚠️  KHÔNG chạm được cửa sổ "pre-check pass nhưng claim fail".');
    console.log('     Bất biến vẫn đúng, nhưng nhánh rollback chưa được chứng minh.');
    console.log('     Tăng số vòng / độ song song để chạm lại.');
  } else {
    console.log(`\n  ✅ Đã chạm cửa sổ rollback ${midFailures} lần và thu hồi đúng hết.`);
  }

  console.log(`\n${violations === 0 ? '✅ KHÔNG VI PHẠM' : '❌ CÓ VI PHẠM'}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
