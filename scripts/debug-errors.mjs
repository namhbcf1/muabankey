import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9222';
let ws, id = 0;
const p = new Map();
const errs = [];

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
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; p.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? 'EVAL_ERR:' + (r.exceptionDetails.exception?.description || '') : r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  await send('Page.navigate', { url: 'https://xienhl.com/' });
  await wait(4000);
  await ev("fetch('/api/auth/logout',{method:'POST'})");
  await wait(500);
  await send('Page.navigate', { url: 'https://xienhl.com/' });
  await wait(4000);

  console.log('\n=== Bấm nút, theo dõi lỗi ===\n');
  await ev("document.querySelector('[data-trial-kind=\"1h\"]')?.click()");
  await wait(10000);

  console.log('Số modal:', await ev('document.querySelectorAll(".modal-overlay").length'));
  console.log('Có curl:', await ev('document.body.innerHTML.includes("curl -L -o")'));

  // Gọi thẳng API để xem response
  const apiRes = await ev(`
    fetch('/api/trial/command', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({kind:'1h'})
    }).then(r => r.text()).then(t => t.slice(0, 300))
  `);
  console.log('\nAPI trả trực tiếp:', apiRes);

  if (errs.length) {
    console.log('\n=== LỖI JS ===');
    errs.slice(0, 5).forEach((e) => console.log('•', String(e).slice(0, 300)));
  } else {
    console.log('\nKhông có lỗi JS');
  }

  ws.close();
})();
