/**
 * Kiểm chứng rollback khi giao hàng lỗi giữa chừng (lỗi 5).
 *
 * KHÁC với scripts/verify-rollback.mjs: test đó tạo đơn bằng API nên bị chặn
 * sớm ở OUT_OF_STOCK, không chạm tới nhánh rollback. Ở đây ta tạo đơn hàng
 * THẲNG trong D1 (bỏ qua kiểm tồn kho lúc đặt), để 2 đơn cùng giành 1 key —
 * đúng kịch bản race thật.
 *
 * Chạy: node scripts/_verify-rollback-race.mjs [baseUrl]
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const DB = 'muabankey-db';
const TMP = mkdtempSync(join(tmpdir(), 'rb-'));

/**
 * Chạy SQL qua file thay vì --command: tên sản phẩm có dấu nháy đơn sẽ làm
 * hỏng chuỗi shell nếu nhồi trực tiếp vào tham số dòng lệnh.
 */
function sql(query) {
  const f = join(TMP, `q${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(f, query, 'utf8');
  const out = execSync(
    `npx wrangler@4 d1 execute ${DB} --local --json --file=${JSON.stringify(f)} --yes`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0])[0]?.results || []; } catch { return []; }
}

let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log(`\n🧪 ROLLBACK RACE TEST → ${BASE}\n`);

// ---------- Chuẩn bị: 1 sản phẩm license + 1 sản phẩm key chỉ còn 1 ----------
const LIC = 'p-lic-month';
const KEY = 'p-antivirus';

const licProd = sql(`SELECT id,name,delivery_type FROM products WHERE id='${LIC}'`)[0];
const keyProd = sql(`SELECT id,name,delivery_type FROM products WHERE id='${KEY}'`)[0];
if (!licProd || !keyProd) {
  console.log('  ⚠️  thiếu sản phẩm test — bỏ qua');
  process.exit(0);
}

// Đảm bảo kho key có đúng 1 available
sql(`UPDATE product_keys SET status='available', order_id=NULL WHERE product_id='${KEY}'`);
const availAll = sql(`SELECT id FROM product_keys WHERE product_id='${KEY}' AND status='available'`);
for (let i = 1; i < availAll.length; i++) {
  sql(`UPDATE product_keys SET status='disabled' WHERE id='${availAll[i].id}'`);
}
const availNow = sql(`SELECT COUNT(*) n FROM product_keys WHERE product_id='${KEY}' AND status='available'`)[0].n;
console.log(`  p-antivirus available = ${availNow}`);

// ---------- Tạo user + 2 đơn [license, key] THẲNG trong DB ----------
const stamp = Date.now();
const userRes = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `rb${stamp}`, password: 'RbTest@123456' }),
});
if (userRes.status !== 201) { console.log('  ❌ không tạo được user'); process.exit(1); }
const ck = userRes.headers.get('set-cookie').split(';')[0];
const uid = (await (await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: ck } })).json()).user.id;

sql(`UPDATE users SET balance=20000000 WHERE id='${uid}'`);

const mkOrder = (tag) => {
  const oid = `rb-${tag}-${stamp}`;
  const code = `MBK-${tag}${stamp % 100000}`;
  sql(`INSERT INTO orders (id,code,user_id,status,subtotal,discount,total,created_at,payment_method)
       VALUES ('${oid}','${code}','${uid}','paid',270000,0,270000,${stamp},'wallet')`);
  sql(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total,delivered_keys)
       VALUES ('${oid}-1','${oid}','${LIC}','${licProd.name}',180000,1,180000,'[]')`);
  sql(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total,delivered_keys)
       VALUES ('${oid}-2','${oid}','${KEY}','${keyProd.name}',90000,1,90000,'[]')`);
  return { oid, code };
};

const A = mkOrder('A');
const B = mkOrder('B');
console.log(`  đơn A=${A.code}  đơn B=${B.code}  (cả 2 cùng giành 1 key)`);

const licBefore = sql(`SELECT COUNT(*) n FROM licenses`)[0].n;

// ---------- Giao song song ----------
/*
 * Kiến trúc hiện tại KHÔNG còn POST /api/orders/:id/pay — tiền vào qua webhook
 * ngân hàng rồi mới giao. Nên phải kích hoạt đúng đường thật: bắn webhook
 * SePay cho 2 đơn cùng lúc, mỗi đơn chuyển đúng số tiền.
 */
console.log('\n1️⃣  Giao 2 đơn song song qua webhook SePay');

const SECRET = 'local-test-secret-1234567890'; // khớp .dev.vars
const deliver = async (o) => {
  const r = await fetch(`${BASE}/api/webhooks/sepay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${SECRET}` },
    body: JSON.stringify({
      transferAmount: 270000,
      content: o.code,
      referenceCode: `RBF${o.code}`,
    }),
  });
  return { code: o.code, status: r.status, body: await r.text() };
};
const results = await Promise.all([deliver(A), deliver(B)]);
results.forEach((r) => console.log(`  ${r.code}: status=${r.status} ${r.body.slice(0, 120)}`));

// ---------- Kiểm chứng ----------
const st = (code) => sql(`SELECT status FROM orders WHERE code='${code}'`)[0]?.status;
const sA = st(A.code); const sB = st(B.code);
console.log(`\n  trạng thái: A=${sA}  B=${sB}`);

const deliveredCount = [sA, sB].filter((s) => s === 'delivered').length;
ok('chỉ ĐÚNG 1 đơn giao được (key chỉ có 1)', deliveredCount === 1, `delivered=${deliveredCount}`);

const licAfter = sql(`SELECT COUNT(*) n FROM licenses`)[0].n;
const licDelta = licAfter - licBefore;
ok('số license tạo khớp số đơn giao được', licDelta === deliveredCount,
  `tạo mới=${licDelta}, đơn delivered=${deliveredCount}`);

// License mồ côi: tồn tại nhưng không gắn order đã delivered
/*
 * `licenses.created_at` tính bằng GIÂY, không phải mili-giây như orders.
 * So sánh nhầm đơn vị sẽ khiến query trả 0 dòng dù dữ liệu đúng.
 */
const stampSec = Math.floor(stamp / 1000) - 5;
const liveOrphan = sql(`
  SELECT COUNT(*) n FROM licenses
  WHERE created_at >= ${stampSec} AND revoked = 0
`)[0].n;
ok('KHÔNG có license sống mồ côi', liveOrphan === deliveredCount,
  `license sống=${liveOrphan}, cần=${deliveredCount}`);

// License của đơn THẤT BẠI phải bị revoke
const failedCode = sA === 'delivered' ? B.code : A.code;
const revokedOfFailed = sql(`
  SELECT COUNT(*) n FROM licenses
  WHERE created_at >= ${stampSec} AND note LIKE '%${failedCode}%' AND revoked = 0
`)[0].n;
ok('license của đơn THẤT BẠI đã bị revoke', revokedOfFailed === 0,
  `còn sống=${revokedOfFailed}`);

const keysSold = sql(`SELECT COUNT(*) n FROM product_keys WHERE product_id='${KEY}' AND status='sold'`)[0].n;
ok('key chỉ bán đúng 1 lần', keysSold <= 1, `sold=${keysSold}`);

const stuck = sql(`SELECT COUNT(*) n FROM orders WHERE code IN ('${A.code}','${B.code}') AND status IN ('refunding','processing')`)[0].n;
ok('không để đơn kẹt processing/refunding', stuck === 0, `kẹt=${stuck}`);

console.log(`\n${'─'.repeat(58)}`);
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
process.exit(fail === 0 ? 0 : 1);
