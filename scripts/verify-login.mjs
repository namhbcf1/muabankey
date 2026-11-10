import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://muabankey.bangachieu2.workers.dev';
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: 760, scale: 1 },
  });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  📸 ${OUT}/${name}.png`);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n🔐 Kiểm tra đăng nhập bằng username\n');

  await send('Page.navigate', { url: BASE + '/#/login' });
  await wait(2600);

  const ph = await ev("document.querySelector('#lg-email')?.placeholder");
  const lb = await ev("document.querySelector('label[for=\"lg-email\"]')?.textContent?.trim()");
  console.log('  Label      :', lb);
  console.log('  Placeholder:', ph);
  await shot('40-login-page');

  // Đăng nhập bằng USERNAME
  await ev(`(() => {
    const e = document.querySelector('#lg-email'), p = document.querySelector('#lg-pwd');
    e.value = 'namhbcf'; p.value = 'namhbcf123';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return 1;
  })()`);
  await wait(3500);

  const who = await ev("(async () => { const d = await (await fetch('/api/auth/me')).json(); return d.user ? (d.user.username + ' | ' + d.user.role) : 'anon'; })()");
  const hash = await ev('location.hash');
  console.log('\n  Đăng nhập bằng username:');
  console.log('    kết quả   :', who);
  console.log('    chuyển tới:', hash);

  await shot('41-admin-after-login');

  // Vào tab settings xem ngân hàng
  await send('Page.navigate', { url: BASE + '/#/admin?tab=settings' });
  await wait(3200);
  const bank = await ev("document.querySelector('#st-acc')?.value + ' | ' + document.querySelector('#st-bank')?.value + ' | ' + document.querySelector('#st-owner')?.value");
  console.log('\n  Ngân hàng trong admin settings:');
  console.log('   ', bank);
  await shot('42-admin-settings-bank');

  // Trang wallet của admin
  await send('Page.navigate', { url: BASE + '/#/wallet' });
  await wait(3200);
  await shot('43-wallet');

  console.log('\n✨ Xong\n');
  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
