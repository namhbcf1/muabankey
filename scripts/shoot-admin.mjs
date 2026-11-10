/**
 * Duyệt từng tab của trang quản trị và chụp ảnh + bắt lỗi.
 *
 * Trang admin là nơi dễ hỏng nhất vì mỗi tab là một nhánh render riêng; chụp
 * mỗi ảnh trang mặc định không đủ để biết tab nào hỏng.
 *
 * Cách dùng: node scripts/shoot-admin.mjs <baseUrl> <cookie> [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';
const OUT = process.argv[4] || 'shots/admin';
if (!COOKIE) { console.error('Thiếu cookie admin.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

let ws; let msgId = 0;
const pending = new Map();
let errs = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push('console: ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' '));
    }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.clearBrowserCache');
await send('Network.setCacheDisabled', { cacheDisabled: true });

await send('Page.navigate', { url: BASE + '/index.html' });
await sleep(1000);
const eq = COOKIE.indexOf('=');
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: BASE + '/', path: '/',
});

const results = [];
for (const [vpName, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: vpName === 'mobile',
  });

  errs = [];
  await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#/admin` });
  await sleep(3200);

  // Liệt kê tab có thật trên trang, không đoán theo tên trong mã nguồn.
  const tabsRes = await send('Runtime.evaluate', {
    expression: `JSON.stringify([...document.querySelectorAll('.admin-nav-item')].map((b,i)=>({i, label:b.textContent.trim()})))`,
    returnByValue: true,
  });
  const tabs = JSON.parse(tabsRes.result.value || '[]');
  console.log(`\n[${vpName}] tìm thấy ${tabs.length} tab:`, tabs.map((t) => t.label).join(' | '));

  for (const tab of tabs) {
    errs = [];
    await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('.admin-nav-item')[${tab.i}].click()`,
    });
    await sleep(2200);

    const st = await send('Runtime.evaluate', {
      expression: `(() => {
        const d = document.documentElement;
        const app = document.getElementById('app');
        return JSON.stringify({
          over: d.scrollWidth - d.clientWidth,
          len: app ? app.innerHTML.length : 0,
          hasDenied: /Không có quyền truy cập/.test(app ? app.textContent : ''),
          activeLabel: (document.querySelector('.admin-nav-item.active') || {}).textContent?.trim() || ''
        });
      })()`,
      returnByValue: true,
    });
    const s = JSON.parse(st.result.value);

    const safe = tab.label.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
    const file = `${OUT}/${vpName}-${String(tab.i).padStart(2, '0')}-${safe}.png`;
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    results.push({ viewport: vpName, tab: tab.label, file, ...s, errors: [...errs] });
    const flag = s.over > 1 || errs.length || s.hasDenied ? '✗' : '✓';
    console.log(`  ${flag} ${tab.label}  active="${s.activeLabel}"  over=${s.over}px  len=${s.len}`);
    if (errs.length) console.log(`      ERR: ${errs[0].slice(0, 180)}`);
  }
}

console.log('\n================ TỔNG HỢP ================');
const bad = results.filter((r) => r.over > 1 || r.errors.length || r.hasDenied || r.len < 500);
if (!bad.length) console.log(`✓ Toàn bộ ${results.length} tổ hợp tab × viewport render sạch.`);
else {
  console.log(`✗ ${bad.length}/${results.length} tổ hợp có vấn đề:`);
  bad.forEach((r) => console.log(`   ${r.viewport} / ${r.tab}: over=${r.over} len=${r.len} denied=${r.hasDenied} err=${r.errors[0]?.slice(0, 140) || '-'}`));
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
ws.close();
