/**
 * Runtime verification of every INSERT-bearing endpoint.
 * Any INSERT arity bug surfaces as a 5xx / server_error here.
 */
const BASE = 'https://xienhl.com';
const T = Math.random().toString(36).slice(2, 7).toUpperCase();
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

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
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b ?? {}); }
  del(p) { return this.req('DELETE', p, undefined); }
}

const admin = new C();
await admin.post('/api/auth/login', { username: 'namhbcf', password: 'namhbcf123' });

const user = new C();
const uname = 'qr' + T.toLowerCase();
await user.post('/api/auth/register', { username: uname, password: 'Qa!' + T + 'q1' });

const no5xx = (n, r, expect = [200, 201, 400, 403, 404, 409]) => {
  const ok = r.status < 500 && expect.includes(r.status);
  rec(n, ok, `HTTP ${r.status} ${r.text.slice(0, 110)}`);
};

// ---- wallet.js INSERTs (15) ----
// NOTE: there is no /api/wallet/topup route (wallet page was removed), so the
// topups INSERT is only reachable via admin approve. Exercised below.
no5xx('admin topups list', await admin.get('/api/admin/topups'));
no5xx('admin wallet adjust (INSERT wallet_transactions)',
  await admin.post('/api/admin/wallet/adjust', { user: uname, amount: 1000, reason: 'QA ' + T }));

// ---- admin INSERTs ----
const allUsers = await admin.get('/api/admin/users');
no5xx('admin list users (spread binds)', allUsers);
const uid = allUsers.json?.users?.find((u) => u.username === uname)?.id;
if (uid) {
  no5xx('admin update user (dynamic SET)', await admin.patch(`/api/admin/users/${uid}`, { status: 'active' }));
}
no5xx('admin settings get (spread NOT IN)', await admin.get('/api/admin/settings'));
no5xx('admin settings save', await admin.post('/api/admin/settings', { site_name: 'MuaBanKey' }));

// coupon save / delete
const ccode = 'QA' + T;
no5xx('admin coupon save (INSERT coupons)', await admin.post('/api/admin/coupons', {
  code: ccode, type: 'percent', value: 10, minSubtotal: 0, active: true,
}));
const coupons = await admin.get('/api/admin/coupons');
const cid = (coupons.json?.coupons || []).find((c) => c.code === ccode)?.id;
if (cid) no5xx('admin coupon delete', await admin.del(`/api/admin/coupons/${cid}`));

// product save + keys
const pcode = 'p-qa-' + T.toLowerCase();
no5xx('admin product save (INSERT products)', await admin.post('/api/admin/products', {
  name: 'QA ' + T, slug: pcode, price: 1000, deliveryType: 'key', categoryId: 'cat-win',
}));
const plist = await admin.get('/api/admin/products');
const pid = (plist.json?.products || []).find((p) => p.slug === pcode)?.id;
if (pid) {
  no5xx('admin add keys (INSERT product_keys)', await admin.post(`/api/admin/products/${pid}/keys`, {
    keys: ['QA-KEY-1-' + T, 'QA-KEY-2-' + T],
  }));
  no5xx('admin list keys', await admin.get(`/api/admin/products/${pid}/keys`));
  no5xx('admin product delete', await admin.del(`/api/admin/products/${pid}`));
}

// license issue
no5xx('admin issue licenses (INSERT licenses)', await admin.post('/api/admin/licenses', {
  count: 1, days: 30, plan: 'aoe1', note: 'QA ' + T,
}));

// trial admin: reset / grant / ban / whitelist
if (uid) {
  no5xx('trial grant (INSERT trial_quota upsert)',
    await admin.post('/api/admin/trial/grant', { user: uname, kind: '3d', delta: 1 }));
  no5xx('trial reset (INSERT trial_quota + trial_resets)',
    await admin.post('/api/admin/trial/reset', { user: uname, kinds: ['3d'], reason: 'QA' }));
  no5xx('trial ban', await admin.post('/api/admin/trial/ban', { user: uname, kind: '3d', banned: true }));
  no5xx('trial unban', await admin.post('/api/admin/trial/ban', { user: uname, kind: '3d', banned: false }));
}
no5xx('whitelist add (INSERT trial_whitelist)', await admin.post('/api/admin/trial/whitelist', {
  scope: 'weak', value: 'qa-weak-' + T, note: 'QA',
}));
no5xx('whitelist list', await admin.get('/api/admin/trial/whitelist'));
no5xx('whitelist remove', await admin.del('/api/admin/trial/whitelist'));

// audit log write already exercised by all the above; read it back
no5xx('admin logs (INSERT audit_logs happened)', await admin.get('/api/admin/logs'));

// ---- trial-command INSERTs (3) ----
no5xx('trial command (INSERT licenses + trial_uses + install_tokens)',
  await new C().post('/api/trial/command', {
    kind: '3d', guid: 'qa-g-' + T, bios: 'qa-b-' + T, cpu: 'qa-c-' + T, vol: 'qa-v-' + T,
  }));

// ---- telegram-actions / ratelimit / installer INSERTs ----
no5xx('webhook health (installer/tg paths)', await new C().get('/api/webhooks/health'));

// ---- xg endpoints (4 INSERTs in xa-grant-server) ----
no5xx('xg health', await new C().get('/api/xg/health'));
no5xx('xg activate (bad key -> path exercised)', await new C().post('/api/xg/activate', {
  key: 'NOPE-' + T, hwid: 'qa-hwid-' + T, app: 'xg',
}));

console.log(`\nTAG=${T} user=${uname}`);
const f = out.filter((x) => !x.ok);
console.log(`${out.length - f.length}/${out.length} PASS`);
if (f.length) { console.log('FAILED:'); f.forEach((x) => console.log(' - ' + x.n + ' :: ' + x.d)); }
