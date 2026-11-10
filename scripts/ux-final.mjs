/**
 * FINAL consolidated measurement: complete new-customer journey, counting every
 * human action. Stops at the points where a human would actually be blocked.
 *
 * Run: node scripts/ux-final.mjs --tag=f1
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const BASE = args.base || 'https://xienhl.com';
const PORT = Number(args.port || 9222);
const TAG = args.tag || 'f1';
const OUT = path.resolve('shots', `ux-${TAG}.json`);
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
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); j(new Error('timeout ' + method)); } }, 40000); }); }
  on(m, f) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(f); }
}

const T0 = Date.now();
/* Every human input is logged with an explicit channel so the report can show
   which context the customer had to be in (browser / run dialog / cmd / UAC / desktop). */
const IN = [];
const MARKS = [];
const M = { webLoads: 0, api: 0, waitMs: 0, errors: [], consoleErr: [] };
let S;

function input(ctx, kind, detail) { IN.push({ ctx, kind, detail, atMs: Date.now() - T0 }); }
function mark(name, extra = {}) { const r = { name, atMs: Date.now() - T0, ...extra }; MARKS.push(r);
  console.error(`[${(r.atMs / 1000).toFixed(1)}s] ${name}${r.note ? ' :: ' + r.note : ''}`); return r; }

