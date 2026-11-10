import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://xienhl.com';
mkdirSync('shots', { recursive: true });

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
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('EXC: ' + d.text + ' | ' + (d.exception?.description || '').slice(0, 250));
    }
  };
}
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method: m, params: p }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(x) {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
  return r.result?.value;
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n🔍 Debug trang product\n');
  await send('Page.navigate', { url: BASE + '/#/product/license-xarena-thang' });
  await wait(3500);

  console.log('  URL:', await ev('location.hash'));
  console.log('  #app tồn tại:', await ev("!!document.getElementById('app')"));
  console.log('  #app innerHTML len:', await ev("document.getElementById('app')?.innerHTML?.length"));
  console.log('  body text:', (await ev("document.body.innerText") || '').slice(0, 300).replace(/\n/g, ' | '));

  console.log('\n  --- Logs ---');
  if (logs.length === 0) console.log('    (không có)');
  else logs.slice(0, 12).forEach((l) => console.log('    ' + l));

  // Thử load module trực tiếp
  console.log('\n  --- Thử import module ---');
  console.log('  product-detail:', await ev(`(async()=>{
    try{ const m=await import('/assets/pages/product-detail.js'); return 'ok: '+Object.keys(m).join(','); }
    catch(e){ return 'ERR: '+e.message; }
  })()`));
  console.log('  checkout:', await ev(`(async()=>{
    try{ const m=await import('/assets/pages/checkout.js'); return 'ok: '+Object.keys(m).join(','); }
    catch(e){ return 'ERR: '+e.message; }
  })()`));

  // Kiểm tra API sản phẩm
  console.log('\n  --- API sản phẩm ---');
  const p = await ev(`(async()=>{
    const r = await fetch('/api/products');
    const d = await r.json();
    const found = (d.products||[]).find(x=>x.slug==='license-xarena-thang');
    return JSON.stringify({tong:(d.products||[]).length, timThay:!!found, slug:found?.slug});
  })()`);
  console.log('  ', p);

  ws.close();
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
