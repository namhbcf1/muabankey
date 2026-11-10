/**
 * Kiểm chứng từng tab admin chuyển đúng trên viewport hẹp.
 *
 * Nguyên tắc: xác nhận bằng `location.hash` + nhãn tab đang active, không tin
 * ảnh chụp. Script chụp ảnh trước đó báo lệch nhãn — cần biết đó là lỗi thật
 * hay chỉ là thời điểm đo.
 *
 * Cách dùng: node scripts/verify-admin-tabs.mjs <baseUrl> <cookie> [width]
 */
const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';
const WIDTH = Number(process.argv[4] || 390);
const HEIGHT = WIDTH < 500 ? 844 : 900;

if (!COOKIE) { console.error('Thiếu cookie.'); process.exit(1); }

let ws; let msgId = 0;
const pending = new Map();

const list = await (await fetch(CDP + '/json/list')).json();
const target = list.find((x) => x.type === 'page');
ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.clearBrowserCache');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: BASE + '/index.html' });
await sleep(1200);

const eq = COOKIE.indexOf('=');
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: BASE + '/', path: '/',
});
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 500,
});
await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#/admin` });
await sleep(3500);

const tabs = JSON.parse((await send('Runtime.evaluate', {
  expression: "JSON.stringify([...document.querySelectorAll('.admin-nav-item')].map((b,i)=>({i,label:b.textContent.trim()})))",
  returnByValue: true,
})).result.value);

console.log(`Viewport ${WIDTH}px — ${tabs.length} tab\n`);
let bad = 0;
for (const tab of tabs) {
  await send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.admin-nav-item')[${tab.i}].click()`,
  });
  await sleep(2400);
  const r = JSON.parse((await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hash: location.hash,
      active: (document.querySelector('.admin-nav-item.active')||{}).textContent?.trim()||'',
      activeCount: document.querySelectorAll('.admin-nav-item.active').length,
      len: (document.getElementById('app')||{}).innerHTML.length,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth
    })`,
    returnByValue: true,
  })).result.value);

  const ok = r.active === tab.label && r.activeCount === 1 && r.over <= 1;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} "${tab.label}" -> hash=${r.hash} active="${r.active}" count=${r.activeCount} over=${r.over}px len=${r.len}`);
}
console.log(bad === 0 ? '\n✓ Mọi tab chuyển đúng.' : `\n✗ ${bad}/${tabs.length} tab sai.`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
