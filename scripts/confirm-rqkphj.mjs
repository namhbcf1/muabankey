const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const PW = (await import('node:fs')).readFileSync('ADMIN_CREDENTIALS.txt', 'utf8')
  .match(/Mat khau\s*:\s*(\S+)/)[1];

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
  console.log('\n✅ KHỚP ĐƠN MBK-RQKPHJ (tiền thật 70.000đ)\n');

  const ord = await q(
    `SELECT id, code, status, total FROM orders WHERE code = 'MBK-RQKPHJ'`
  );
  if (!ord.length) { console.log('❌ Không tìm thấy'); return; }
  const o = ord[0];
  console.log(`  Đơn: ${o.code} | ${o.total}đ | ${o.status}`);

  if (o.status === 'delivered') {
    console.log('  ✅ Đã giao rồi');
    return;
  }

  // Login admin
  const lr = await fetch('https://xienhl.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  // Xác nhận thanh toán thật (số tiền đúng, ghi rõ mã GD SePay)
  const r = await fetch(`https://xienhl.com/api/admin/orders/${o.id}/confirm-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: JSON.stringify({
      amount: o.total,
      note: 'SePay FT26316271190752 — khách chuyển 05:17, webhook chưa nối',
    }),
  });
  const d = await r.json();
  console.log(`\n  Kết quả: ${r.status}`);
  console.log(`  ${JSON.stringify(d).slice(0, 300)}`);

  if (d.ok) {
    console.log(`\n  ✅ ${d.delivered ? 'ĐÃ GIAO KEY' : 'Đã xác nhận (chờ giao tay)'}`);
    const after = await q(
      `SELECT status FROM orders WHERE id = '${o.id}'`
    );
    console.log(`  Status: ${after[0]?.status}`);

    // Kiểm tra key
    const items = await q(
      `SELECT delivered_keys FROM order_items WHERE order_id = '${o.id}'`
    );
    let keys = [];
    try { keys = JSON.parse(items[0]?.delivered_keys || '[]'); } catch { /* */ }
    console.log(`  Key: ${keys.length} cái`);
    if (keys[0]) console.log(`    ${String(keys[0]).slice(0, 40)}`);
  }
})();
