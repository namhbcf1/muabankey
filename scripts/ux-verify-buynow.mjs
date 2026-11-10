/**
 * Verify "Mua ngay" end-to-end AFTER the concurrent fix, using a real UI login
 * (not an API fetch) so state.user is genuinely populated.
 */
import fs from 'node:fs';
const PORT = 9222, BASE = 'https://xienhl.com';
const EMAIL = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hj(p, m = 'GET') { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }); return JSON.parse(await r.text()); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.h = new Map(); }
  static async attach(u) {
    const ws = new WebSocket(u); const c = new CDP(ws);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id && c.p.has(m.id)) { const { r, j } = c.p.get(m.id); c.p.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
      else if (m.method) for (const f of c.h.get(m.method) || []) f(m.params); });
    return c;
  }
  send(method, params = {}) { const id = ++this.id;
    return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); j(new Error('timeout ' + method)); } }, 35000); }); }
  on(m, f) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(f); }
}
(async () => {
  const t = await hj('/json/new?about:blank', 'PUT');
  const S = await CDP.attach(t.webSocketDebuggerUrl);
  const logs = [];
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') logs.push('[err] ' + (p.args || []).map((a) => a.value ?? a.description).join(' ')); });
  S.on('Runtime.exceptionThrown', (p) => logs.push('[EXC] ' + (p.exceptionDetails?.exception?.description || '').slice(0, 200)));
  const ev = async (e) => { const r = await S.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const go = async (u) => { await S.send('Page.navigate', { url: 'about:blank' }); await sleep(150);
    await S.send('Page.navigate', { url: u });
    for (let i = 0; i < 200; i++) { if (await ev('document.readyState').catch(() => 'x') === 'complete') break; await sleep(100); }
    await sleep(1400); };
  const click = async (sel) => {
    const pt = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
      if(!r.width||!r.height)return null;return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (!pt) throw new Error('no target ' + sel);
    await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
    await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(350);
  };
  const type = async (sel, txt) => {
    await click(sel);
    for (const ch of txt) await S.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await sleep(120);
  };

  // --- REAL UI LOGIN ---
  await go(BASE + '/#/login');
  await type('#lg-email', EMAIL);
  await type('#lg-pwd', 'Test1234abc');
  await click('#login-submit');
  await sleep(3500);
  const loggedIn = await ev(`({ hash: location.hash, chip: (document.querySelector('#balance-chip')||{}).innerText || '',
     loggedOut: !!document.querySelector('#lg-email') })`);
  console.error('login state:', JSON.stringify(loggedIn));

  // --- BUY NOW ---
  await go(BASE + '/#/product/license-xarena-thang');
  await ev(`localStorage.removeItem('mbk_buynow');localStorage.removeItem('mbk_cart')`);
  await click('#btn-buy-now');
  await sleep(3500);
  const st = await ev(`({
    hash: location.hash,
    stuck: /Đang chuẩn bị đơn hàng/.test(document.body.innerText),
    hasPlaceOrder: !!document.querySelector('#btn-place-order'),
    buynow: localStorage.getItem('mbk_buynow'),
    cart: localStorage.getItem('mbk_cart'),
    itemName: (document.body.innerText.match(/XArena No Fog[^\\n]*/)||[''])[0],
    total: (document.querySelector('#sum-total')||{}).innerText || '',
    balance: (document.querySelector('#wallet-balance')||{}).innerText || ''
  })`);
  console.error('BUY-NOW STATE:', JSON.stringify(st, null, 2));
  const r = await S.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/ux-buynow-fixed.png', Buffer.from(r.data, 'base64'));

  // --- ACTUALLY PAY ---
  if (st.hasPlaceOrder) {
    await click('#btn-place-order');
    for (let i = 0; i < 60; i++) {
      const ok = await ev(`/Thanh toán thành công/.test(document.body.innerText)`);
      if (ok) break; await sleep(400);
    }
    const done = await ev(`({ success: /Thanh toán thành công/.test(document.body.innerText),
       key: (document.body.innerText.match(/AOE1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)||[''])[0],
       hash: location.hash })`);
    console.error('PAY RESULT:', JSON.stringify(done));
    const r2 = await S.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('shots/ux-buynow-fixed-success.png', Buffer.from(r2.data, 'base64'));
  }
  console.error('page errors:', JSON.stringify([...new Set(logs)].slice(0, 5)));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
