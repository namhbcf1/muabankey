/**
 * Probe the success page -> License page transition and the install-command flow.
 */
import fs from 'node:fs';
const PORT = 9222, BASE = 'https://xienhl.com';
const EMAIL = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function httpJson(p, m = 'GET') { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }); return JSON.parse(await r.text()); }
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
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); j(new Error('timeout ' + method)); } }, 30000); }); }
  on(m, f) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(f); }
}
(async () => {
  const t = await httpJson('/json/new?about:blank', 'PUT');
  const S = await CDP.attach(t.webSocketDebuggerUrl);
  const logs = [];
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Runtime.consoleAPICalled', (p) => logs.push(`[${p.type}] ` + (p.args || []).map((a) => a.value ?? a.description).join(' ')));
  S.on('Runtime.exceptionThrown', (p) => logs.push(`[EXC] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
  const ev = async (e) => { const r = await S.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r.result.value; };
  const go = async (u) => { await S.send('Page.navigate', { url: 'about:blank' }); await sleep(200); await S.send('Page.navigate', { url: u }); await sleep(2600); };

  await go(BASE + '/');
  await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:'Test1234abc'})}).then(r=>r.json())`);

  console.error('=== direct nav to /#/licenses ===');
  await go(BASE + '/#/licenses');
  const s1 = await ev(`({ hash: location.hash, installBtns: document.querySelectorAll('[data-install]').length,
     keyBoxes: document.querySelectorAll('.key-value').length, head: document.body.innerText.slice(0,300) })`);
  console.error(JSON.stringify(s1, null, 2));

  if (s1.installBtns) {
    console.error('=== click install ===');
    const pt = await ev(`(()=>{const e=document.querySelector('[data-install]');e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
    await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(2500);
    const s2 = await ev(`({ copyBtns: document.querySelectorAll('[data-copycmd]').length,
      cmd: (document.querySelector('[data-copycmd]')||{}).dataset?.copycmd || '',
      dlCmd: (document.querySelector('a[download]')||{}).href || '' })`);
    console.error(JSON.stringify(s2, null, 2));
    fs.writeFileSync('shots/probe-cmd.json', JSON.stringify(s2, null, 2));
  }

  console.error('=== test hash change from success page ===');
  await go(BASE + '/#/checkout');
  await sleep(1500);
  const before = await ev(`location.hash`);
  await ev(`location.hash='#/licenses'`);
  await sleep(2000);
  const after = await ev(`({ hash: location.hash, installBtns: document.querySelectorAll('[data-install]').length })`);
  console.error('before=' + before, 'after=' + JSON.stringify(after));

  console.error('--- logs ---');
  for (const l of logs.slice(-20)) console.error(l);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
