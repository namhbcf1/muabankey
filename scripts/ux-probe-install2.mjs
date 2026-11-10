/**
 * Repeated test: does a logged-in user hard-loading /#/licenses get bounced to /#/login?
 * Also measures install-command generation latency and the .cmd artifact.
 */
import fs from 'node:fs';
const PORT = 9222, BASE = 'https://xienhl.com';
const EMAIL = process.argv[2] || 'uxe2e1mwal4du9@mailinator.com';
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
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); j(new Error('timeout ' + method)); } }, 30000); }); }
  on(m, f) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(f); }
}
(async () => {
  const t = await hj('/json/new?about:blank', 'PUT');
  const S = await CDP.attach(t.webSocketDebuggerUrl);
  const logs = [];
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Runtime.consoleAPICalled', (p) => logs.push(`[${p.type}] ` + (p.args || []).map((a) => a.value ?? a.description).join(' ')));
  S.on('Runtime.exceptionThrown', (p) => logs.push(`[EXC] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
  const ev = async (e) => { const r = await S.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r.result.value; };

  // 1) log in once via API (cookie persists in the profile for the browser session)
  await S.send('Page.navigate', { url: BASE + '/' }); await sleep(2500);
  const li = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:'Test1234abc'})}).then(r=>r.json())`);
  console.error('login:', JSON.stringify(li).slice(0, 120));

  // 2) hard-load /#/licenses 5x and record the resulting hash
  const results = [];
  for (let i = 0; i < 5; i++) {
    await S.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
    const t0 = Date.now();
    await S.send('Page.navigate', { url: BASE + '/#/licenses' });
    await sleep(3000);
    const st = await ev(`({ hash: location.hash, installBtns: document.querySelectorAll('[data-install]').length,
      loggedIn: /₫/.test(document.querySelector('#balance-chip')?.innerText||'') })`);
    results.push({ ...st, ms: Date.now() - t0 });
  }
  console.error('hard-load results:', JSON.stringify(results, null, 2));

  // 3) once on the licenses page, measure install-command generation
  if (results.at(-1).installBtns === 0) {
    await S.send('Page.navigate', { url: BASE + '/#/licenses' }); await sleep(3200);
  }
  const ready = await ev(`document.querySelectorAll('[data-install]').length`);
  console.error('install buttons now:', ready);
  if (ready > 0) {
    const pt = await ev(`(()=>{const e=document.querySelector('[data-install]');e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const t0 = Date.now();
    await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
    await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
    let cmd = '', waited = -1;
    for (let i = 0; i < 200; i++) {
      cmd = await ev(`(document.querySelector('[data-copycmd]')||{}).dataset?.copycmd || ''`);
      if (cmd) { waited = Date.now() - t0; break; }
      await sleep(100);
    }
    const dl = await ev(`Array.from(document.querySelectorAll('a[download]')).map(a=>a.href)`);
    const r = await S.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('shots', { recursive: true });
    fs.writeFileSync('shots/ux-install-cmd.png', Buffer.from(r.data, 'base64'));
    console.error('install command in', waited, 'ms');
    console.error('cmd:', cmd.replace(/t=[a-f0-9]+/, 't=<token>'));
    console.error('download links:', JSON.stringify(dl.map((u) => u.replace(/t=[a-f0-9]+/, 't=<token>'))));

    // 4) fetch and inspect the .cmd
    const url = (cmd.match(/"(https?:\/\/[^"]+)"/) || [])[1];
    if (url) {
      const res = await fetch(url); const body = await res.text();
      const tok = (url.match(/t=([a-f0-9]+)/) || [])[1];
      const key = (url.match(/\/i\/([A-Z0-9-]+)\.cmd/) || [])[1];
      const insp = { status: res.status, bytes: body.length,
        crlf: (body.match(/\r\n/g) || []).length, bareLf: (body.match(/(?<!\r)\n/g) || []).length,
        embedsKey: body.includes(key), embedsToken: body.includes(tok),
        hasShaCheck: /certutil -hashfile/.test(body), hasUac: /RunAs/.test(body),
        hasShortcut: /WScript\.Shell/.test(body), hasUninstall: /go-cai-dat/.test(body),
        hasSizeConst: /set "EXESIZE=/.test(body) };
      console.error('CMD:', JSON.stringify(insp, null, 2));
      const ps1 = await fetch(`${BASE}/i/${key}.ps1?t=${tok}`); const pb = await ps1.text();
      console.error('PS1:', JSON.stringify({ status: ps1.status, bytes: pb.length, bom: pb.charCodeAt(0) === 0xFEFF,
        hasSha: /Get-FileHash/.test(pb), oneLinerable: pb.length < 3000 }));
      // token reuse: fetch the same URL twice
      const again = await fetch(url);
      console.error('token reuse 2nd fetch:', again.status);
      // token without key match
      const wrong = await fetch(`${BASE}/i/AOE1-AAAA-AAAA-AAAA.ps1?t=${tok}`);
      console.error('token on wrong key:', wrong.status);
      // expiry field
      const meta = await ev(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.json()).then(j=>j.user)`);
      console.error('user:', JSON.stringify(meta).slice(0, 100));
    }
  }

  console.error('--- last logs ---');
  for (const l of logs.slice(-12)) console.error(l);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
