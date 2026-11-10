/**
 * Chụp ảnh giao diện từng trang bằng CDP + kiểm tra lỗi console.
 * Usage: node scripts/screenshot.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://muabankey.bangachieu2.workers.dev';
const OUT = 'shots';

mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  let target = list.find((t) => t.type === 'page');
  if (!target) {
    target = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  }
  const WebSocketImpl = globalThis.WebSocket;
  if (!WebSocketImpl) throw new Error('Cần Node 22+ có WebSocket toàn cục');
  ws = new WebSocketImpl(target.webSocketDebuggerUrl);
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
      pageErrors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
    } else if (m.method === 'Network.loadingFailed') {
      failedRequests.push(m.params.errorText);
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

async function shot(name, fullPage = true) {
  let params = { format: 'png' };
  if (fullPage) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0, y: 0,
        width: Math.min(cssContentSize.width, 1440),
        height: Math.min(cssContentSize.height, 4000),
        scale: 1,
      },
    };
  }
  const { data } = await send('Page.captureScreenshot', params);
  const path = `${OUT}/${name}.png`;
  writeFileSync(path, Buffer.from(data, 'base64'));
  console.log(`  📸 ${path}`);
}

async function goto(url, waitMs = 2600) {
  consoleErrors.length = 0; pageErrors.length = 0; failedRequests.length = 0;
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, waitMs));
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
}

async function login(email, password) {
  return evaluate(`(async()=>{
    const r = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'${email}',password:'${password}'})});
    return r.status;
  })()`);
}

function report(label) {
  const bad = consoleErrors.filter((e) => !/favicon|fonts\.g/i.test(e));
  const status = bad.length === 0 && pageErrors.length === 0 ? '✅' : '⚠️';
  console.log(`  ${status} ${label}: ${bad.length} console errors, ${pageErrors.length} exceptions`);
  for (const e of bad.slice(0, 3)) console.log(`     · console: ${e.slice(0, 180)}`);
  for (const e of pageErrors.slice(0, 3)) console.log(`     · exception: ${e.slice(0, 180)}`);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  console.log('\n🖥️  Chụp giao diện desktop\n');

  const pages = [
    ['01-home', '/'],
    ['02-products', '/products'],
    ['03-product-detail', '/product/windows-11-pro'],
    ['04-support', '/support'],
    ['05-login', '/login'],
    ['06-register', '/register'],
  ];

  for (const [name, path] of pages) {
    await goto(BASE + '/#' + path);
    await shot(name);
    report(path);
  }

  // Đăng nhập user demo → các trang cần auth
  console.log('\n🔑 Đăng nhập user demo');
  const loginStatus = await login('demo@muabankey.vn', 'Demo@123456');
  console.log('  login status:', loginStatus);

  for (const [name, path] of [['07-account', '/account'], ['08-orders', '/orders'], ['09-wallet', '/wallet']]) {
    await goto(BASE + '/#' + path);
    await shot(name);
    report(path);
  }

  // Checkout với sản phẩm trong giỏ
  console.log('\n🛒 Thêm vào giỏ & checkout');
  await goto(BASE + '/#/product/chatgpt-plus');
  await evaluate(`(()=>{ const b=document.querySelector('#btn-add-cart'); if(b){b.click(); return 'clicked';} return 'no button'; })()`);
  await new Promise((r) => setTimeout(r, 1200));
  await evaluate(`(()=>{ const b=document.querySelector('#btn-cart'); if(b) b.click(); return 1; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await shot('10-cart-drawer');
  await goto(BASE + '/#/checkout');
  await shot('11-checkout');
  report('/checkout');

  // Admin
  console.log('\n⚙️  Đăng nhập admin');
  const adminStatus = await login('admin@muabankey.vn', 'Admin@123456');
  console.log('  admin login:', adminStatus);
  for (const [name, tab] of [['12-admin-dashboard', 'dashboard'], ['13-admin-orders', 'orders'], ['14-admin-products', 'products']]) {
    await goto(BASE + `/#/admin?tab=${tab}`, 3000);
    await shot(name);
    report('/admin?tab=' + tab);
  }

  // Mobile
  console.log('\n📱 Giao diện mobile');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await goto(BASE + '/#/');
  await shot('15-mobile-home');
  await goto(BASE + '/#/products');
  await shot('16-mobile-products');
  await goto(BASE + '/#/product/netflix-premium');
  await shot('17-mobile-detail');

  console.log('\n✨ Hoàn tất\n');
  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
