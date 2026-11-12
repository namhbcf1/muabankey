/**
 * QA: admin login + confirm-payment on a stuck order (rescue path).
 * Usage: node qa/admin-confirm.mjs <orderId>
 */
const BASE = 'https://xienhl.com';

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body) {
    const h = {};
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(BASE + path, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.getSetCookie?.() || [];
    const c = sc.map((s) => s.split(';')[0]).find((s) => s.startsWith('mbk_session='));
    if (c) this.cookie = c;
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b); }
}

const orderId = process.argv[2];
if (!orderId) { console.error('need orderId'); process.exit(1); }

const a = new Client();
const login = await a.post('/api/auth/login', { username: 'namhbcf', password: 'namhbcf123' });
console.log('admin login ->', login.status, login.text.slice(0, 200));

const dash = await a.get('/api/admin/dashboard');
console.log('dashboard ->', dash.status, JSON.stringify(dash.json).slice(0, 400));

const pays = await a.get('/api/admin/payments?limit=5');
console.log('payments ->', pays.status, JSON.stringify(pays.json?.stats));
console.log('recent:', JSON.stringify((pays.json?.payments || []).slice(0, 3)));

const before = await a.get(`/api/admin/orders?q=MBK-STNGN9`);
console.log('order before ->', JSON.stringify(before.json).slice(0, 300));

const conf = await a.post(`/api/admin/orders/${orderId}/confirm-payment`, { amount: 180000, note: 'QA test' });
console.log('confirm-payment ->', conf.status, JSON.stringify(conf.json).slice(0, 600));

const conf2 = await a.post(`/api/admin/orders/${orderId}/confirm-payment`, { amount: 180000 });
console.log('confirm-payment 2nd (idempotency) ->', conf2.status, JSON.stringify(conf2.json).slice(0, 400));

const recon = await a.get('/api/admin/sepay/reconcile?days=1');
console.log('sepay reconcile ->', recon.status, JSON.stringify(recon.json).slice(0, 500));

const quota = await a.get('/api/admin/sepay/quota');
console.log('sepay quota ->', quota.status, JSON.stringify(quota.json).slice(0, 400));

const tstatus = await a.get('/api/admin/telegram/status');
console.log('tg status ->', tstatus.status, JSON.stringify(tstatus.json).slice(0, 300));
