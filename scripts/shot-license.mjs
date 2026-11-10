/**
 * Chụp giao diện + kiểm tra luồng license end-to-end qua trình duyệt thật.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://muabankey.bangachieu2.workers.dev';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();
let consoleErrors = [];
let pageErrors = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  let target = list.find((t) => t.type === 'page');
  if (!target) target = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  const WSImpl = globalThis.WebSocket;
  ws = new WSImpl(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails.text);
    }
  };
}

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function shot(name, full = true) {
  let params = { format: 'png' };
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    params = {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(cssContentSize.width, 1440),
              height: Math.min(cssContentSize.height, 4500), scale: 1 },
    };
  }
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  📸 ${OUT}/${name}.png`);
}

async function goto(url, wait = 2800) {
  consoleErrors = []; pageErrors = [];
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, wait));
}

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
}

function check(label) {
  const bad = consoleErrors.filter((e) => !/favicon|fonts\.g/i.test(e));
  const okFlag = bad.length === 0 && pageErrors.length === 0;
  console.log(`  ${okFlag ? '✅' : '⚠️'} ${label}: ${bad.length} console, ${pageErrors.length} exception`);
  for (const e of bad.slice(0, 2)) console.log(`     · ${e.slice(0, 150)}`);
  for (const e of pageErrors.slice(0, 2)) console.log(`     · ${e.slice(0, 150)}`);
}

async function login(email, password) {
  // Đăng nhập qua form thật để SPA cập nhật state
  await send('Page.navigate', { url: BASE + '/#/login' });
  await new Promise((r) => setTimeout(r, 2500));
  await ev(`(()=>{
    const e=document.querySelector('#lg-email'), p=document.querySelector('#lg-pwd');
    if(!e||!p) return 'no form';
    e.value='${email}'; p.value='${password}';
    e.dispatchEvent(new Event('input',{bubbles:true}));
    p.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return 'submitted';
  })()`);
  await new Promise((r) => setTimeout(r, 3000));
  const who = await ev(`(async()=>{const r=await fetch('/api/auth/me');const d=await r.json();return d.user?d.user.email:'anon';})()`);
  return who;
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n🖥️  Giao diện desktop\n');

  await goto(BASE + '/#/');
  await shot('20-home'); check('trang chủ');

  await goto(BASE + '/#/products?category=license-xarena');
  await shot('21-license-products'); check('sản phẩm license');

  await goto(BASE + '/#/product/license-xarena-thang');
  await shot('22-license-detail'); check('chi tiết gói tháng');

  // Đăng nhập demo
  console.log('\n🔑 Đăng nhập demo');
  const st = await login('demo@muabankey.vn', 'Demo@123456');
  console.log('  login:', st);

  await goto(BASE + '/#/licenses');
  await shot('23-my-licenses'); check('License của tôi');

  // Admin
  console.log('\n⚙️  Admin');
  await login('admin@muabankey.vn', 'Admin@123456');
  await goto(BASE + '/#/admin?tab=licenses', 3200);
  await shot('24-admin-licenses'); check('admin licenses');

  await goto(BASE + '/#/admin?tab=dashboard', 3000);
  await shot('25-admin-dashboard'); check('admin dashboard');

  // Mobile
  console.log('\n📱 Mobile');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto(BASE + '/#/licenses');
  await shot('26-mobile-licenses'); check('mobile license');

  console.log('\n✨ Xong\n');
  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
