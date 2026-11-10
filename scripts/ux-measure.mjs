/**
 * UX friction measurement harness for xienhl.com buy->install flow.
 * Drives a real headless Chrome over raw CDP and counts every human action.
 *
 * Run: node scripts/ux-measure.mjs [--base=https://xienhl.com] [--tag=run1]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const BASE = args.base || 'https://xienhl.com';
const TAG = args.tag || 'run1';
const OUT = path.resolve('shots', `ux-${TAG}.json`);
const PORT = Number(args.port || 9222);

/* ---------------- CDP plumbing ---------------- */
async function httpJson(p, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`${p} -> ${t.slice(0, 200)}`); }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const c = new CDP(ws);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        for (const h of c.handlers.get(msg.method) || []) h(msg.params);
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout ${method}`));
        }
      }, 45000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Metrics recorder ---------------- */
const t0 = Date.now();
const stages = [];
const events = [];

function stage(name, extra = {}) {
  const rec = { name, at: Date.now(), sinceStart: Date.now() - t0, ...extra };
  stages.push(rec);
  console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`);
  return rec;
}

function ev(kind, detail) {
  events.push({ kind, detail, at: Date.now(), sinceStart: Date.now() - t0 });
}

const metrics = {
  clicks: 0,
  keystrokes: 0,     // individual printable characters typed
  keyPresses: 0,     // raw keydown events (incl. Tab/Enter)
  navigations: 0,
  pageRenders: 0,
  contextSwitches: 0,
  formsSubmitted: 0,
  networkRequests: 0,
  apiRequests: [],
  waits: [],
  errors: [],
  screens: [],
};

/* ---------------- Low level actions ---------------- */
let S; // session

async function waitLoad(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await S.send('Runtime.evaluate', {
        expression: 'document.readyState', returnByValue: true,
      });
      if (r.result.value === 'complete') return Date.now() - start;
    } catch {}
    await sleep(100);
  }
  return -1;
}

async function navigate(url, label) {
  metrics.navigations++;
  ev('navigate', url);
  await S.send('Page.navigate', { url });
  const wait = await waitLoad();
  metrics.waits.push({ stage: label || url, ms: wait });
  // SPA hash router needs a beat
  await sleep(400);
  return wait;
}

/** Real mouse click on the center of a selector; counts as 1 click. */
async function click(selector, label) {
  const b = await clickable(selector, label);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await S.send('Input.dispatchMouseEvent', {
      type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
  metrics.clicks++;
  ev('click', { selector, label: label || b.text, tag: b.tag });
  await sleep(250);
  return b;
}

/** Wait for the element to be visible, then return its click point. */
async function clickable(selector, label, timeout = 20000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    const box = await S.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return {missing:true};
        el.scrollIntoView({block:'center'});
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return {hidden:true};
        return {x: r.left + r.width/2, y: r.top + r.height/2, tag: el.tagName, text: (el.innerText||'').slice(0,60)};
      })()`,
      returnByValue: true,
    });
    last = box.result.value;
    if (last && !last.missing && !last.hidden) return last;
    await sleep(150);
  }
  throw new Error(`click target never clickable: ${selector} (${label}) last=${JSON.stringify(last)}`);
}

/** Focus an element and type text character by character via real key events. */
async function typeInto(selector, text, label) {
  await click(selector, `focus:${label || selector}`);
  // Select-all then overwrite so re-typing is deterministic
  for (const ch of text) {
    await S.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    metrics.keystrokes++;
  }
  metrics.keyPresses += text.length;
  ev('type', { selector, label, chars: text.length });
  await sleep(150);
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await S.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await S.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  metrics.keyPresses++;
  ev('key', { key });
  await sleep(200);
}

async function evalJs(expression) {
  const r = await S.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function shot(name) {
  try {
    const r = await S.send('Page.captureScreenshot', { format: 'png' });
    const dir = path.resolve('shots');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `ux-${TAG}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    metrics.screens.push(f);
    return f;
  } catch (e) { return null; }
}

