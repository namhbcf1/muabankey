import { mkdirSync } from 'node:fs';

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
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({
        text: d.text,
        desc: (d.exception?.description || '').slice(0, 500),
        url: d.url,
        line: d.lineNumber,
        col: d.columnNumber,
        stack: (d.stackTrace?.callFrames || []).slice(0, 4).map(
          (f) => `${f.functionName || '(anon)'} @ ${f.url}:${f.lineNumber}`).join('\n    '),
      });
    } else if (m.method === 'Log.entryAdded') {
      logs.push({ text: 'LOG ' + m.params.entry.level + ': ' + m.params.entry.text, url: m.params.entry.url });
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
  await send('Log.enable');

  console.log('\n🔍 Tim nguon loi SyntaxError\n');

  // Load trang sach
  logs.length = 0;
  await send('Page.navigate', { url: BASE + '/#/product/license-xarena-thang' });
  await wait(4000);

  console.log('  #app len:', await ev("document.getElementById('app')?.innerHTML?.length"));
  console.log('');

  if (logs.length === 0) {
    console.log('  (khong co log)');
  } else {
    for (const l of logs) {
      if (l.desc || l.text.startsWith('LOG')) {
        console.log('  ---');
        console.log('  Text:', l.text);
        if (l.url) console.log('  URL :', l.url, 'line', l.line, 'col', l.col);
        if (l.desc) console.log('  Desc:', l.desc.slice(0, 300));
        if (l.stack) console.log('  Stack:\n    ' + l.stack);
      }
    }
  }

  // Thu load tung trang de xem trang nao loi
  console.log('\n--- Thu tung trang ---');
  for (const route of ['/', '/products', '/licenses', '/wallet', '/support']) {
    logs.length = 0;
    await send('Page.navigate', { url: BASE + '/#' + route });
    await wait(2000);
    const len = await ev("document.getElementById('app')?.innerHTML?.length");
    const err = logs.find((l) => l.desc);
    console.log(`  ${route.padEnd(12)} app=${String(len).padStart(6)} ${err ? '❌ ' + (err.desc || '').split('\n')[0].slice(0, 70) : '✅'}`);
  }

  ws.close();
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
