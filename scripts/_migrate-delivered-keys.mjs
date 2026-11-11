/**
 * Migrate `order_items.delivered_keys` từ plaintext JSON sang AES-256-GCM.
 *
 * Vì sao cần script riêng: mã hoá dùng `env.KEY_ENC` nằm trong Worker secret,
 * không đọc được từ ngoài. Nên phải chạy TRONG Worker — gọi qua HTTP endpoint
 * tạm, hoặc qua wrangler dev với secret local.
 *
 * Cách dùng: gọi endpoint /api/admin/migrate-delivered-keys (chỉ admin thật),
 * script này gửi request và kiểm kết quả.
 */
const BASE = process.argv[2] || 'https://xienhl.com';
const USER = process.argv[3];
const PASS = process.argv[4];

if (!USER || !PASS) {
  console.error('Dùng: node scripts/_migrate-delivered-keys.mjs <base> <admin-user> <admin-pass>');
  process.exit(1);
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (!login.ok) {
  console.error('Đăng nhập thất bại:', login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers.get('set-cookie')?.split(';')[0];
console.log('Đăng nhập OK');

const res = await fetch(`${BASE}/api/admin/migrate-delivered-keys`, {
  method: 'POST',
  headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirm: true }),
});
const text = await res.text();
console.log('status:', res.status);
console.log(text.slice(0, 800));
