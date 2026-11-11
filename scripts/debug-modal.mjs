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
    return r.exceptionDetails ? 'ERR:' + (r.exceptionDetails.exception?.description || '') : r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: 'https://xienhl.com/' });
  await wait(4000);
  await ev("fetch('/api/auth/logout',{method:'POST'})");
  await wait(600);
  await send('Page.navigate', { url: 'https://xienhl.com/' });
  await wait(4000);

  console.log('\n🔍 DEBUG MODAL\n');

  console.log('Bấm nút 1h...');
  await ev("document.querySelector('[data-trial-kind=\"1h\"]')?.click()");
  await wait(9000);

  const n = await ev('document.querySelectorAll(".modal-overlay").length');
  console.log('Số modal:', n);

  const titles = await ev('JSON.stringify(Array.from(document.querySelectorAll(".modal-title")).map(e => e.textContent.trim()))');
  console.log('Tiêu đề:', titles);

  const hasCurl = await ev('document.body.innerHTML.includes("curl -L -o")');
  console.log('Có curl trong DOM:', hasCurl);

  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
  });
  writeFileSync('shots/debug-modal.png', Buffer.from(data, 'base64'));
  console.log('📸 shots/debug-modal.png');

  ws.close();
})();
