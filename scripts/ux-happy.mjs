/**
 * Happy-path measurement with a pre-funded wallet.
 * Measures: product -> cart -> checkout -> pay -> success page -> License page
 *           -> install command -> fetch/validate .cmd and .ps1
 * Also validates the installer artifacts without executing them.
 *
 * Run: node scripts/ux-happy.mjs --email=... --tag=h1
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const BASE = args.base || 'https://xienhl.com';
const PORT = Number(args.port || 9222);
const TAG = args.tag || 'h1';
const EMAIL = args.email;
const PASSWORD = args.password || 'Test1234abc';
const SLUG = args.slug || 'license-xarena-thang';
const OUT = path.resolve('shots', `ux-${TAG}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(p, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`${p} -> ${t.slice(0, 200)}`); }
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async attach(u) {
    const ws = new WebSocket(u); const c = new CDP(ws);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
      else if (m.method) for (const h of c.handlers.get(m.method) || []) h(m.params);
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout ${method}`)); } }, 40000);
    });
  }
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

const T0 = Date.now();
const steps = [];
const M = { clicks: 0, chars: 0, keyPresses: 0, navs: 0, loads: 0, ctxSwitch: 0, pages: [],
  api: 0, waitMs: 0, errors: [], pickerOpens: 0, appLaunches: 0 };

function step(name, extra = {}) {
  const r = { name, atMs: Date.now() - T0, ...extra };
  steps.push(r);
  console.error(`[${(r.atMs / 1000).toFixed(1)}s] ${name}${r.note ? ' :: ' + r.note : ''}`);
  return r;
}

let S;
const evalJs = async (expr) => {
  const r = await S.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

async function goto(url, label, key = null) {
  M.navs++; step('nav', { note: label || url });
  const s = Date.now();
  // hash-only change does not reload; force a real navigation
  await S.send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await S.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) {
    if (await evalJs('document.readyState').catch(() => 'x') === 'complete') break;
    await sleep(100);
  }
  await sleep(700);
  M.waitMs += Date.now() - s;
  return Date.now() - s;
}

async function waitFor(sel, timeout = 25000) {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)) {
      M.waitMs += Date.now() - s; return Date.now() - s;
    }
    await sleep(120);
  }
  M.waitMs += Date.now() - s; M.errors.push({ step: 'waitFor', sel }); return -1;
}

async function waitUntil(expr, timeout = 60000, label = '') {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await evalJs(expr).catch(() => false)) { M.waitMs += Date.now() - s; return Date.now() - s; }
    await sleep(300);
  }
  M.waitMs += Date.now() - s; M.errors.push({ step: 'waitUntil', label, expr }); return -1;
}

async function click(sel, label) {
  const s = Date.now();
  let pt = null;
  while (Date.now() - s < 25000) {
    pt = await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
      if(!r.width||!r.height)return null;const cx=r.left+r.width/2,cy=r.top+r.height/2;
      const hit=document.elementFromPoint(cx,cy);
      return {x:cx,y:cy,occluded: hit? !e.contains(hit)&&hit!==e : true, text:(e.innerText||'').slice(0,50)};})()`).catch(() => null);
    if (pt && !pt.occluded) break;
    if (pt && pt.occluded) { /* scroll more */ await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); }
    await sleep(150);
  }
  if (!pt) throw new Error(`not clickable: ${sel}`);
  await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
  await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
  M.clicks++; step('click', { note: label || pt.text });
  M.waitMs += Date.now() - s;
  await sleep(300);
}

async function type(sel, text, label) {
  await click(sel, 'focus:' + (label || sel));
  for (const ch of text) await S.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  M.chars += text.length; M.keyPresses += text.length;
  step('type', { note: `${label}: ${text.length} chars` });
  await sleep(120);
}

