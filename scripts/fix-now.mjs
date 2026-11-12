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
  console.log('\n🔧 SỬA SETTING + DỌN DỮ LIỆU TEST\n');

  /* 1. Bật lại cửa sổ giờ */
  await q("UPDATE settings SET value = '1' WHERE key = 'sepay_auto_enabled'");
  await new Promise((r) => setTimeout(r, 3000));
  const st = await q("SELECT value FROM settings WHERE key = 'sepay_auto_enabled'");
  console.log(`1️⃣  sepay_auto_enabled = ${st[0]?.value} ${st[0]?.value === '1' ? '✅' : '❌'}`);

  /* 2. Xoá 4 dòng test KHONGCOMA do tôi tạo */
  const fake = await q(
    `SELECT id, txn_ref FROM payments
     WHERE COALESCE(is_test,0)=0
       AND (content = 'KHONGCOMA' OR txn_ref LIKE 'X1794%')`
  );
  console.log(`\n2️⃣  GD TEST do tôi tạo: ${fake.length} dòng`);
  for (const f of fake) console.log(`   ${f.txn_ref}`);

  if (fake.length > 0) {
    await q(
      `DELETE FROM payments
       WHERE COALESCE(is_test,0)=0
         AND (content = 'KHONGCOMA' OR txn_ref LIKE 'X1794%')`
    );
    const after = await q(
      `SELECT COUNT(*) AS n FROM payments
       WHERE COALESCE(is_test,0)=0 AND (content='KHONGCOMA' OR txn_ref LIKE 'X1794%')`
    );
    console.log(`   → Đã xoá. Còn: ${after[0]?.n || 0}`);
  }

  /* 3. GD thật còn lại */
  console.log('\n3️⃣  GD THẬT CÒN LẠI (cần admin xử lý)');
  const real = await q(
    `SELECT amount, content, txn_ref, at, state FROM payments
     WHERE COALESCE(is_test,0)=0 AND state IN ('unmatched','wrong_amount')
     ORDER BY at DESC`
  );
  if (!real.length) {
    console.log('   ✅ Không còn');
  } else {
    for (const p of real) {
      const d = new Date(p.at * 1000).toLocaleString('vi-VN');
      console.log(`   ${d} | ${String(p.amount).padStart(8)}đ | ${p.state}`);
      console.log(`     "${String(p.content || '').slice(0, 45)}" | ${p.txn_ref}`);
    }
  }

  /* 4. Đếm đơn expired hôm nay */
  console.log('\n4️⃣  ĐƠN EXPIRED');
  const exp = await q(
    `SELECT COUNT(*) AS n FROM orders
     WHERE status='expired' AND created_at > (strftime('%s','now')-43200)*1000`
  );
  console.log(`   12 giờ qua: ${exp[0]?.n || 0}`);
  console.log('   (Expired là bình thường — khách tạo đơn không chuyển tiền,');
  console.log('    cron tự đóng sau 45 phút. Không phải lỗi.)');
})();
