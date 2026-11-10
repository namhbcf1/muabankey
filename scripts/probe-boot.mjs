const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://xienhl.com';

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
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
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
  if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');

  console.log('\n🔬 Kiem tra chi tiet\n');
  await send('Page.navigate', { url: BASE + '/' });
  await wait(3000);

  console.log('  1. app.js load duoc?', await ev(`(async()=>{
    try { const m = await import('/assets/app.js'); return 'OK'; }
    catch(e){ return 'ERR: ' + e.message; }
  })()`));

  console.log('  2. components.js?', await ev(`(async()=>{
    try { const m = await import('/assets/components.js'); return 'OK: ' + Object.keys(m).length + ' exports'; }
    catch(e){ return 'ERR: ' + e.message; }
  })()`));

  console.log('  3. state.js?', await ev(`(async()=>{
    try { const m = await import('/assets/state.js'); return 'OK: ' + Object.keys(m).length + ' exports'; }
    catch(e){ return 'ERR: ' + e.message; }
  })()`));

  console.log('  4. lib.js?', await ev(`(async()=>{
    try { const m = await import('/assets/lib.js'); return 'OK: store=' + (typeof m.store); }
    catch(e){ return 'ERR: ' + e.message; }
  })()`));

  console.log('  5. Tat ca pages?');
  for (const p of ['home', 'products', 'product-detail', 'auth', 'checkout', 'account', 'orders', 'wallet', 'support', 'licenses', 'admin']) {
    const r = await ev(`(async()=>{
      try { const m = await import('/assets/pages/${p}.js'); return 'OK'; }
      catch(e){ return 'ERR: ' + e.message; }
    })()`);
    console.log(`     ${p.padEnd(16)} ${r}`);
  }

  // Set hash va xem render truc tiep
  console.log('\n  6. Render thu home truc tiep:');
  const r = await ev(`(async()=>{
    const m = await import('/assets/pages/home.js');
    try {
      const html = m.renderHome({}, null);
      return 'renderHome OK, len=' + html.length;
    } catch(e){ return 'renderHome ERR: ' + e.message; }
  })()`);
  console.log('     ' + r);

  console.log('\n  7. Render thu product-detail:');
  const r2 = await ev(`(async()=>{
    const m = await import('/assets/pages/product-detail.js');
    try {
      const html = m.renderProductDetail({}, 'license-xarena-thang');
      return 'render OK, len=' + html.length;
    } catch(e){ return 'ERR: ' + e.message; }
  })()`);
  console.log('     ' + r2);

  console.log('\n  8. Router chay chua?');
  console.log('     hash:', await ev('location.hash'));
  console.log('     hasBoot:', await ev("!!document.querySelector('.boot-screen')"));
  console.log('     header:', await ev("!!document.querySelector('#site-header')?.innerHTML"));

  ws.close();
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
