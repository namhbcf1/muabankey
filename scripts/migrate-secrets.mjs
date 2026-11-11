/**
 * Migrate 94 secret plaintext cũ sang dạng mã hoá.
 * Gọi qua API admin tự viết: đọc từng key, mã hoá, ghi lại.
 *
 * Chạy: node scripts/migrate-secrets.mjs
 */
const T = process.env.CLOUDFLARE_API_TOKEN;
if (!T || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('Thiếu CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const B = 'https://xienhl.com';

import { readFileSync } from 'node:fs';

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

/** Mã hoá bằng cùng thuật toán với src/lib/secrets.js (AES-256-GCM). */
async function seal(keyHex, plain) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(keyHex.substr(i * 2, 2), 16);
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  );
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv, 0);
  all.set(ct, iv.length);
  let s = '';
  for (const b of all) s += String.fromCharCode(b);
  return 'enc1:' + btoa(s);
}

(async () => {
  console.log('\n🔐 MIGRATE SECRET SANG MÃ HOÁ\n');

  const keyHex = readFileSync('.key-enc.txt', 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(keyHex)) {
    console.error('❌ .key-enc.txt không hợp lệ');
    process.exit(1);
  }

  const rows = await q(
    "SELECT id, secret FROM product_keys WHERE secret NOT LIKE 'enc1:%'"
  );
  console.log(`  Cần migrate: ${rows.length} key`);

  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      const sealed = await seal(keyHex, r.secret);
      await q('UPDATE product_keys SET secret = ? WHERE id = ?', [sealed, r.id]);
      ok++;
      if (ok % 20 === 0) process.stdout.write(`  ...${ok}/${rows.length}\n`);
    } catch (e) {
      fail++;
      console.error(`  ❌ ${r.id}: ${e.message}`);
    }
  }

  console.log(`\n  ✅ Migrate xong: ${ok} thành công, ${fail} lỗi`);

  // Kiểm tra
  const c = await q(`SELECT
    SUM(CASE WHEN secret LIKE 'enc1:%' THEN 1 ELSE 0 END) AS sealed,
    SUM(CASE WHEN secret NOT LIKE 'enc1:%' THEN 1 ELSE 0 END) AS plain
    FROM product_keys`);
  console.log(`  Đã mã hoá: ${c[0].sealed}, còn plain: ${c[0].plain}`);
})();