async function shot(name) {
  try {
    const r = await S.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('shots', { recursive: true });
    const f = path.resolve('shots', `ux-${TAG}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    M.pages.push(path.basename(f));
    return f;
  } catch { return null; }
}

async function main() {
  const target = await httpJson('/json/new?about:blank', 'PUT');
  S = await CDP.attach(target.webSocketDebuggerUrl);
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Page.loadEventFired', () => { M.loads++; });
  S.on('Page.frameNavigated', (p) => { if (!p.frame.parentId) M.navs = M.navs; });
  S.on('Network.requestWillBeSent', (p) => { if (p.request.url.includes('/api/')) M.api++; });
  S.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') M.errors.push({ step: 'console', err: (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 250) });
  });
  S.on('Runtime.exceptionThrown', (p) => {
    M.errors.push({ step: 'exception', err: (p.exceptionDetails?.exception?.description || '').slice(0, 250) });
  });

  /* ===== 0. login ===== */
  step('T0_start');
  await goto(BASE + '/', 'landing');
  const login = await evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  if (!login.ok) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
  step('login', { note: `balance=${login.user.balance}` });
  // Clear any cart state left by earlier runs so the qty is deterministic
  await evalJs(`localStorage.removeItem('mbk_cart');localStorage.removeItem('mbk_buynow');`);
  await goto(BASE + '/', 'home');

  /* ===== 1. product page ===== */
  const tProd = Date.now();
  await goto(BASE + '/#/product/' + SLUG, 'product');
  const wProd = await waitFor('#btn-add-cart');
  await shot('01-product');
  step('S1_product_visible', { note: `${wProd}ms to render` });

  /* ===== 2. add to cart ===== */
  await click('#btn-add-cart', 'Thêm vào giỏ hàng');
  await sleep(800);
  await shot('02-in-cart');
  step('S2_added_to_cart');

  /* ===== 3. go to checkout ===== */
  const tCo = Date.now();
  await goto(BASE + '/#/checkout', 'checkout');
  const wCo = await waitFor('#btn-place-order');
  await shot('03-checkout');
  step('S3_checkout_visible', { note: wCo >= 0 ? `${wCo}ms` : 'FAILED' });
  if (wCo < 0) throw new Error('checkout broken');

  /* ===== 4. pay ===== */
  const tPay = Date.now();
  await click('#btn-place-order', 'Xác nhận thanh toán');
  const paid = await waitUntil(`/Thanh toán thành công/.test(document.body.innerText)`, 30000, 'paid');
  await shot('04-success');
  step('S4_paid', { note: paid >= 0 ? `${paid}ms` : 'FAILED' });
  if (paid < 0) throw new Error('pay failed: ' + (await evalJs('document.body.innerText.slice(0,300)')));

  const keyVisible = await evalJs(`(document.body.innerText.match(/AOE1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)||[''])[0]`);
  const hasInstallBtnOnSuccess = await evalJs(`!!document.querySelector('button[onclick*="#/licenses"]')`);
  step('S4_key_on_success', {
    note: `${keyVisible ? 'KEY SHOWN' : 'NO KEY'}; install-button=${hasInstallBtnOnSuccess}`,
  });

  /* ===== 5. licenses page ===== */
  await click('button[onclick*="#/licenses"]', 'Xem License / Lấy lệnh cài đặt');
  const wLic = await waitFor('[data-install]', 20000);
  await shot('05-licenses');
  step('S5_licenses_visible', { note: wLic >= 0 ? `${wLic}ms` : 'FAILED' });

  /* ===== 6. get install command ===== */
  const tCmd = Date.now();
  await click('[data-install]', 'Lấy lệnh cài đặt tự động');
  const wCmd = await waitFor('[data-copycmd]', 20000);
  await shot('06-install-command');
  const cmd = await evalJs(`(document.querySelector('[data-copycmd]')||{}).dataset?.copycmd || ''`);
  step('S6_command_visible', { note: wCmd >= 0 ? `${wCmd}ms` : 'FAILED' });
  const T_WEB = Date.now() - T0;
  step('MILESTONE_web_done', { note: `web-only total ${(T_WEB / 1000).toFixed(1)}s` });

  /* ===== 7. copy the command (real clipboard click) ===== */
  await click('[data-copycmd]', 'Copy lệnh CMD');
  await sleep(600);
  const clip = await evalJs(`navigator.clipboard.readText().then(t=>({len:t.length,head:t.slice(0,120)}))`).catch((e) => ({ err: String(e) }));
  step('S7_copied', { note: JSON.stringify(clip).slice(0, 200) });

  /* ===== 8. verify installer artifacts over HTTP (no token leak) ===== */
  const cmdUrl = (cmd.match(/"(https?:\/\/[^"]+)"/) || [])[1] || '';
  const tok = (cmdUrl.match(/\?t=([a-f0-9]+)/) || [])[1] || '';
  const key = (cmd.match(/\/i\/([A-Z0-9-]+)\.cmd/) || [])[1] || keyVisible;

  const artifacts = {};
  if (cmdUrl) {
    const r = await fetch(cmdUrl);
    const body = await r.text();
    artifacts.cmd = {
      url: cmdUrl.replace(tok, '<t>'), status: r.status, bytes: body.length,
      crlf: (body.match(/\r\n/g) || []).length, lfOnly: (body.match(/(?<!\r)\n/g) || []).length,
      hasKey: body.includes(key), hasToken: !!tok && body.includes(tok),
      shaVerify: /certutil -hashfile/.test(body), uac: /RunAs/.test(body) || /Administrator/.test(body),
      shortcut: /WScript\.Shell/.test(body), uninstall: /go-cai-dat/.test(body),
      head: body.slice(0, 60).replace(/\r?\n/g, '\\n'),
    };
  }
  // ps1 variant
  if (tok && key) {
    const ps1Url = `${BASE}/i/${key}.ps1?t=${tok}`;
    const r = await fetch(ps1Url);
    const body = await r.text();
    artifacts.ps1 = { status: r.status, bytes: body.length, hasKey: body.includes(key),
      bom: body.charCodeAt(0) === 0xFEFF, shaVerify: /Get-FileHash/.test(body) };
  }
  // public exe
  const exeHead = await fetch(`${BASE}/download/xa_nofog_pro.exe`, { method: 'HEAD' });
  artifacts.exe = {
    status: exeHead.status, bytes: Number(exeHead.headers.get('content-length')),
    contentType: exeHead.headers.get('content-type'),
    requiresAuth: exeHead.status === 401 || exeHead.status === 403,
    cacheControl: exeHead.headers.get('cache-control'),
  };
  // one-liner feasibility: does /i/<key>.ps1 work without token for an owned key?
  const ps1NoTok = await fetch(`${BASE}/i/${key}.ps1`, { headers: { cookie: '' } });
  artifacts.ps1WithoutToken = { status: ps1NoTok.status };
  // /i/<key> JSON (session-based)
  const jsonNoTok = await fetch(`${BASE}/i/${key}`);
  artifacts.jsonWithoutToken = { status: jsonNoTok.status, body: (await jsonNoTok.text()).slice(0, 120) };

  step('S8_installer_verified', { note: 'artifacts checked' });

  /* ===== summary ===== */
  const totalMs = Date.now() - T0;
  const offsite = {
    ctxWebToRunDialog: 1, ctxRunDialogToCmd: 1, ctxCmdToUAC: 1, ctxCmdToDesktop: 1,
  };
  const report = {
    tag: TAG, base: BASE, email: EMAIL, slug: SLUG,
    key, commandTemplate: cmd.replace(/t=[a-f0-9]+/, 't=<token>'),
    steps, metrics: M, artifacts, totalMs,
    derived: {
      webClicks: M.clicks,
      webCharsTyped: M.chars,
      webNavigations: M.navs,
      webApiCalls: M.api,
      photosOfScreens: M.pages.length,
      measuredWaitMs: M.waitMs,
      secondsWebTotal: +(totalMs / 1000).toFixed(1),
      secondsToGetCommand: +((steps.find((s) => s.name === 'S6_command_visible')?.atMs || 0) / 1000).toFixed(1),
      offsiteSteps: 12, // measured separately, documented
      contextSwitches: 4,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.derived, null, 2));
  console.log('--- artifacts ---');
  console.log(JSON.stringify(artifacts, null, 2));
  console.log('--- errors ---');
  console.log(JSON.stringify(M.errors.slice(0, 8), null, 2));
  S.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  const report = { tag: TAG, failed: e.message, steps, metrics: M, totalMs: Date.now() - T0 };
  fs.mkdirSync('shots', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  process.exit(1);
});
