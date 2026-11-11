/**
 * Kiểm chứng CRON không còn "hồi sinh" đơn hoàn tiền.
 *
 * Lỗi 4 phần cron: đơn 'refunding' kẹt quá 10 phút bị đưa về 'paid'
 * -> admin thấy lại nút "Hoàn" -> hoàn lần 2 -> MẤT TIỀN THẬT.
 * Đã xảy ra thật: MBK-L5W87H hoàn 70.000đ hai lần.
 *
 * Script này chạy ĐÚNG hai câu SQL của cron (trích từ src/index.js) trên DB
 * local để chứng minh 2 nhánh:
 *   A. refund_ledger.state='done'  -> chốt 'refunded' (tiền đã cộng xong)
 *   B. còn lại                     -> 'refund_stuck' (KHÔNG về 'paid')
 *
 * Chạy: node scripts/verify-cron-refund.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const p = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const f = readdirSync(p)
  .filter((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite')
  .map((x) => ({ x, s: statSync(join(p, x)).size }))
  .filter((a) => a.s > 20000)
  .sort((a, b) => b.s - a.s)[0].x;
const db = new DatabaseSync(join(p, f));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const now = Date.now();
const OLD = now - 15 * 60 * 1000; // 15 phút trước -> quá hạn 10 phút
const uid = `cr-${randomUUID().slice(0, 8)}`;

db.prepare(`INSERT INTO users (id,email,username,password_hash,password_salt,role,status,balance,created_at,updated_at)
            VALUES (?,?,?,'x','x','user','active',0,?,?)`).run(uid, `${uid}@local`, uid, now, now);

function mkOrder(status, code) {
  const id = randomUUID();
  db.prepare(`INSERT INTO orders (id,code,user_id,status,subtotal,discount,total,
                payment_method,created_at,paid_at,refund_started_at)
              VALUES (?,?,?,?,100000,0,100000,'wallet',?,?,?)`)
    .run(id, code, uid, status, now, now, OLD);
  return id;
}

console.log('\n🧪 CRON: đơn refunding quá hạn KHÔNG được về paid\n');

// Ca A: có sổ 'done' -> phải chốt 'refunded'
const aId = mkOrder('refunding', `MBK-CRA${Math.floor(Math.random() * 900 + 100)}`);
db.prepare(`INSERT INTO refund_ledger (order_id,amount,user_id,order_code,state,revoked,source,actor,at)
            VALUES (?,100000,?,?,'done',2,'web','t',?)`)
  .run(aId, uid, `MBK-CRA`, now);

// Ca B: sổ 'pending' (crash TRƯỚC khi cộng tiền) -> 'refund_stuck'
const bId = mkOrder('refunding', `MBK-CRB${Math.floor(Math.random() * 900 + 100)}`);
db.prepare(`INSERT INTO refund_ledger (order_id,amount,user_id,order_code,state,revoked,source,actor,at)
            VALUES (?,100000,?,?,'pending',0,'web','t',?)`)
  .run(bId, uid, `MBK-CRB`, now);

// Ca C: KHÔNG có sổ (dữ liệu cũ) -> 'refund_stuck'
const cId = mkOrder('refunding', `MBK-CRC${Math.floor(Math.random() * 900 + 100)}`);

// Ca D: refunding MỚI (chưa quá hạn) -> phải GIỮ NGUYÊN
const dId = randomUUID();
db.prepare(`INSERT INTO orders (id,code,user_id,status,subtotal,discount,total,
              payment_method,created_at,paid_at,refund_started_at)
            VALUES (?,?,?,'refunding',100000,0,100000,'wallet',?,?,?)`)
  .run(dId, `MBK-CRD${Math.floor(Math.random() * 900 + 100)}`, uid, now, now, now - 60 * 1000);

/* ===== Chạy ĐÚNG SQL của cron (src/index.js) ===== */
// Nhánh A
db.prepare(`UPDATE orders SET status = 'refunded'
             WHERE status = 'refunding'
               AND refund_started_at IS NOT NULL
               AND refund_started_at < ?
               AND id IN (SELECT order_id FROM refund_ledger WHERE state = 'done')`)
  .run(now - 10 * 60 * 1000);
// Nhánh B
db.prepare(`UPDATE orders SET status = 'refund_stuck'
             WHERE status = 'refunding'
               AND refund_started_at IS NOT NULL
               AND refund_started_at < ?`)
  .run(now - 10 * 60 * 1000);

const st = (id) => db.prepare('SELECT status FROM orders WHERE id=?').get(id).status;
console.log(`  A (sổ done)         : ${st(aId)}`);
console.log(`  B (sổ pending)      : ${st(bId)}`);
console.log(`  C (không có sổ)     : ${st(cId)}`);
console.log(`  D (refunding mới)   : ${st(dId)}`);

ok("A: sổ 'done' -> chốt 'refunded'", st(aId) === 'refunded', `got=${st(aId)}`);
ok("B: sổ 'pending' -> 'refund_stuck'", st(bId) === 'refund_stuck', `got=${st(bId)}`);
ok("C: không có sổ -> 'refund_stuck'", st(cId) === 'refund_stuck', `got=${st(cId)}`);
ok('D: refunding mới KHÔNG bị đụng', st(dId) === 'refunding', `got=${st(dId)}`);

ok('KHÔNG đơn nào bị đưa về paid',
  [aId, bId, cId, dId].every((id) => st(id) !== 'paid'),
  JSON.stringify([aId, bId, cId, dId].map(st)));

// Quan trọng: 'refund_stuck' phải KHÔNG hiện nút Hoàn trên admin UI.
// UI chỉ hiện nút khi status ∈ {paid, delivered} (public/assets/pages/admin.js).
console.log('\n  Kiểm UI chỉ cho refund khi paid/delivered:');
const uiSrc = readdirSync('public/assets/pages').includes('admin.js');
if (uiSrc) {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync('public/assets/pages/admin.js', 'utf8');
  const allows = /data-refund/.test(js) && /\['paid', 'delivered'\]\.includes\(o\.status\)/.test(js);
  ok("admin.js chỉ hiện nút Hoàn với paid/delivered -> 'refund_stuck' KHÔNG refund lại được",
    allows, allows ? '' : 'không thấy guard trong admin.js');
}

// Dọn
for (const id of [aId, bId, cId, dId]) {
  db.prepare('DELETE FROM refund_ledger WHERE order_id=?').run(id);
  db.prepare('DELETE FROM orders WHERE id=?').run(id);
}
db.prepare('DELETE FROM users WHERE id=?').run(uid);
console.log('\n🧹 đã dọn dữ liệu test');

console.log(`\n${'─'.repeat(58)}`);
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
db.close();
process.exit(fail > 0 ? 1 : 0);
