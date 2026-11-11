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
  console.log('\n🔍 KIỂM TRA SCHEMA THANH TOÁN\n');

  const tables = await q(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('payments','topups','wallet_transactions')"
  );
  const names = tables.map((t) => t.name);
  console.log('  payments          :', names.includes('payments') ? '✅ CÓ' : '❌ KHÔNG');
  console.log('  topups (giữ)      :', names.includes('topups') ? '✅' : '—');
  console.log('  wallet_tx (giữ)   :', names.includes('wallet_transactions') ? '✅' : '—');

  const cols = await q('PRAGMA table_info(orders)');
  const cn = cols.map((c) => c.name);
  for (const c of ['qr_expires_at', 'confirmed_by', 'admin_note', 'telegram_msg', 'reminded_at']) {
    console.log(`  orders.${c.padEnd(16)}:`, cn.includes(c) ? '✅' : '❌');
  }
})();
