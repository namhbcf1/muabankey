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
  if (!j.success) return { err: j.errors?.[0]?.message };
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n🔎 CHI TIẾT 3 VẤN ĐỀ\n');

  /* 1. 5 dòng unmatched 2.52tr */
  console.log('1️⃣  5 GIAO DỊCH CHƯA GÁN ĐƠN (2.520.000đ)');
  const un = await q(
    `SELECT id, amount, state, txn_ref, content, at, method
     FROM payments
     WHERE COALESCE(is_test,0)=0 AND state IN ('unmatched','wrong_amount')
     ORDER BY at DESC`
  );
  for (const p of un) {
    const d = new Date(p.at * 1000).toLocaleString('vi-VN');
    console.log(`   ${d} | ${String(p.amount).padStart(8)}đ | ${p.state}`);
    console.log(`     nội dung: "${String(p.content || '').slice(0, 50)}"`);
    console.log(`     ref     : ${p.txn_ref || '(không có)'}`);

    // Thử tìm đơn khớp theo số tiền
    if (Number(p.amount) > 0) {
      const cand = await q(
        `SELECT code, status, total, created_at FROM orders
         WHERE total = ${Number(p.amount)}
           AND ABS(created_at/1000 - ${p.at}) < 7200
         ORDER BY ABS(created_at/1000 - ${p.at}) LIMIT 2`
      );
      if (cand.length) {
        for (const c of cand) {
          console.log(`     → đơn khớp tiền: ${c.code} (${c.status})`);
        }
      }
    }
  }

  /* 2. 157 đơn expired — nguyên nhân? */
  console.log('\n2️⃣  157 ĐƠN EXPIRED');
  const exp = await q(
    `SELECT COUNT(*) AS n FROM orders
     WHERE status='expired' AND created_at > (strftime('%s','now')-86400)*1000`
  );
  const expTotal = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE status='expired'`
  );
  console.log(`   Tổng expired: ${expTotal[0]?.n}`);
  console.log(`   Trong 24h qua: ${exp[0]?.n}`);

  const expSample = await q(
    `SELECT code, total, created_at, payment_ref FROM orders
     WHERE status='expired' ORDER BY created_at DESC LIMIT 3`
  );
  for (const o of expSample) {
    const age = Math.floor((Date.now() - o.created_at) / 3600000);
    console.log(`   ${o.code} | ${o.total}đ | ${age}h trước | memo ${o.payment_ref || '?'}`);
  }

  /* 3. 241 user rác */
  console.log('\n3️⃣  241 USER RÁC');
  const junk = await q(
    `SELECT
       SUM(CASE WHEN email LIKE '%@local' THEN 1 ELSE 0 END) AS local_,
       SUM(CASE WHEN email LIKE '%@test.vn' THEN 1 ELSE 0 END) AS testvn,
       SUM(CASE WHEN email LIKE '%@invalid' THEN 1 ELSE 0 END) AS invalid_
     FROM users`
  );
  console.log(`   @local   : ${junk[0]?.local_ || 0}`);
  console.log(`   @test.vn : ${junk[0]?.testvn || 0}`);
  console.log(`   @invalid : ${junk[0]?.invalid_ || 0}`);
  console.log('   (@invalid là email nội bộ hợp lệ của user thật — KHÔNG phải rác)');

  /* 4. Test để lại setting gì? */
  console.log('\n4️⃣  SETTING DO TEST ĐỂ LẠI');
  const st = await q(`SELECT key, value FROM settings WHERE key='sepay_auto_enabled'`);
  console.log(`   sepay_auto_enabled = ${st[0]?.value} ${st[0]?.value === '0' ? '❌ (test để lại, phải là 1)' : '✅'}`);
})();