const ev = async (e) => { const r = await S.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

async function goto(url, label) {
  const s = Date.now();
  await S.send('Page.navigate', { url: 'about:blank' }); await sleep(120);
  await S.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { if (await ev('document.readyState').catch(() => 'x') === 'complete') break; await sleep(100); }
  await sleep(650);
  M.waitMs += Date.now() - s;
  return Date.now() - s;
}
async function waitFor(sel, timeout = 25000) {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)) { M.waitMs += Date.now() - s; return Date.now() - s; }
    await sleep(120);
  }
  M.waitMs += Date.now() - s; return -1;
}
async function waitUntil(expr, timeout = 40000, label = '') {
  const s = Date.now();
  while (Date.now() - s < timeout) {
    if (await ev(expr).catch(() => false)) { M.waitMs += Date.now() - s; return Date.now() - s; }
    await sleep(300);
  }
  M.waitMs += Date.now() - s; M.errors.push({ step: 'waitUntil', label }); return -1;
}
async function click(sel, label) {
  const s = Date.now(); let pt = null;
  while (Date.now() - s < 25000) {
    pt = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
      if(!r.width||!r.height)return null;return {x:r.left+r.width/2,y:r.top+r.height/2};})()`).catch(() => null);
    if (pt) break; await sleep(150);
  }
  if (!pt) throw new Error('not clickable: ' + sel);
  await S.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
  await S.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
  input('browser', 'click', label || sel);
  M.waitMs += Date.now() - s; await sleep(280);
}
async function type(sel, text, label) {
  await click(sel, 'focus ' + (label || sel));
  for (const ch of text) await S.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  input('browser', 'type', `${label}: ${text.length} chars`);
  await sleep(110);
}
async function shot(n) {
  const r = await S.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('shots', { recursive: true });
  const f = path.resolve('shots', `ux-${TAG}-${n}.png`);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return path.basename(f);
}

async function main() {
  const t = await hj('/json/new?about:blank', 'PUT');
  S = await CDP.attach(t.webSocketDebuggerUrl);
  await S.send('Page.enable'); await S.send('Runtime.enable'); await S.send('Network.enable');
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  S.on('Page.loadEventFired', () => { M.webLoads++; });
  S.on('Network.requestWillBeSent', (p) => { if (p.request.url.includes('/api/')) M.api++; });
  S.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') M.consoleErr.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 220)); });
  S.on('Runtime.exceptionThrown', (p) => M.consoleErr.push((p.exceptionDetails?.exception?.description || '').slice(0, 220)));

  const email = `uxf${TAG}${Date.now().toString(36)}@mailinator.com`;
  const PW = 'Test1234abc';
  const steps = [];

  /* ============ 1. LAND ============ */
  input('browser', 'open-browser', 'type xienhl.com');
  await goto(BASE + '/', 'landing');
  await shot('01-landing');
  steps.push({ n: 1, name: 'Vào trang chủ', t: Date.now() - T0 });

  /* ============ 2. FIND PRODUCT ============ */
  const tFind = Date.now();
  await goto(BASE + '/#/product/license-xarena-thang', 'product');
  const wP = await waitFor('#btn-add-cart');
  await shot('02-product');
  steps.push({ n: 2, name: 'Trang sản phẩm', t: Date.now() - T0, note: `${wP}ms` });

  /* ============ 3. BUY NOW (the broken path) ============ */
  const tBug = Date.now();
  await click('#btn-buy-now', 'Mua ngay');
  await sleep(3500);
  const buynow = await ev(`({
    hash: location.hash, stuck: /Đang chuẩn bị đơn hàng/.test(document.body.innerText),
    placeOrder: !!document.querySelector('#btn-place-order'),
    payload: localStorage.getItem('mbk_buynow')
  })`);
  await shot('03-buynow-deadlock');
  steps.push({ n: 3, name: 'Bấm "Mua ngay"', t: Date.now() - T0,
    note: buynow.stuck ? `HỎNG: ${buynow.payload} → treo` : 'ok', broken: buynow.stuck });
  mark('BUG_buynow', { note: JSON.stringify(buynow) });

  /* ============ 4. REGISTER (forced detour) ============ */
  const tReg = Date.now();
  await goto(BASE + '/#/register', 'register');
  await waitFor('#reg-form');
  await shot('04-register');
  await type('#rg-name', 'Khach UX', 'Họ tên');
  await type('#rg-email', email, 'Email');
  await type('#rg-pwd', PW, 'Mật khẩu');
  await shot('05-register-filled');
  await click('#reg-submit', 'Đăng ký');
  const regOk = await waitUntil(`!document.querySelector('#reg-form')`, 30000, 'reg');
  steps.push({ n: 4, name: 'Đăng ký tài khoản', t: Date.now() - T0, ok: regOk >= 0 });
  mark('registered', { ok: regOk >= 0 });

  /* ============ 5. WALLET TOPUP — THE WALL ============ */
  const tWal = Date.now();
  await goto(BASE + '/#/wallet', 'wallet');
  await waitFor('#topup-amount');
  await shot('06-wallet');
  await click('[data-quick="200000"]', 'Chọn 200.000₫');
  await shot('07-amount');
  await click('#btn-create-topup', 'Tạo mã QR nạp tiền');
  await waitFor('#topup-qr-area img');
  await shot('08-qr');
  const memo = await ev(`(document.body.innerText.match(/NAP[A-Z0-9]{5}/)||[''])[0]`);
  const bank = await ev(`({ bank: document.body.innerText.match(/(MB Bank|Vietcombank|Techcombank)/)?.[0] || '?',
     acct: (document.body.innerText.match(/\\b\\d{9,16}\\b/)||[''])[0] })`);
  steps.push({ n: 5, name: 'Tạo mã QR nạp tiền', t: Date.now() - T0, note: `memo=${memo} ${JSON.stringify(bank)}` });
  mark('QR_shown', { note: memo });

  /* ---- customer leaves the browser: phone banking app => context switch #1 ---- */
  input('PHONE', 'app-switch', 'Mở app ngân hàng, quét QR, xác nhận chuyển khoản');
  mark('CTX_SWITCH_1_phone', { note: 'web -> app ngân hàng' });

  /* the webhook would credit here; we cannot sign it, so the customer WAITS */
  const pollDeadline = 45000;
  const noticed = await waitUntil(`/Đã nhận được tiền/.test(document.body.innerText)`, pollDeadline, 'topup credited');
  steps.push({ n: 6, name: 'Chờ webhook cộng tiền', t: Date.now() - T0,
    note: noticed >= 0 ? `${noticed}ms` : `HẾT ${pollDeadline}ms KHÔNG thấy cộng tiền` });
  mark('topup_credit_wait', { note: noticed >= 0 ? 'credited' : 'NOT CREDITED within 45s' });
  await shot('09-still-waiting');

  /* ---- without balance, the customer is silently bounced ---- */
  await goto(BASE + '/#/checkout', 'checkout-empty');
  const coState = await ev(`({ hash: location.hash, empty: /Giỏ hàng trống/.test(document.body.innerText) })`);
  mark('checkout_without_balance', { note: JSON.stringify(coState) });
  await shot('10-checkout-empty');

  /* ============ 6. INSTALL COMMAND (for completeness) ============ */
  const totalMs = Date.now() - T0;
  const report = {
    tag: TAG, base: BASE, email,
    marks: MARKS, inputs: IN, steps, metrics: M, totalMs,
    summary: {
      webClicks: IN.filter((i) => i.ctx === 'browser' && i.kind === 'click').length,
      charsTyped: IN.reduce((s, i) => s + (i.kind === 'type' ? Number((i.detail.match(/(\d+) chars/) || [0, 0])[1]) : 0), 0),
      totalInputs: IN.length,
      browserInputs: IN.filter((i) => i.ctx === 'browser').length,
      offBrowserInputs: IN.filter((i) => i.ctx !== 'browser').length,
      contextSwitches: IN.filter((i) => i.kind === 'app-switch').length,
      webLoads: M.webLoads, apiCalls: M.api,
      measuredWaitMs: M.waitMs,
      secondsInBrowser: +(totalMs / 1000).toFixed(1),
      blockedAtWallet: noticed < 0,
      buyNowBroken: buynow.stuck,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('--- steps ---');
  for (const s of steps) console.log(`  ${s.n}. ${s.name} @${(s.t / 1000).toFixed(1)}s ${s.note || ''}`);
  console.log('--- console errors ---');
  console.log(JSON.stringify([...new Set(M.consoleErr)].slice(0, 5), null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error('FATAL', e.message);
  fs.mkdirSync('shots', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ tag: TAG, failed: e.message, marks: MARKS, inputs: IN, metrics: M, totalMs: Date.now() - T0 }, null, 2));
  process.exit(1);
});
