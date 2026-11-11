const CDP = 'http://127.0.0.1:9222';
const B = 'https://xienhl.com';
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
      errs.push(m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text);
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
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log('\n🔍 DEBUG ĐĂNG KÝ\n');

  await send('Page.navigate', { url: B + '/#/register' });
  await wait(6000);

  const hasForm = await ev('!!document.querySelector("#rg-user")');
  console.log('  Form có:', hasForm);
  console.log('  body đầu:', String(await ev('document.body.innerText')).slice(0, 150).replace(/\n/g, ' | '));

  if (errs.length) {
    console.log('\n  LỖI JS:');
    errs.slice(0, 5).forEach((e) => console.log('   • ' + String(e).slice(0, 250)));
  } else {
    console.log('\n  Không có lỗi JS');
  }

  ws.close();
})();
