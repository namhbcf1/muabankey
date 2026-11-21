/** QA: refund path (money-critical) — refund, then double-refund must be blocked. */
/* Chạy: QA_BASE=http://127.0.0.1:8787 node qa/refund-test.mjs <orderId> */
import { target, assertWritable, adminCredentials } from './qa-guard.mjs';

const t = target();
assertWritable(t, { writes: true });
const BASE = t.base;
const ORDER = process.argv[2];

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
    return { status: r.status, text: await r.text() };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
}

const a = new C();
await a.post('/api/auth/login', adminCredentials());

console.log('refund 1 ->', (await a.post(`/api/admin/orders/${ORDER}/refund`, {})).text.slice(0, 300));
console.log('refund 2 ->', (await a.post(`/api/admin/orders/${ORDER}/refund`, {})).text.slice(0, 300));
console.log('refund 3 ->', (await a.post(`/api/admin/orders/${ORDER}/refund`, {})).text.slice(0, 300));

const o = await a.get(`/api/admin/orders?q=${process.argv[3] || ''}`);
console.log('orders ->', o.text.slice(0, 300));

const pays = await a.get('/api/admin/payments?limit=3');
console.log('payments stats ->', JSON.parse(pays.text).stats);
