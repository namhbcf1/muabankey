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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'https://xienhl.com/' });
  await wait(4500);

  const stats = await ev(`JSON.stringify(Array.from(document.querySelectorAll('[data-stat]')).map(e => e.dataset.stat + '=' + e.textContent))`);
  console.log('  Số liệu trang chủ:', stats);

  const txt = await ev(`document.body.innerText`);
  const fake = ['12.480', '12480', '215', '99%'];
  const found = fake.filter((f) => txt.includes(f));
  console.log('  Số bịa còn:', found.length ? 'CÓ → ' + found.join(', ') : 'KHÔNG (OK)');

  const trial = await ev(`!!document.getElementById('trial-section')`);
  console.log('  Khối dùng thử:', trial ? 'OK' : 'KHÔNG THẤY');

  ws.close();
})();
