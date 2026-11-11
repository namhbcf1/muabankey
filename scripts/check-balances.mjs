const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n💰 KIỂM TRA SỐ DƯ HIỆN CÓ\n');

  const rows = await q(
    'SELECT id, email, full_name, role, balance FROM users WHERE balance > 0 ORDER BY balance DESC'
  );

  if (!rows.length) {
    console.log('  ✅ Không có user nào có số dư > 0');
    console.log('  → Bỏ ví AN TOÀN, không cần hoàn tiền');
  } else {
    console.log(`  ⚠️  ${rows.length} user có số dư:`);
    let total = 0;
    for (const r of rows) {
      console.log(`     ${(r.email || r.id).padEnd(32)} ${String(r.balance).padStart(10)}đ  (${r.role})`);
      total += r.balance;
    }
    console.log(`\n  TỔNG: ${total.toLocaleString()}đ`);
  }

  // Đơn cũ dùng ví
  const ord = await q(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE status IN ('paid','delivered')"
  );
  console.log(`\n  Đơn đã thanh toán: ${ord[0].n} đơn, tổng ${Number(ord[0].s).toLocaleString()}đ`);
})();
