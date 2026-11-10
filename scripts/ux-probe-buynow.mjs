/**
 * Focused diagnostic: reproduce the buy-now -> checkout deadlock and dump in-page errors.
 */
const PORT = 9222;
const BASE = process.env.BASE || 'https://xienhl.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(p, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`${p} -> ${t.slice(0, 200)}`); }
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl); const c = new CDP(ws);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) { const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
      else if (msg.method) for (const h of c.handlers.get(msg.method) || []) h(msg.params);
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout ${method}`)); } }, 30000); });
  }
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
}

(async () => {
  const target = await httpJson('/json/new?about:blank', 'PUT');
  const S = await CDP.attach(target.webSocketDebuggerUrl);
  const logs = [];
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Runtime.consoleAPICalled', (p) => logs.push(`[${p.type}] ` + (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')));
  S.on('Runtime.exceptionThrown', (p) => logs.push(`[EXC] ${p.exceptionDetails?.text} ${p.exceptionDetails?.exception?.description || ''}`));

  const evalJs = async (expression) => {
    const r = await S.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };
  const go = async (url) => { await S.send('Page.navigate', { url }); await sleep(2500); };

  // login with the admin account so we can walk the rest of the flow
  await go(BASE + '/');
  const login = await evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email:'admin@muabankey.vn',password:'namhbcf123'})}).then(r=>r.json())`);
  console.error('login:', JSON.stringify(login).slice(0, 200));

  const prods = await evalJs(`fetch('/api/products',{credentials:'include'}).then(r=>r.json())`);
  const lic = (prods.products || []).filter((p) => p.deliveryType === 'license');
  console.error('license products:', JSON.stringify(lic.map((p) => ({ id: p.id, slug: p.slug, price: p.price, days: p.licenseDays }))));

  // ---- reproduce buy-now ----
  await go(BASE + '/#/product/license-xarena-thang');
  await sleep(1200);
  const pre = await evalJs(`({ hash: location.hash, hasBuy: !!document.querySelector('#btn-buy-now') })`);
  console.error('pre-buy:', JSON.stringify(pre));

  // click buy-now
  const pt = await evalJs(`(()=>{const e=document.querySelector('#btn-buy-now');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  if (pt) {
    await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
    await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
  }
  await sleep(3000);

  const post = await evalJs(`({
    hash: location.hash,
    buynow: localStorage.getItem('mbk_buynow'),
    cart: localStorage.getItem('mbk_cart'),
    hasPlaceOrder: !!document.querySelector('#btn-place-order'),
    bodyHead: document.body.innerText.slice(0,400)
  })`);
  console.error('post-buy:', JSON.stringify(post, null, 2));

  console.error('--- page logs ---');
  for (const l of logs.slice(-30)) console.error(l);
  console.error('--- end ---');

  console.error('uncaught in-page errors:', JSON.stringify(logs.filter(l => l.startsWith('[EXC]')), null, 2));
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
