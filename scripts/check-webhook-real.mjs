const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const SEPAY = 'H1RIWPEIYXVYVCAZ1BT9VNTLKG35XMZ0CY9FMKFEWHZFJH2LSNL6UUQGPV8OXBTA';

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
  console.log('\n🔍 WEBHOOK CÓ NHẬN GIAO DỊCH THẬT?\n');

  const h = { Authorization: `Bearer ${SEPAY}` };
  const tx = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=20', { headers: h })
    .then((r) => r.json());
  const txns = (tx.transactions || []).filter((t) => Number(t.amount_in) > 0);

  console.log(`SePay có ${txns.length} giao dịch tiền vào:\n`);

  for (const t of txns) {
    const ref = String(t.reference_number || t.id || '');
    const local = await q(
      `SELECT id, amount, state, method, is_test FROM payments WHERE txn_ref = '${ref.replace(/'/g, "''")}' LIMIT 1`
    );
    const ts = t.transaction_date;
    const known = local.length > 0;

    console.log(`${ts} | +${Number(t.amount_in).toLocaleString()}đ`);
    console.log(`  nội dung: "${String(t.transaction_content || '').slice(0, 40)}"`);
    console.log(`  ref     : ${ref}`);
    console.log(`  ${known ? '✅ ĐÃ GHI' : '❌ CHƯA GHI'} ${known ? `(${local[0].state}, ${local[0].method})` : ''}`);
    console.log('');
  }

  /* ===== Kiểm tra cấu hình webhook trong DB ===== */
  const setts = await q(
    `SELECT key, value FROM settings WHERE key LIKE 'sepay%' OR key LIKE 'bank%' ORDER BY key`
  );
  console.log('CẤU HÌNH:');
  for (const s of setts) console.log(`  ${s.key.padEnd(20)} = ${s.value}`);

  /* ===== Kết luận ===== */
  const unrecorded = [];
  for (const t of txns) {
    const ref = String(t.reference_number || t.id || '');
    const local = await q(`SELECT id FROM payments WHERE txn_ref = '${ref.replace(/'/g, "''")}'`);
    if (!local.length) unrecorded.push(t);
  }

  console.log('\n' + '═'.repeat(56));
  if (unrecorded.length === 0 && txns.length > 0) {
    console.log('✅ Webhook HOẠT ĐỘNG — mọi GD SePay đã được ghi nhận');
  } else if (txns.length === 0) {
    console.log('⚠️  Chưa có giao dịch nào trên SePay');
  } else {
    console.log(`🔴 ${unrecorded.length}/${txns.length} GD SePay CHƯA được webhook ghi nhận`);
    console.log('\nNguyên nhân có thể:');
    console.log('  1. SePay chưa cấu hình webhook URL');
    console.log('  2. WEBHOOK_SECRET không khớp');
    console.log('  3. SePay gọi nhưng 401 (secret sai)');
    console.log('\nKiểm tra: my.sepay.vn → Tích hợp Webhooks');
    console.log('  URL: https://xienhl.com/api/webhooks/sepay');
    console.log('  Auth: Apikey <WEBHOOK_SECRET>');
    console.log('  Sự kiện: Tiền vào');
  }
})();
