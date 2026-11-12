const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/v4/placeholder`, { method: 'POST' }).catch(() => null);
  const rr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await rr.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

function combo(list, target, maxN) {
  const out = [];
  function rec(start, cur, sum) {
    if (sum === target) { out.push([...cur]); return; }
    if (sum > target || cur.length >= maxN) return;
    for (let i = start; i < list.length; i++) {
      cur.push(list[i]);
      rec(i + 1, cur, sum + list[i].total);
      cur.pop();
    }
  }
  rec(0, [], 0);
  return out;
}

(async () => {
  console.log('\n💸 TÌM ĐƠN CHO 1.800.000đ (16:45 12/11)\n');

  // GD 16:45 — tìm đơn tạo trong ±4 giờ
  const ts = 1794476702; // 16:45:02

  const cands = await q(
    `SELECT code, status, total, created_at, payment_ref, user_id
     FROM orders
     WHERE created_at/1000 BETWEEN ${ts - 14400} AND ${ts + 3600}
       AND status IN ('expired','pending','paid')
     ORDER BY ABS(created_at/1000 - ${ts})`
  );

  console.log(`Đơn tạo trong khoảng 12:45-17:45: ${cands.length}`);
  for (const o of cands.slice(0, 10)) {
    const d = new Date(o.created_at).toLocaleString('vi-VN');
    console.log(`  ${o.code} | ${String(o.total).padStart(8)}đ | ${o.status.padEnd(9)} | ${d} | memo ${o.payment_ref || '?'}`);
  }

  // Thử tổng 1 đơn = 1.8tr
  const exact = cands.filter((o) => Number(o.total) === 1800000);
  console.log(`\nĐơn đúng 1.800.000đ: ${exact.length}`);
  for (const o of exact) console.log(`  → ${o.code} (${o.status})`);

  // Thử tổ hợp nhiều đơn
  if (!exact.length && cands.length > 0) {
    console.log('\nThử tổ hợp nhiều đơn cùng khách:');
    // Nhóm theo user
    const byUser = {};
    for (const o of cands) {
      if (!byUser[o.user_id]) byUser[o.user_id] = [];
      byUser[o.user_id].push(o);
    }
    for (const [uid, list] of Object.entries(byUser)) {
      const combos = combo(list, 1800000, 6);
      if (combos.length) {
        console.log(`  User ${uid.slice(0, 20)}: ${combos.length} tổ hợp`);
        for (const c of combos.slice(0, 5)) {
          console.log(`    ${c.map((o) => `${o.code}(${o.total})`).join(' + ')}`);
        }
      }
    }
  }

  // Kiểm tra đơn pending treo
  console.log('\nĐơn pending/expired gần 16:45 (mọi thời điểm):');
  const near = await q(
    `SELECT code, status, total, created_at FROM orders
     WHERE ABS(created_at - ${ts * 1000}) < 7200000
     ORDER BY ABS(created_at - ${ts * 1000}) LIMIT 8`
  );
  for (const o of near) {
    const d = new Date(o.created_at).toLocaleString('vi-VN');
    console.log(`  ${o.code} | ${String(o.total).padStart(8)}đ | ${o.status.padEnd(9)} | ${d}`);
  }
})();
