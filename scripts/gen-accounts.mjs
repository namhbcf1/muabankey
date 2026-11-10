/**
 * Sinh file seed với hash mật khẩu thật (PBKDF2-SHA256, 100k vòng)
 * để khớp với logic xác thực trong Worker.
 * 100.000 là giới hạn tối đa Cloudflare Workers cho phép với PBKDF2.
 */
import { writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 100000;
const enc = new TextEncoder();

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: b64(bits), salt: b64(salt) };
}

const accounts = [
  { email: 'admin@muabankey.vn', password: 'Admin@123456', name: 'Quản trị viên', phone: '0900000000', role: 'admin', balance: 0, id: 'u-admin' },
  { email: 'demo@muabankey.vn', password: 'Demo@123456', name: 'Khách Demo', phone: '0912345678', role: 'user', balance: 500000, id: 'u-demo' },
];

const now = Date.now();
const rows = [];

for (const a of accounts) {
  const { hash, salt } = await hashPassword(a.password);
  rows.push(`('${a.id}','${a.email}','${hash}','${salt}','${a.name}','${a.phone}','${a.role}','active',${a.balance},${now},${now})`);
}

const sql = `-- Tài khoản khởi tạo (mật khẩu đã hash PBKDF2-SHA256)
DELETE FROM reviews;
DELETE FROM wallet_transactions;
DELETE FROM users WHERE email IN ('admin@muabankey.vn','demo@muabankey.vn');

INSERT INTO users (id,email,password_hash,password_salt,full_name,phone,role,status,balance,created_at,updated_at) VALUES
${rows.join(',\n')};

-- Giao dịch ví khởi tạo cho tài khoản demo
INSERT INTO wallet_transactions (id,user_id,type,amount,balance_after,status,reference,description,created_at) VALUES
('wt-demo-1','u-demo','admin_credit',500000,500000,'success','SEED','Tặng 500.000₫ cho tài khoản demo',${now});

-- Đánh giá mẫu
INSERT INTO reviews (id,product_id,user_id,rating,comment,created_at) VALUES
('r1','p-win11','u-demo',5,'Kích hoạt online trong 30 giây, key retail thật sự. Rất đáng tiền!',${now - 86400000 * 6}),
('r2','p-chatgpt','u-demo',5,'Tài khoản dùng ổn định, có email riêng nên không lo. Shop hỗ trợ nhanh.',${now - 86400000 * 4}),
('r3','p-netflix','u-demo',4,'4K nét, profile riêng ổn. Lâu lâu phải chờ đổi mới nhưng shop phản hồi nhanh.',${now - 86400000 * 2});
`;

writeFileSync(new URL('../db/accounts.sql', import.meta.url), sql, 'utf8');
console.log('✅ Đã tạo db/accounts.sql');
for (const a of accounts) {
  console.log(`   ${a.role.padEnd(5)} ${a.email.padEnd(24)} mật khẩu: ${a.password}`);
}
