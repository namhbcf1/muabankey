import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://xienhl.com';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function shot(name, h = 900) {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 },
  });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  📸 ${OUT}/${name}.png`);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n🌐 Kiểm tra xienhl.com\n');

  const pages = [
    ['50-domain-home', '/', 1600],
    ['51-domain-license', '/products?category=license-xarena', 1400],
  ];
  for (const [name, path, h] of pages) {
    await send('Page.navigate', { url: BASE + '/#' + path });
    await wait(2800);
    await shot(name, h);
    const title = await ev('document.title');
    console.log(`  ${path} → "${title}"`);
  }

  // Đăng nhập + wallet để thấy QR
  await send('Page.navigate', { url: BASE + '/#/login' });
  await wait(2400);
  await ev(`(() => {
    const e = document.querySelector('#lg-email'), p = document.querySelector('#lg-pwd');
    e.value = 'demo'; p.value = 'Demo@123456';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return 1;
  })()`);
  await wait(3200);

  await send('Page.navigate', { url: BASE + '/#/wallet' });
  await wait(3000);

  // Tạo QR
  const made = await ev(`(() => {
    const inp = document.querySelector('#topup-amount');
    if (!inp) return 'no-form';
    inp.value = '200.000';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#btn-create-topup')?.click();
    return 'clicked';
  })()`);
  console.log('  Tạo QR:', made);
  await wait(3500);
  await shot('52-domain-wallet-qr', 1300);

  const qrSrc = await ev(`document.querySelector('#topup-qr-area img')?.src || 'không có QR'`);
  console.log('  QR URL:', qrSrc.slice(0, 90) + '...');
  const bank = await ev(`document.querySelector('#topup-qr-area')?.innerText?.slice(0, 200) || ''`);
  console.log('  Thông tin:', bank.replace(/\n+/g, ' | '));

  console.log('\n✨ Xong\n');
  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
