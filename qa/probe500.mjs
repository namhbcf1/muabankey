/** Probe every GET endpoint as admin + user, flag any 5xx. */
/* Chạy: QA_BASE=http://127.0.0.1:8787 node qa/probe500.mjs — chỉ ĐỌC. */
import { target, adminCredentials } from './qa-guard.mjs';

const BASE = target().base;

class C {
  constructor() { this.cookie = ''; }
  async req(m, p, b) {
    const h = {};
    if (this.cookie) h.cookie = this.cookie;
    if (b !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    const sc = r.headers.getSetCookie?.() || [];
    const c = sc.map((s) => s.split(';')[0]).find((s) => s.startsWith('mbk_session='));
    if (c) this.cookie = c;
    const t = await r.text();
    return { status: r.status, text: t };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
}

const admin = new C();
await admin.post('/api/auth/login', adminCredentials());

const user = new C();
const u = 'qp' + Math.random().toString(36).slice(2, 8);
await user.post('/api/auth/register', { username: u, password: 'Qa!' + Math.random().toString(36).slice(2, 8) + 'x1' });

const paths = [
  '/api/health', '/api/stats', '/api/categories', '/api/products',
  '/api/products/featured', '/api/products/p-lic-month',
  '/api/auth/me', '/api/orders', '/api/licenses/mine', '/api/licensing',
  '/api/trial/status', '/api/app/version', '/api/license/health',
  '/api/webhooks/health', '/api/wallet', '/api/xg/health',
  '/api/admin/dashboard', '/api/admin/users', '/api/admin/orders',
  '/api/admin/payments', '/api/admin/licenses', '/api/admin/settings',
  '/api/admin/coupons', '/api/admin/logs', '/api/admin/products',
  '/api/admin/topups', '/api/admin/sepay/quota', '/api/admin/sepay/reconcile',
  '/api/admin/trial/accounts', '/api/admin/trial/uses', '/api/admin/trial/resets',
  '/api/admin/trial/whitelist', '/api/admin/telegram/status',
  '/api/admin/products/p-lic-month/keys',
];

const bad = [];
for (const who of [['anon', new C()], ['user', user], ['admin', admin]]) {
  const [label, c] = who;
  for (const p of paths) {
    const r = await c.get(p);
    if (r.status >= 500) {
      bad.push({ who: label, p, status: r.status, body: r.text.slice(0, 200) });
      console.log(`5xx  ${label} ${p} -> ${r.status}  ${r.text.slice(0, 160)}`);
    } else if (r.status === 404 && label === 'admin' && p.startsWith('/api/admin')) {
      console.log(`404  ${label} ${p}`);
    }
  }
}

console.log('\n=== 5xx SUMMARY ===');
if (!bad.length) console.log('(none)');
for (const b of bad) console.log(`${b.who} ${b.p} -> ${b.status} :: ${b.body}`);
