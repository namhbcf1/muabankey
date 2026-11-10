/**
 * Chụp trọn trang (full-page) cho các tab dài, để rà phần nằm dưới màn hình.
 * node scripts/shoot-admin-full.mjs <baseUrl> <cookie> [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';
const OUT = process.argv[4] || 'shots/admin/full';
mkdirSync(OUT, { recursive: true });

let ws; let id = 0; const p = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; p.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});

const created = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p.has(m.id)) {
    const q = p.get(m.id); p.delete(m.id);
    m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? null : r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: BASE + '/#/' });
await sleep(800);
const eq = COOKIE.indexOf('=');
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), domain: '127.0.0.1', path: '/',
});
await send('Page.navigate', { url: 'about:blank' });
await sleep(250);

const W = Number(process.argv[5] || 1440);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700 });

for (const tab of ['settings', 'topups', 'keys', 'trial', 'licenses', 'orders']) {
  await send('Page.navigate', { url: `${BASE}/#/admin?tab=${tab}` });
  await sleep(2400);
  const h = await ev('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: Math.min(h || 2000, 6000), deviceScaleFactor: 1, mobile: W < 700,
  });
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${OUT}/full-${W}-${tab}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`  full-${W}-${tab}.png  height=${h}`);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700 });
}

ws.close();
await fetch(CDP + '/json/close/' + created.id).catch(() => {});
