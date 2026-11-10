import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://xienhl.com';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();
const logs = [];

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
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
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
  if (r.exceptionDetails) return 'ERR: ' + r.exceptionDetails.text;
  return r.result?.value;
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n🔍 Debug\n');
  await send('Page.navigate', { url: BASE + '/#/' });
  await wait(3200);

  // Kiểm tra hàm onclick đã gán chưa
  const btnInfo = await ev(`(() => {
    const b = document.querySelector('[data-start-trial]');
    if (!b) return 'no button';
    return JSON.stringify({
      tag: b.tagName,
      hasOnclick: !!b.onclick,
      text: b.textContent.trim().slice(0, 30),
    });
  })()`);
  console.log('  Nút:', btnInfo);

  // Thử gọi trực tiếp
  logs.length = 0;
  const clickResult = await ev(`(() => {
    try {
      const b = document.querySelector('[data-start-trial]');
      b.click();
      return 'clicked';
    } catch (e) { return 'ERR: ' + e.message; }
  })()`);
  await wait(1500);

  console.log('  Click:', clickResult);
  console.log('  Modal sau click:', await ev("!!document.querySelector('.modal-overlay')"));
  console.log('  open class:', await ev("!!document.querySelector('.modal-overlay.open')"));

  // Kiểm tra module home có export showTrialModal không
  const modCheck = await ev(`(async () => {
    try {
      const m = await import('/assets/pages/home.js');
      return 'exports: ' + Object.keys(m).join(',');
    } catch (e) { return 'ERR load: ' + e.message; }
  })()`);
  console.log('  Module home.js:', modCheck);

  console.log('\n  Console/exception logs:');
  if (logs.length === 0) console.log('    (không có)');
  else logs.slice(0, 10).forEach((l) => console.log('    ' + l));

  // Kiểm tra admin topups - trang đã load chưa
  console.log('\n💰 Admin topups\n');
  await send('Page.navigate', { url: BASE + '/#/login' });
  await wait(2400);
  await ev(`(() => {
    const e = document.querySelector('#lg-email'), p = document.querySelector('#lg-pwd');
    if (!e) return 0;
    e.value = 'namhbcf'; p.value = 'namhbcf123';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return 1;
  })()`);
  await wait(3500);

  logs.length = 0;
  await send('Page.navigate', { url: BASE + '/#/admin?tab=topups' });
  await wait(3500);

  const adminState = await ev(`(() => {
    const content = document.querySelector('#admin-content');
    return JSON.stringify({
      hasContent: !!content,
      text: content ? content.innerText.slice(0, 200).replace(/\\n+/g, ' | ') : null,
      rows: document.querySelectorAll('tbody tr').length,
      hasStatGrid: !!document.querySelector('.stat-grid'),
    });
  })()`);
  console.log('  Admin state:', adminState);

  const adminLogs = logs.filter((l) => l.includes('ERR') || l.includes('EXCEPTION') || l.includes('error'));
  if (adminLogs.length) {
    console.log('  Logs:');
    adminLogs.slice(0, 5).forEach((l) => console.log('    ' + l));
  }

  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
