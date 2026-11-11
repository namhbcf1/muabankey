import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9222';
let ws, id = 0;
const p = new Map();

(async () => {
  const l = await (await fetch(CDP + '/json/list')).json();
  const t = l.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const q = p.get(m.id); p.delete(m.id);
      m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; p.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || '');
    return r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Login
  await send('Page.navigate', { url: 'https://xienhl.com/#/login' });
  await wait(5000);
  await ev(`(function(){
    var e=document.querySelector('#lg-email'), p=document.querySelector('#lg-pwd');
    if(!e) return 0;
    e.value='namhbcf'; p.value='namhbcf123';
    e.dispatchEvent(new Event('input',{bubbles:true}));
    p.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  })()`);
  await wait(5000);

  // Hard reload admin
  await send('Page.navigate', { url: 'https://xienhl.com/#/admin?tab=whitelist' });
  await wait(6000);
  // Force reload mạnh
  await send('Page.reload', { ignoreCache: true });
  await wait(7000);

  const nav = await ev("document.body.innerText.includes('Vô hạn')");
  const rows = await ev('document.querySelectorAll("tbody tr").length');
  const hasAdd = await ev('!!document.querySelector("[data-add]")');
  const bodyStart = await ev("document.body.innerText.slice(0,200)");

  console.log('\n⭐ WHITELIST UI (hard reload)\n');
  console.log('  Tab "Vô hạn" :', nav ? 'OK' : 'THIẾU');
  console.log('  Số dòng      :', rows);
  console.log('  Nút Thêm     :', hasAdd ? 'OK' : 'THIẾU');
  console.log('  Body đầu     :', String(bodyStart).replace(/\n/g, ' | ').slice(0, 120));

  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: 1000, scale: 1 },
  });
  writeFileSync('shots/99-whitelist.png', Buffer.from(data, 'base64'));
  console.log('  📸 shots/99-whitelist.png');

  ws.close();
})();