/** Wait for a selector to exist. */
async function waitFor(selector, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false);
    if (ok) {
      metrics.waits.push({ stage: `waitFor ${selector}`, ms: Date.now() - start });
      return true;
    }
    await sleep(120);
  }
  metrics.waits.push({ stage: `waitFor ${selector} (TIMEOUT)`, ms: Date.now() - start });
  return false;
}

/** Wait until a JS predicate is true. */
async function waitUntil(expr, timeout = 60000, label = '') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await evalJs(expr).catch(() => false);
    if (ok) {
      metrics.waits.push({ stage: `waitUntil ${label || expr}`, ms: Date.now() - start });
      return Date.now() - start;
    }
    await sleep(400);
  }
  metrics.waits.push({ stage: `waitUntil ${label || expr} (TIMEOUT)`, ms: Date.now() - start });
  return -1;
}

/* ---------------- Scenario ---------------- */
async function main() {
  const version = await httpJson('/json/version');
  console.error('Browser:', version.Browser);

  const target = await httpJson('/json/new?about:blank', 'PUT');
  const cdp = await CDP.attach(target.webSocketDebuggerUrl || `ws://127.0.0.1:${PORT}/devtools/page/${target.id}`);
  S = cdp;

  await S.send('Page.enable');
  await S.send('Runtime.enable');
  await S.send('Network.enable');
  await S.send('DOM.enable');
  await S.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  // Instrument network + SPA renders
  S.on('Network.requestWillBeSent', (p) => {
    metrics.networkRequests++;
    const u = p.request.url;
    if (u.includes('/api/')) metrics.apiRequests.push({ url: u.replace(BASE, ''), method: p.request.method, at: Date.now() - t0 });
  });
  S.on('Page.loadEventFired', () => { metrics.pageRenders++; ev('page-load', null); });
  S.on('Runtime.consoleAPICalled', (p) => {
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400);
    if (p.type === 'error' || p.type === 'warning') metrics.errors.push({ step: 'console', type: p.type, err: txt });
  });
  S.on('Runtime.exceptionThrown', (p) => {
    metrics.errors.push({ step: 'exception', err: (p.exceptionDetails?.text || '') + ' ' + (p.exceptionDetails?.exception?.description || '').slice(0, 400) });
  });

  const email = `ux${TAG}${Date.now().toString(36)}@mailinator.com`;
  const password = 'Test1234abc';
  const fullName = 'UX Test';
  const RUN = { email, password, fullName, base: BASE };
  stage('start');

  /* ---- Step 1: landing ---- */
  await navigate(BASE + '/', 'landing');
  await waitFor('#app');
  await shot('01-landing');
  stage('01_landing_loaded');

  /* ---- Step 2: register ---- */
  await navigate(BASE + '/#/register', 'register');
  await waitFor('#reg-form');
  await shot('02-register-form');
  stage('02_register_form_shown');

  await typeInto('#rg-name', fullName, 'fullName');
  await typeInto('#rg-email', email, 'email');
  await typeInto('#rg-pwd', password, 'password');
  await shot('03-register-filled');
  stage('03_register_filled');

  await click('#reg-submit', 'Đăng ký');
  metrics.formsSubmitted++;
  const regOk = await waitUntil(
    `!document.querySelector('#reg-form') || document.body.innerText.includes('Chào mừng')`,
    30000, 'register success'
  );
  await shot('04-after-register');
  stage('04_registered', { ok: regOk >= 0 });
  if (regOk < 0) {
    const err = await evalJs(`(document.querySelector('#reg-error')||{}).textContent || ''`);
    metrics.errors.push({ step: 'register', err });
    throw new Error('register failed: ' + err);
  }

  /* ---- Step 3: wallet / topup ---- */
  await navigate(BASE + '/#/wallet', 'wallet');
  await waitFor('#topup-amount');
  await shot('05-wallet');
  stage('05_wallet_loaded');

  await click('[data-quick="200000"]', 'quick 200.000');
  await shot('06-amount-selected');
  await click('#btn-create-topup', 'Tạo mã QR nạp tiền');
  metrics.formsSubmitted++;
  await waitFor('#topup-qr-area img');
  await shot('07-qr-shown');
  stage('07_qr_shown');

  const topupInfo = await evalJs(`(() => {
    const t = document.body.innerText;
    return { hasQr: !!document.querySelector('#topup-qr-area img'),
             memo: (t.match(/NAP[A-Z0-9]{5}/)||[''])[0] };
  })()`);
  Object.assign(RUN, topupInfo);

  /* ---- Step 4: product -> cart -> checkout ---- */
  const prodSlug = args.slug || 'license-xarena-thang';
  await navigate(BASE + '/#/product/' + prodSlug, 'product');
  await waitFor('#btn-buy-now');
  await shot('08-product');
  stage('08_product_loaded');

  await click('#btn-buy-now', 'Mua ngay');
  const wentLogin = await waitUntil(
    `location.hash.includes('/login') || location.hash.includes('/checkout')`, 15000, 'buy-now nav');
  await shot('09-after-buynow');
  stage('09_buynow_clicked', { hash: await evalJs('location.hash') });

  /* ---- Step 5: checkout attempt with 0 balance (the real wall) ---- */
  const hash = await evalJs('location.hash');
  if (hash.includes('/login')) {
    // need to log back in after redirect? We should still be logged in.
    metrics.errors.push({ step: 'buynow', err: 'redirected to login despite session' });
    await navigate(BASE + '/#/checkout?mode=buynow', 'checkout-direct');
  }
  await waitFor('#btn-place-order', 20000);
  await shot('10-checkout');
  stage('10_checkout_ready');

  const balBefore = await evalJs(`(document.querySelector('#wallet-balance')||{}).textContent||''`);
  await click('#btn-place-order', 'Xác nhận thanh toán');
  metrics.formsSubmitted++;
  await sleep(2500);
  await shot('11-checkout-result');
  const afterPay = await evalJs(`({
    hash: location.hash,
    body: document.body.innerText.slice(0,600)
  })`);
  stage('11_payment_attempted', { balance: balBefore, hash: afterPay.hash });
  RUN.paymentBlocked = /nạp thêm|Số dư|không đủ/i.test(afterPay.body);

  /* ---- Step 6: what the success page would give ---- */
  const licensesProbe = await evalJs(`fetch('/api/licenses/mine',{credentials:'include'}).then(r=>r.json()).then(j=>({n:(j.licenses||[]).length}))`).catch((e) => ({ err: String(e) }));

  stage('done');

  /* ---- Report ---- */
  const totalMs = Date.now() - t0;
  const report = {
    tag: TAG,
    base: BASE,
    run: RUN,
    totalMs,
    totalSec: +(totalMs / 1000).toFixed(1),
    metrics,
    stages,
    events,
    licenses: licensesProbe,
    derived: {
      clicks: metrics.clicks,
      charsTyped: metrics.keystrokes,
      keyPresses: metrics.keyPresses,
      navigations: metrics.navigations,
      pageLoads: metrics.pageRenders,
      apiCalls: metrics.apiRequests.length,
      distinctScreens: metrics.screens.length,
      totalWaitsMs: metrics.waits.reduce((s, w) => s + Math.max(0, w.ms), 0),
      humanActions: metrics.clicks + metrics.keystrokes,
    },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.derived, null, 2));
  console.log('report:', OUT);

  cdp.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
}

main().catch((e) => {
  console.error('FATAL', e.message);
  console.error(JSON.stringify({ stages, events: events.slice(-25) }, null, 2));
  process.exit(1);
});
