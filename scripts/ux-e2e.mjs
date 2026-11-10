/**
 * End-to-end funnel measurement: new user -> register -> topup (simulated SePay webhook)
 * -> cart -> checkout -> pay -> install token -> .cmd download.
 * Counts every human action and every second.
 *
 * Run: node scripts/ux-e2e.mjs --tag=e2e1
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const BASE = args.base || 'https://xienhl.com';
const TAG = args.tag || 'e2e1';
const PORT = Number(args.port || 9222);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
  || fs.readFileSync('WEBHOOK_SECRET.txt', 'utf8').trim();
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
const stages = [];
const actions = [];
const metrics = { clicks: 0, charsTyped: 0, keyPresses: 0, navigations: 0, pageLoads: 0,
  contextSwitches: 0, screens: 0, apiCalls: 0, waitsMs: 0, errors: [] };
let S;

function stage(name, extra = {}) {
  const rec = { name, atMs: Date.now() - T0, ...extra };
  stages.push(rec);
  console.error(`[${(rec.atMs / 1000).toFixed(1)}s] ${name}${extra.note ? ' :: ' + extra.note : ''}`);
  return rec;
}
function act(kind, detail) { actions.push({ kind, detail, atMs: Date.now() - T0 }); }

const evalJs = async (expr) => {
  const r = await S.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

async function goto(url, label) {
  metrics.navigations++; act('navigate', url);
  const s = Date.now();
  await S.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) {
    const rs = await evalJs('document.readyState').catch(() => 'x');
    if (rs === 'complete') break;
    await sleep(100);
  }
  await sleep(500);
  metrics.waitsMs += Date.now() - s;
  return Date.now() - s;
}

async function waitFor(sel, timeout = 25000, label = '') {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)) {
      metrics.waitsMs += Date.now() - s; return true;
    }
    await sleep(120);
  }
  metrics.waitsMs += Date.now() - s;
  metrics.errors.push({ step: 'waitFor', sel, label });
  return false;
}

async function waitUntil(expr, timeout = 60000, label = '') {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await evalJs(expr).catch(() => false)) { metrics.waitsMs += Date.now() - s; return Date.now() - s; }
    await sleep(300);
  }
  metrics.waitsMs += Date.now() - s;
  return -1;
}

async function click(sel, label) {
  const s = Date.now();
  let pt = null;
  while (Date.now() - s < 25000) {
    pt = await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
      if(!r.width||!r.height)return null;return {x:r.left+r.width/2,y:r.top+r.height/2};})()`).catch(() => null);
    if (pt) break;
    await sleep(150);
  }
  if (!pt) throw new Error(`not clickable: ${sel} (${label})`);
  await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
  await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
  metrics.clicks++; act('click', { sel, label });
  metrics.waitsMs += Date.now() - s;
  await sleep(250);
}

async function type(sel, text, label) {
  await click(sel, 'focus:' + (label || sel));
  for (const ch of text) await S.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  metrics.charsTyped += text.length; metrics.keyPresses += text.length;
  act('type', { sel, label, chars: text.length });
  await sleep(120);
}

async function shot(name) {
  try {
    const r = await S.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('shots', { recursive: true });
    const f = path.resolve('shots', `ux-${TAG}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    metrics.screens++;
    return f;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
async function main() {
  const target = await httpJson('/json/new?about:blank', 'PUT');
  S = await CDP.attach(target.webSocketDebuggerUrl);
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Page.loadEventFired', () => { metrics.pageLoads++; });
  S.on('Network.requestWillBeSent', (p) => { if (p.request.url.includes('/api/')) metrics.apiCalls++; });
  S.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') metrics.errors.push({ step: 'console', err: (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300) });
  });
  S.on('Runtime.exceptionThrown', (p) => {
    metrics.errors.push({ step: 'exception', err: (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 300) });
  });

  const email = `ux${TAG}${Date.now().toString(36)}@mailinator.com`;
  const PASSWORD = 'Test1234abc';
  const PRODUCT_SLUG = args.slug || 'license-xarena-thang';

  /* ===== S1: land ===== */
  stage('S1_landing');
  await goto(BASE + '/', 'landing');
  await shot('01-landing');

  /* ===== S2: register ===== */
  stage('S2_register_open');
  await goto(BASE + '/#/register', 'register');
  await waitFor('#reg-form');
  await shot('02-register');
  await type('#rg-name', 'Khach UX');
  await type('#rg-email', email);
  await type('#rg-pwd', PASSWORD);
  await shot('03-register-filled');
  stage('S2_register_filled', { clicks: 4, typed: 9 + email.length + PASSWORD.length });
  await click('#reg-submit', 'Đăng ký');
  const regOk = await waitUntil(`!document.querySelector('#reg-form')`, 30000, 'reg');
  stage('S2_registered', { ok: regOk >= 0, note: `wait ${regOk}ms` });
  if (regOk < 0) throw new Error('register failed');
  await shot('04-registered');

  /* ===== S3: wallet topup ===== */
  stage('S3_wallet_open');
  await goto(BASE + '/#/wallet', 'wallet');
  await waitFor('#topup-amount');
  await shot('05-wallet');
  await click('[data-quick="200000"]', 'quick 200k');
  await shot('06-amount');
  await click('#btn-create-topup', 'Tạo mã QR');
  await waitFor('#topup-qr-area img');
  await shot('07-qr');
  const memo = await evalJs(`(document.body.innerText.match(/NAP[A-Z0-9]{5}/)||[''])[0]`);
  stage('S3_qr_shown', { note: 'memo=' + memo });

  /* ---- simulate the bank transfer landing (SePay webhook), measure latency ---- */
  const whStart = Date.now();
  const wh = await fetch(BASE + '/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Apikey ' + WEBHOOK_SECRET },
    body: JSON.stringify({ content: memo, transferAmount: 200000, referenceCode: 'UXTEST' + Date.now() }),
  }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  const whMs = Date.now() - whStart;
  stage('S3_webhook_fired', { note: `dedupe/credit in ${whMs}ms`, resp: JSON.stringify(wh).slice(0, 200) });

  // now wait for the *browser* to notice (poll interval is 4000ms)
  const notified = await waitUntil(
    `/Đã nhận được tiền|Đã cập nhật/.test(document.body.innerText)`, 30000, 'topup poll');
  stage('S3_browser_noticed', { note: notified >= 0 ? `${notified}ms after webhook` : 'TIMEOUT' });
  metrics.webhookMs = whMs;
  metrics.browserNotifyMs = notified;
  await shot('08-topup-paid');
  await sleep(2500); // page reloads itself

  /* ===== S4: product -> add to cart ===== */
  stage('S4_product');
  await goto(BASE + '/#/product/' + PRODUCT_SLUG, 'product');
  await waitFor('#btn-add-cart');
  await shot('09-product');
  await click('#btn-add-cart', 'Thêm vào giỏ');
  await sleep(900);
  await shot('10-cart-added');
  stage('S4_added_to_cart');

  /* ===== S5: checkout ===== */
  await goto(BASE + '/#/checkout', 'checkout');
  const coOk = await waitFor('#btn-place-order', 20000);
  await shot('11-checkout');
  stage('S5_checkout_ready', { ok: coOk });
  if (!coOk) {
    const err = await evalJs('document.body.innerText.slice(0,300)');
    throw new Error('checkout did not render: ' + err);
  }
  await click('#btn-place-order', 'Xác nhận thanh toán');
  const paidOk = await waitUntil(`/Thanh toán thành công/.test(document.body.innerText)`, 30000, 'paid');
  await shot('12-success');
  stage('S5_paid', { ok: paidOk >= 0, note: `${paidOk}ms` });
  if (paidOk < 0) throw new Error('payment failed: ' + (await evalJs('document.body.innerText.slice(0,400)')));

  const keyOnPage = await evalJs(`(document.body.innerText.match(/AOE1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)||[''])[0]`);
  stage('S5_key_on_success_page', { note: keyOnPage ? 'key visible' : 'NO KEY VISIBLE' });

  /* ===== S6: install command ===== */
  stage('S6_go_licenses');
  await click('button[onclick*="#/licenses"]', 'Xem License');
  await waitFor('[data-install]', 20000);
  await shot('13-licenses');
  stage('S6_licenses_page');

  await click('[data-install]', 'Lấy lệnh cài đặt');
  await waitFor('[data-copycmd]', 20000);
  await shot('14-install-command');
  const cmd = await evalJs(`(document.querySelector('[data-copycmd]')||{}).dataset?.copycmd || ''`);
  stage('S6_command_ready', { note: cmd.slice(0, 160) });

  // Verify the command actually resolves (unauthenticated fetch with token)
  let cmdFetch = null;
  if (cmd) {
    const url = (cmd.match(/"(https?:\/\/[^"]+)"/) || [])[1];
    if (url) {
      const r = await fetch(url, { redirect: 'follow' });
      const body = await r.text();
      cmdFetch = { url, status: r.status, bytes: body.length, crlf: body.includes('\r\n'),
                   head: body.slice(0, 80) };
    }
  }
  stage('S6_cmd_verified', { note: JSON.stringify(cmdFetch).slice(0, 240) });

  /* ===== S7: also test the broken buy-now path ===== */
  await goto(BASE + '/#/product/' + PRODUCT_SLUG, 'product2');
  await waitFor('#btn-buy-now');
  const errorsBefore = metrics.errors.length;
  await click('#btn-buy-now', 'Mua ngay');
  await sleep(4000);
  const buyNowState = await evalJs(`({
    hash: location.hash,
    stuck: /Đang chuẩn bị đơn hàng/.test(document.body.innerText),
    hasPlaceOrder: !!document.querySelector('#btn-place-order'),
    buynowLS: localStorage.getItem('mbk_buynow')
  })`);
  await shot('15-buynow-deadlock');
  const newErrs = metrics.errors.slice(errorsBefore);
  stage('S7_buynow_tested', { note: JSON.stringify(buyNowState) });
  metrics.buyNow = { ...buyNowState, errors: newErrs };

  /* ===== summary ===== */
  const totalMs = Date.now() - T0;
  const humanToInstalled = stages.find((s) => s.name === 'S6_command_ready')?.atMs;
  const report = {
    tag: TAG, base: BASE, email, productSlug: PRODUCT_SLUG, totalMs,
    stages, actions, metrics,
    derived: {
      clicks: metrics.clicks,
      charsTyped: metrics.charsTyped,
      keyPresses: metrics.keyPresses,
      navigations: metrics.navigations,
      apiCalls: metrics.apiCalls,
      screensSeen: metrics.screens,
      measuredWaitMs: metrics.waitsMs,
      humanActions: metrics.clicks + metrics.charsTyped,
      secondsWebOnly: +(totalMs / 1000).toFixed(1),
      secondsToInstallCommand: humanToInstalled != null ? +(humanToInstalled / 1000).toFixed(1) : null,
      buyNowBroken: !!(metrics.buyNow && metrics.buyNow.stuck),
      buyNowPayload: metrics.buyNow?.buynowLS,
      webhookMs: metrics.webhookMs,
      browserPollMs: metrics.browserNotifyMs,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.derived, null, 2));
  console.log('errors:', JSON.stringify(metrics.errors.slice(0, 6), null, 2));
  console.log('report ->', OUT);
  S.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  console.error('FATAL', e.message);
  const totalMs = Date.now() - T0;
  const report = { tag: TAG, failed: e.message, totalMs, stages, actions, metrics,
    derived: { clicks: metrics.clicks, charsTyped: metrics.charsTyped, humanActions: metrics.clicks + metrics.charsTyped,
      secondsWebOnly: +(totalMs / 1000).toFixed(1) } };
  fs.mkdirSync('shots', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.derived, null, 2));
  process.exit(1);
});
