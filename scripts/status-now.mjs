const T = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const A = '5b62d10947844251d23e0eac532531dd';
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const SEPAY = 'H1RIWPEIYXVYVCAZ1BT9VNTLKG35XMZ0CY9FMKFEWHZFJH2LSNL6UUQGPV8OXBTA';
import { readFileSync } from 'node:fs';

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) return { err: j.errors?.[0]?.message };
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n📋 TÌNH TRẠNG HIỆN TẠI\n');

  /* 1. SePay webhook đã nhận gì chưa? */
  console.log('1️⃣  SEPAY WEBHOOK');
  try {
    const r = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=10', {
      headers: { Authorization: `Bearer ${SEPAY}` },
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const j = await r.json();
      const txns = (j.transactions || []).filter((t) => Number(t.amount_in) > 0);
      console.log(`   SePay có ${txns.length} GD tiền vào`);
      for (const t of txns.slice(0, 5)) {
        const ref = String(t.reference_number || '');
        const local = await q(
          `SELECT id, state FROM payments WHERE txn_ref = '${ref.replace(/'/g, "''")}' LIMIT 1`
        );
        console.log(`   ${t.transaction_date} | +${Number(t.amount_in).toLocaleString().padStart(8)}đ | "${String(t.transaction_content || '').slice(0, 26)}" ${local.length ? '✅đã ghi' : '❌CHƯA GHI'}`);
      }
    } else {
      console.log(`   ❌ Token SePay hết hạn (trả ${ct})`);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
  }

  /* 2. Đơn hàng */
  console.log('\n2️⃣  ĐƠN HÀNG');
  const byStatus = await q(
    `SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC`
  );
  for (const r of byStatus) console.log(`   ${String(r.status).padEnd(12)} ${r.n}`);

  const pend = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE status='pending' AND created_at > (strftime('%s','now')-86400)*1000`
  );
  console.log(`   → Đơn pending 24h qua: ${pend[0]?.n || 0}`);

  /* 3. Tiền chưa xử lý */
  console.log('\n3️⃣  TIỀN CHƯA XỬ LÝ');
  const un = await q(
    `SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS s
     FROM payments WHERE COALESCE(is_test,0)=0 AND state IN ('unmatched','wrong_amount','claimed')
     GROUP BY state`
  );
  if (!un.length) console.log('   ✅ Không có');
  for (const r of un) {
    console.log(`   ${String(r.state).padEnd(13)} ${String(r.n).padStart(3)} dòng — ${Number(r.s).toLocaleString()}đ`);
  }

  /* 4. Cấu hình */
  console.log('\n4️⃣  CẤU HÌNH');
  const st = await q(`SELECT key, value FROM settings WHERE key LIKE 'sepay%' OR key LIKE 'bank%' ORDER BY key`);
  for (const s of st) console.log(`   ${s.key.padEnd(20)} = ${s.value}`);

  const now = new Date();
  const vnHour = new Date(now.getTime() + 7 * 3600000).getUTCHours();
  const from = Number(st.find((s) => s.key === 'sepay_auto_from')?.value || 0);
  const to = Number(st.find((s) => s.key === 'sepay_auto_to')?.value || 12);
  const enabled = String(st.find((s) => s.key === 'sepay_auto_enabled')?.value || '1') !== '0';
  const inWin = enabled && vnHour >= from && vnHour < to;
  console.log(`\n   Giờ VN: ${vnHour}h → ${inWin ? 'TỰ ĐỘNG GIAO' : 'CHỜ ADMIN DUYỆT TELEGRAM'}`);

  /* 5. Health */
  console.log('\n5️⃣  HEALTH');
  for (const ep of ['/api/license/health', '/api/webhooks/health']) {
    try {
      const r = await fetch('https://xienhl.com' + ep);
      const d = await r.json();
      console.log(`   ${ep}: ${JSON.stringify(d).slice(0, 140)}`);
    } catch (e) {
      console.log(`   ${ep}: ❌`);
    }
  }

  /* 6. EXE */
  console.log('\n6️⃣  EXE');
  try {
    const d = await fetch('https://xienhl.com/api/app/version').then((r) => r.json());
    const local = 'tool/dist-nuitka/xa_nofog_pro.exe';
    let ok = '?';
    try {
      const crypto = await import('node:crypto');
      const buf = readFileSync(local);
      const h = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
      ok = h === d.sha256 ? '✅ khớp' : '❌ lệch';
    } catch { /* */ }
    console.log(`   v${d.version} | ${d.sizeText} | ${d.sha256.slice(0, 16)}... | local: ${ok}`);
  } catch { /* */ }

  /* 7. User test rác */
  console.log('\n7️⃣  DỮ LIỆU RÁC');
  const junk = await q(
    `SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@local' OR email LIKE '%@test.vn' OR email LIKE '%@invalid'`
  );
  console.log(`   User @local/@test/@invalid: ${junk[0]?.n || 0}`);
})();
