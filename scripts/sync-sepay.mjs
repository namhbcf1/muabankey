const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const SEPAY = 'H1RIWPEIYXVYVCAZ1BT9VNTLKG35XMZ0CY9FMKFEWHZFJH2LSNL6UUQGPV8OXBTA';

async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n🔗 ĐỒNG BỘ SEPAY ↔ HỆ THỐNG\n');

  /* ===== 1. SePay ===== */
  console.log('1️⃣  TÀI KHOẢN SEPAY');
  const h = { Authorization: `Bearer ${SEPAY}` };
  const banks = await fetch('https://my.sepay.vn/userapi/bankaccounts/list', { headers: h })
    .then((r) => r.json());
  for (const b of banks.bankaccounts || []) {
    console.log(`     ✅ ${b.bank_short_name} ${b.account_number}`);
    console.log(`        ${b.account_holder_name} | active=${b.active}`);
  }

  const tx = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=20', { headers: h })
    .then((r) => r.json());
  const txns = tx.transactions || [];
  console.log(`\n     Giao dịch: ${txns.length}`);
  for (const t of txns.slice(0, 5)) {
    console.log(`       ${t.transaction_date} | +${t.amount_in} | ${String(t.transaction_content || '').slice(0, 30)}`);
  }

  /* ===== 2. Settings hệ thống ===== */
  console.log('\n2️⃣  CẤU HÌNH HỆ THỐNG');
  const st = await q(
    `SELECT key, value FROM settings WHERE key LIKE 'bank%' ORDER BY key`
  );
  for (const r of st) console.log(`     ${r.key.padEnd(14)} = ${r.value}`);

  const match = st.find((r) => r.key === 'bank_account')?.value
    === (banks.bankaccounts || [])[0]?.account_number;
  console.log(`     ${match ? '✅' : '❌'} Khớp với SePay`);

  /* ===== 3. Test QR sinh ra ===== */
  console.log('\n3️⃣  QR SINH RA');
  const cfg = {};
  for (const r of st) cfg[r.key] = r.value;

  const testMemo = 'MBKTEST01';
  const qrUrl = `https://img.vietqr.io/image/MB-${cfg.bank_account}-compact2.svg?amount=70000&addInfo=${testMemo}`;
  console.log(`     ${qrUrl.slice(0, 100)}...`);

  // Kiểm tra ảnh QR có tải được
  const r = await fetch(qrUrl);
  console.log(`     QR tải được: ${r.status === 200 ? '✅' : '❌'} (${r.status})`);

  /* ===== 4. Đối soát ===== */
  console.log('\n4️⃣  ĐỐI SOÁT');
  const local = await q(
    `SELECT COUNT(*) AS n FROM payments WHERE method='sepay' AND COALESCE(is_test,0)=0`
  );
  console.log(`     GD thật trong hệ thống: ${local[0]?.n || 0}`);
  console.log(`     GD trên SePay: ${txns.length}`);
  if (txns.length > 0) {
    console.log('\n     Chi tiết GD SePay:');
    for (const t of txns) {
      const ref = String(t.reference_number || t.id || '');
      const known = await q('SELECT id FROM payments WHERE txn_ref = ?', [ref]);
      console.log(`       ${ref.slice(0, 20)} | ${t.amount_in}đ | ${known.length ? 'đã ghi' : 'CHƯA GHI'}`);
    }
  }
})();
