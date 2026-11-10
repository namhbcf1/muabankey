/**
 * Sinh db/seed-credentials.sql — credential tài khoản cho sản phẩm delivery_type='account'.
 * Mỗi secret = base64("email|password") để trang thanh toán giải mã hiển thị.
 */
import { writeFileSync } from 'node:fs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const now = 1731000000000;

/** [productId, slug tiền tố, số lượng, nhãn ghi chú, domain] */
const groups = [
  ['p-365',       'm365',     6,  'Microsoft 365 Family — 1 slot',      'ms365.muabankey.vn'],
  ['p-chatgpt',   'gpt',      8,  'ChatGPT Plus — 1 tháng',             'gpt.muabankey.vn'],
  ['p-claude',    'claude',   6,  'Claude Pro — 1 tháng',               'claude.muabankey.vn'],
  ['p-gemini',    'gemini',   5,  'Gemini Advanced — 1 tháng',          'gemini.muabankey.vn'],
  ['p-perplexity','pplx',     5,  'Perplexity Pro — 1 tháng',           'pplx.muabankey.vn'],
  ['p-adobe',     'adobe',    4,  'Adobe Creative Cloud — 12 tháng',    'adobe.muabankey.vn'],
  ['p-figma',     'figma',    3,  'Figma Professional — 12 tháng',      'figma.muabankey.vn'],
  ['p-netflix',   'nfx',      10, 'Netflix Premium — 1 profile',        'nfx.muabankey.vn'],
  ['p-spotify',   'spo',      8,  'Spotify Premium — 1 tháng',          'spo.muabankey.vn'],
  ['p-yt',        'yt',       6,  'YouTube Premium — 12 tháng',         'yt.muabankey.vn'],
  ['p-copilot',   'ghc',      5,  'GitHub Copilot Pro — 1 tháng',       'ghc.muabankey.vn'],
  ['p-jetbrains', 'jb',       3,  'JetBrains All Products — 12 tháng',  'jb.muabankey.vn'],
];

const rows = [];
for (const [productId, prefix, count, note, domain] of groups) {
  for (let i = 1; i <= count; i++) {
    const nn = String(i).padStart(2, '0');
    const email = `${prefix}${nn}@${domain}`;
    const password = `Mbk${prefix.toUpperCase()}@2025#${nn}`;
    const secret = b64(`${email}|${password}`);
    const id = `k-${prefix}-${nn}`;
    rows.push(`('${id}','${productId}','${secret}','${note} #${i}','available',${now})`);
  }
}

const sql = `-- ============================================================
-- Credential tài khoản cho sản phẩm delivery_type='account'
-- secret = base64("email|mật khẩu"). Sinh tự động bởi scripts/gen-credentials.mjs
-- ============================================================

DELETE FROM product_keys WHERE product_id IN (${groups.map((g) => `'${g[0]}'`).join(',')});

INSERT INTO product_keys (id, product_id, secret, note, status, created_at) VALUES
${rows.join(',\n')};

-- Đồng bộ tồn kho theo số credential thực tế
UPDATE products
SET stock_count = (SELECT COUNT(*) FROM product_keys k WHERE k.product_id = products.id AND k.status = 'available')
WHERE delivery_type != 'manual';
`;

writeFileSync(new URL('../db/seed-credentials.sql', import.meta.url), sql, 'utf8');

// Tự kiểm tra round-trip
let bad = 0;
for (const [productId, prefix, count, , domain] of groups) {
  for (let i = 1; i <= count; i++) {
    const nn = String(i).padStart(2, '0');
    const email = `${prefix}${nn}@${domain}`;
    const password = `Mbk${prefix.toUpperCase()}@2025#${nn}`;
    const decoded = Buffer.from(b64(`${email}|${password}`), 'base64').toString('utf8');
    if (decoded !== `${email}|${password}`) bad++;
  }
}

const total = rows.length;
console.log(`✅ Đã tạo db/seed-credentials.sql — ${total} credential, ${groups.length} sản phẩm`);
console.log(`   Kiểm tra round-trip: ${bad === 0 ? 'PASS' : 'FAIL (' + bad + ')'}`);
console.log('   Ví dụ:', Buffer.from(b64('nfx01@nfx.muabankey.vn|MbkNFX@2025#01'), 'base64').toString('utf8'));
