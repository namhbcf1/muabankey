/**
 * Harness test bảo mật — chạy trên wrangler dev LOCAL (127.0.0.1:8787).
 * Mỗi test dùng IP riêng để không vướng rate-limit toàn cục.
 */
import { makeClient, nextIp } from './http.mjs';

export { makeClient, nextIp };

export const results = [];
export const notes = [];

export function record(id, vector, verdict, severity, evidence, fix) {
  results.push({ id, vector, verdict, severity, evidence: String(evidence).slice(0, 600), fix });
  const icon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢', OK: '✅' }[severity] || '?';
  console.log(`${icon} #${id} ${vector}\n     -> ${verdict}\n     ${String(evidence).slice(0, 220)}`);
}

export function note(s) { notes.push(s); console.log('   .. ' + s); }

export const ACCOUNTS = {
  admin: { email: 'admin@muabankey.vn', password: 'namhbcf123', username: 'namhbcf' },
  demo: { email: 'demo@muabankey.vn', password: 'Demo@123456', username: 'demo' },
  staff: { email: 'staff@muabankey.vn', password: 'Staff@123456', username: 'staff' },
  user2: { email: 'user2@muabankey.vn', password: 'User2@123456', username: 'user2' },
};

export async function loginAs(who) {
  const c = makeClient(who);
  const a = ACCOUNTS[who];
  const r = await c.login(a.email, a.password);
  if (r.status !== 200) throw new Error(`login ${who} failed: ${r.status} ${r.text}`);
  return c;
}

/** Đăng ký user mới với email ngẫu nhiên, trả client đã có session. */
export async function freshUser(prefix = 'u') {
  const c = makeClient(prefix);
  const email = `${prefix}${Date.now()}${Math.floor(Math.random() * 1e6)}@test.local`;
  const r = await c.post('/api/auth/register', {
    email, password: 'Test@123456', fullName: 'Test User',
  });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${r.text}`);
  c._email = email;
  c._id = r.json.user.id;
  return c;
}
