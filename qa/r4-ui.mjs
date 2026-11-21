/**
 * QA UI qua CDP — KHÔNG hardcode domain hay mật khẩu admin.
 * Chạy: QA_BASE=http://127.0.0.1:8787 QA_ADMIN_USER=... QA_ADMIN_PASSWORD=... node qa/r4-ui.mjs
 */
import { target, assertWritable } from './qa-guard.mjs';

const t = target();
assertWritable(t, { writes: true });
const CDP = process.env.QA_CDP || 'http://127.0.0.1:9333';
const BASE = t.base;
const fs = await import('node:fs');

const ADMIN_USER = String(process.env.QA_ADMIN_USER || '').trim();
const ADMIN_PASSWORD = String(process.env.QA_ADMIN_PASSWORD || '').trim();
if (!ADMIN_USER || !ADMIN_PASSWORD) {
  throw new Error(
    'Thiếu QA_ADMIN_USER / QA_ADMIN_PASSWORD. Bản cũ nhúng cứng tài khoản admin ' +
    'thật trong file được git theo dõi — không được lặp lại.'
  );
}

const lg = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
});
const sess = ((lg.headers.getSetCookie?.() || []).join(';').match(/mbk_session=([^;]+)/) || [])[1];

class Sess {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); }
  static async connect(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const s = new Sess(ws);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && s.p.has(m.id)) { s.p.get(m.id)(m); s.p.delete(m.id); } };
    return s;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => this.p.set(id, r));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) };
    return { value: r.result?.result?.value };
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

const t = await (await fetch(CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const s = await Sess.connect(t.webSocketDebuggerUrl);
await s.send('Runtime.enable');
await s.send('Page.enable');
await s.send('Network.enable');
await s.send('Network.setCookie', { name: 'mbk_session', value: sess, domain: 'xienhl.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });

let errs = [];
s.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('CON: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
});

const TABS = ['dashboard', 'orders', 'topups', 'products', 'keys', 'licenses', 'trial', 'whitelist', 'users', 'settings', 'logs'];
const rep = [];
for (const tab of TABS) {
  errs = [];
  await s.send('Page.navigate', { url: `${BASE}/#/admin?tab=${tab}` });
  await new Promise((r) => setTimeout(r, 3800));
  const info = await s.eval(`(()=>{
    const c=document.querySelector('#admin-content');
    const nav=[...document.querySelectorAll('[data-tab]')].length;
    const t=(c?c.innerText:'').replace(/\\s+/g,' ').trim();
    return JSON.stringify({nav, len:t.length, text:t.slice(0,200), path:location.pathname+location.hash});
  })()`);
  const p = JSON.parse(info.value || '{}');
  const e2 = errs.filter((x) => !/cloudflareinsights|beacon|Failed to load resource/i.test(x));
  rep.push({ tab, ...p, errors: e2 });
  console.log(`\n[${tab}] nav=${p.nav} chars=${p.len}`);
  console.log('  ', JSON.stringify(p.text || '').slice(0, 190));
  console.log('  errors:', e2.length ? e2 : 'none');
  if (['topups', 'users', 'orders', 'dashboard'].includes(tab)) {
    const sh = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`qa/ui-${tab}.png`, Buffer.from(sh.result.data, 'base64'));
  }
}

console.log('\n===== SUMMARY =====');
console.log('tabs with JS errors:', rep.filter((r) => r.errors.length).map((r) => r.tab).join(',') || 'none');
console.log('tabs empty:', rep.filter((r) => r.len === 0).map((r) => r.tab).join(',') || 'none');
fs.writeFileSync('qa/ui-report.json', JSON.stringify(rep, null, 2));
s.close();
