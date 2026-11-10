/**
 * Setup: tạo tài khoản local bằng API thật, rồi nâng quyền admin qua D1.
 * Chạy 1 lần trước khi test.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SQL = 'security-audit/setup-done.sql';

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}

const accounts = [
  { email: 'admin@muabankey.vn', password: 'namhbcf123', fullName: 'Nguyen Thanh Nam', role: 'admin', username: 'namhbcf' },
  { email: 'demo@muabankey.vn', password: 'Demo@123456', fullName: 'Khach Demo', role: 'user', username: 'demo', balance: 500000 },
  { email: 'staff@muabankey.vn', password: 'Staff@123456', fullName: 'Nhan Vien', role: 'staff', username: 'staff' },
  { email: 'user2@muabankey.vn', password: 'User2@123456', fullName: 'Khach Hai', role: 'user', username: 'user2' },
];

const sqlLines = [];
for (const a of accounts) {
  const r = await post('/api/auth/register', {
    email: a.email, password: a.password, fullName: a.fullName,
  });
  console.log(`register ${a.email}: ${r.status} ${r.json?.ok ? 'OK' : r.text.slice(0, 120)}`);
  sqlLines.push(`UPDATE users SET role='${a.role}', username='${a.username}'${a.balance ? `, balance=${a.balance}` : ''} WHERE email='${a.email}';`);
}

// Xoá session đã tạo lúc register để test sạch
sqlLines.push('DELETE FROM sessions;');

writeFileSync(SQL, sqlLines.join('\n') + '\n', 'utf8');
console.log('\n--- SQL ---\n' + sqlLines.join('\n'));

try {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'muabankey-audit-db', '--local',
    '--config', 'wrangler.audit.toml', `--file=./${SQL}`,
  ], { encoding: 'utf8', shell: true });
  const fails = (out.match(/"success": false/g) || []).length;
  console.log(`\nD1 apply done. failures=${fails}`);
  if (fails) console.log(out.slice(-2000));
} catch (e) {
  console.error('D1 apply FAILED:', e.stdout || e.message);
  process.exit(1);
}
