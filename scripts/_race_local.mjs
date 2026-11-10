/**
 * race-local.mjs — test race cần webhook secret (TG + SePay) trên worker local.
 * Local: http://127.0.0.1:8799
 * Secrets: WEBHOOK_SECRET=TEST_WEBHOOK_SECRET_0123456789abcdef
 *          TG_WEBHOOK_SECRET=TEST_TG_WEBHOOK_SECRET_0123456789
 *          TG_CHAT_ID=999888777
 */
import { createHash, randomUUID, randomBytes } from 'node:crypto';

const L = 'http://127.0.0.1:8799';
const WH = 'TEST_WEBHOOK_SECRET_0123456789abcdef';
const TGS = 'TEST_TG_WEBHOOK_SECRET_0123456789';
const TGC = '999888777';
const sha256b64 = (t) => createHash('sha256').update(t, 'utf8').digest('base64');

const out = [];
function rec(id, name, expect, actual, ok, extra) {
  out.push({ id, name, expect, actual, ok });
  const m = ok === true ? 'OK  ' : ok === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${m}] ${id} ${name}\n      kỳ vọng: ${expect}\n      thực tế : ${actual}${extra ? '\n      ' + extra : ''}`);
}

/* --- DB helper: dùng D1 REST? Không. Dùng route admin/health qua seeding file. --- */
async function j(path, opts = {}) {
  const r = await fetch(L + path, opts);
  return { status: r.status, data: await r.json().catch(() => null), sc: r.headers.get('set-cookie') };
}

/** Tạo user + session trực tiếp bằng cách gọi register (local không rate limit chặt) */
async function mkUser(tag, balance = 0) {
  const email = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}@local.vn`;
  const r = await j('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456', fullName: tag }),
  });
  if (r.status !== 201) throw new Error('register local: ' + r.status + ' ' + JSON.stringify(r.data));
  const cookie = r.sc.match(/mbk_session=[^;]+/)[0];
  const id = r.data.user.id;
  return {
    id, email, cookie,
    req(p, o = {}) {
      return fetch(L + p, {
        method: o.method || 'GET',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(o.headers || {}) },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      }).then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
    },
  };
}
async function mkAdmin() {
  // admin đầu tiên: nâng role qua sqlite → không có route. Thử tạo qua seed rồi update.
  const email = `adm-${Date.now().toString(36)}@local.vn`;
  const r = await j('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Adm123456', fullName: 'Admin Local' }),
  });
  const cookie = r.sc.match(/mbk_session=[^;]+/)[0];
  return { id: r.data.user.id, email, cookie };
}
const adminReq = (a, p, o = {}) => fetch(L + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
  body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
}).then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));

async function main() {
  console.log('\n== RACE TEST LOCAL (telegram + sepay) ==');
  const h = await j('/api/health');
  if (h.status !== 200) throw new Error('local worker không chạy');
  console.log('local worker OK:', JSON.stringify(h.data));

  const admin = await mkAdmin();
  console.log('admin tạo:', admin.email, '(role=user — sẽ nâng bằng file SQL)');
  process.stdout.write(admin.id);   // in để script bash nâng role
  console.log('\nADMIN_ID=' + admin.id);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
