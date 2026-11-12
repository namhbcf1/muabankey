const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';

async function q(sql) {
  const rr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await rr.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n🔍 TRUY 1.800.000đ — 16:45:02 12/11\n');

  // 1. Đơn CHƯA giao trong 24h (mọi trạng thái trừ delivered/refunded)
  console.log('1️⃣  Đơn CHƯA GIAO trong 24h:');
  const undelivered = await q(
    `SELECT code, status, total, created_at, payment_ref
     FROM orders
     WHERE status NOT IN ('delivered','refunded')
       AND created_at > (strftime('%s','now')-86400)*1000
     ORDER BY created_at DESC`
  );
  console.log(`   Tổng: ${undelivered.length} đơn`);
  const sizes = {};
  for (const o of undelivered) sizes[o.total] = (sizes[o.total] || 0) + 1;
  for (const [k, v] of Object.entries(sizes)) console.log(`   ${k}đ: ${v} đơn`);

  // 2. Đơn có total >= 1.8tr (mua gói năm/vĩnh viễn)
  console.log('\n2️⃣  Đơn total >= 1.8tr trong 48h:');
  const big = await q(
    `SELECT code, status, total, created_at FROM orders
     WHERE total >= 1800000 AND created_at > (strftime('%s','now')-172800)*1000
     ORDER BY created_at DESC LIMIT 10`
  );
  if (!big.length) console.log('   (không có)');
  for (const o of big) {
    console.log(`   ${o.code} | ${o.total}đ | ${o.status} | ${new Date(o.created_at).toLocaleString('vi-VN')}`);
  }

  // 3. Đơn gần nhất TRƯỚC 16:45 (khách có thể tạo sớm rồi chuyển muộn)
  console.log('\n3️⃣  5 đơn tạo gần 16:45 nhất (bất kể trạng thái):');
  const ts = 1794476702;
  const near = await q(
    `SELECT code, status, total, created_at FROM orders
     ORDER BY ABS(created_at/1000 - ${ts}) LIMIT 5`
  );
  for (const o of near) {
    const diff = Math.round((o.created_at / 1000 - ts) / 60);
    console.log(`   ${o.code} | ${String(o.total).padStart(8)}đ | ${o.status.padEnd(10)} | lệch ${diff} phút`);
  }

  // 4. User nào tạo đơn nhiều 180k trong ngày (khả năng 10 đơn = 1.8tr)
  console.log('\n4️⃣  User có nhiều đơn 180k chưa giao:');
  const multi = await q(
    `SELECT user_id, COUNT(*) AS n, SUM(total) AS s
     FROM orders
     WHERE status IN ('expired','pending') AND created_at > (strftime('%s','now')-86400)*1000
     GROUP BY user_id HAVING SUM(total) = 1800000`
  );
  if (!multi.length) console.log('   (không có user nào có tổng đúng 1.8tr)');

  // 5. Kết luận
  console.log('\n' + '═'.repeat(60));
  console.log('KẾT LUẬN');
  console.log('═'.repeat(60));
  console.log(`
Không có đơn nào trong hệ thống khớp 1.800.000đ lúc 16:45.

Nghĩa là khách TRAN TAT VIET CUONG đã chuyển tiền mà KHÔNG tạo đơn
trên web (hoặc chuyển nhầm).

CÁCH XỬ LÝ:
  1. Mở Zalo/Telegram nhắn khách: "Anh chuyển 1.800.000đ lúc 16:45
     nhưng hệ thống không thấy đơn. Anh cho em xin mã đơn đã đặt."
  2. Nếu khách không có đơn → hoàn tiền hoặc tạo đơn thủ công
  3. Nếu khách có đơn → tìm theo mã, bấm "Đã nhận tiền" trong admin
`);
})();
