/**
 * Chụp các trang cần đăng nhập, dùng cookie phiên thật.
 *
 * Vì sao cần script riêng: `shoot-local.mjs` chạy ẩn danh nên mọi route có
 * auth đều bị đá về /login — ảnh sinh ra không kiểm chứng được giao diện
 * thật của orders / wallet / licenses / account / admin.
 *
 * Cách dùng: node scripts/shoot-auth.mjs <baseUrl> <cookie> [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';
const OUT = process.argv[4] || 'shots/auth';

if (!COOKIE) {
  console.error('Thiếu cookie phiên. Dùng: node scripts/shoot-auth.mjs <base> "mbk_session=..." ');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

let ws;
let msgId = 0;
const pending = new Map();
const pageErrors = [];
const consoleErrors = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '));
    }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
}

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['orders', '/#/orders'],
  ['wallet', '/#/wallet'],
  ['licenses', '/#/licenses'],
  ['account', '/#/account'],
  ['checkout', '/#/checkout'],
  ['admin', '/#/admin'],
];

const VIEWPORTS = [['desktop', 1440, 900], ['mobile', 390, 844]];

await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// Nạp cookie một lần trên origin đích — cookie phải thuộc đúng origin mới có hiệu lực.
await send('Page.navigate', { url: BASE + '/#/' });
await sleep(900);
const eq = COOKIE.indexOf('=');
/*
 * Cookie phiên production mang cờ `Secure`. Đặt bằng `domain` trong khi trang
 * chạy HTTP khiến Chrome lưu cookie nhưng KHÔNG gửi kèm request, nên mọi route
 * bị đá về /login và ảnh chụp vô nghĩa. Dùng `url` để gắn đúng origin.
 */
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq),
  value: COOKIE.slice(eq + 1),
  url: BASE + '/',
  path: '/',
});

const report = [];
for (const [vpName, w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: vpName === 'mobile',
  });
  for (const [name, path] of PAGES) {
    pageErrors.length = 0;
    consoleErrors.length = 0;
    /*
     * Nạp lại tài liệu thật cho mỗi route. Không dùng Page.reload sau khi
     * navigate: reload giữ URL hiện tại nhưng router đọc hash cũ trong lúc
     * hashchange chen ngang, khiến ảnh chụp lệch route. Đặt URL kèm một
     * query phân biệt để buộc nạp mới hoàn toàn.
     */
    const sep = path.includes('?') ? '&' : '?';
    await send('Page.navigate', { url: BASE + path + sep + '_r=' + Date.now() });
    await sleep(2100);

    const state = await send('Runtime.evaluate', {
      expression: `(() => {
        const d = document.documentElement;
        return JSON.stringify({
          hash: location.hash,
          over: d.scrollWidth - d.clientWidth,
          heading: (document.querySelector('h1') || {}).textContent || '',
          text: (document.getElementById('app') || {}).textContent.slice(0, 120) || ''
        });
      })()`,
      returnByValue: true,
    });
    const st = JSON.parse(state.result.value);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}/${vpName}-${name}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    report.push({
      viewport: vpName, page: name, file, ...st,
      pageErrors: [...pageErrors],
      consoleErrors: consoleErrors.filter((t) => !/favicon|fonts\./i.test(t)),
    });
    process.stdout.write(`  ${vpName}/${name}  hash=${st.hash}  over=${st.over}px\n`);
  }
}

console.log('\n================ REPORT ================');
let bad = 0;
for (const r of report) {
  const issues = [];
  // Bị đá về login nghĩa là cookie không dùng được -> ảnh vô nghĩa, phải báo.
  if (/login/.test(r.hash)) issues.push('REDIRECTED TO LOGIN (cookie không hiệu lực)');
  if (r.over > 1) issues.push(`OVERFLOW ${r.over}px`);
  if (r.pageErrors.length) issues.push(`JS: ${r.pageErrors.join(' | ')}`);
  if (r.consoleErrors.length) issues.push(`CONSOLE: ${r.consoleErrors.join(' | ')}`);
  if (issues.length) { bad++; console.log(`✗ ${r.viewport}/${r.page}\n    ${issues.join('\n    ')}`); }
}
if (!bad) console.log('✓ Tất cả trang sau đăng nhập render sạch.');

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
ws.close();
