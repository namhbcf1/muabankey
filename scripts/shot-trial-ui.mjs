import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://xienhl.com';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();
const errs = [];

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
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.text);
    }
  };
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(x) {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
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

  console.log('\n🎁 Kiểm tra UI dùng thử\n');

  await send('Page.navigate', { url: BASE + '/#/' });
  await wait(3000);

  // Kiểm tra khối trial có hiện không
  const hasTrial = await ev("!!document.getElementById('trial-section')");
  console.log('  Khối trial hiển thị:', hasTrial ? '✅' : '❌');
  const btnText = await ev("document.querySelector('[data-start-trial]')?.textContent?.trim()");
  console.log('  Nút dùng thử:', btnText || '❌ không thấy');

  await shot('60-home-trial', 1700);

  // Bấm nút dùng thử
  await ev("document.querySelector('[data-start-trial]')?.click()");
  await wait(1200);
  const modalOpen = await ev("!!document.querySelector('.modal-overlay.open')");
  console.log('  Modal mở:', modalOpen ? '✅' : '❌');
  const modalTitle = await ev("document.querySelector('.modal-overlay.open .modal-title')?.textContent?.trim()");
  console.log('  Tiêu đề:', modalTitle);
  const dlLink = await ev("document.querySelector('.modal-overlay.open a[download]')?.href");
  console.log('  Link tải:', dlLink);

  await shot('61-trial-modal', 900);

  // Đóng modal, kiểm tra admin topups
  await ev("document.querySelector('[data-close]')?.click()");
  await wait(600);

  console.log('\n💰 Kiểm tra trang admin nạp tiền\n');
  await send('Page.navigate', { url: BASE + '/#/login' });
  await wait(2400);
  await ev(`(() => {
    const e = document.querySelector('#lg-email'), p = document.querySelector('#lg-pwd');
    if (!e) return 'no form';
    e.value = 'namhbcf'; p.value = 'namhbcf123';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return 1;
  })()`);
  await wait(3200);

  await send('Page.navigate', { url: BASE + '/#/admin?tab=topups' });
  await wait(3200);
  const rows = await ev("document.querySelectorAll('tbody tr').length");
  const stats = await ev("document.querySelector('.stat-grid')?.innerText?.replace(/\\n+/g,' | ')");
  console.log('  Số dòng topup:', rows);
  console.log('  Thống kê:', stats);
  await shot('62-admin-topups', 1100);

  console.log('\n  Số exception:', errs.length);
  if (errs.length) errs.slice(0, 3).forEach((e) => console.log('   ', e));

  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
