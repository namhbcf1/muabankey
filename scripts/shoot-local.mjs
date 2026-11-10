/**
 * Chụp ảnh giao diện local qua Chrome DevTools Protocol.
 *
 * Mục đích: kiểm chứng trực quan bản đại tu giao diện — không chỉ xem ảnh mà
 * còn bắt lỗi console/network thật sự xảy ra khi render.
 *
 * Cách dùng: khởi động Chrome với --remote-debugging-port=9222, rồi
 *   node scripts/shoot-local.mjs [baseUrl] [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const OUT = process.argv[3] || 'shots/ui';

mkdirSync(OUT, { recursive: true });

let ws;
let msgId = 0;
const pending = new Map();
const consoleMsgs = [];
const pageErrors = [];
const failedRequests = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  if (!t) throw new Error('Không tìm thấy tab page nào trên CDP');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleMsgs.push({ level: m.params.type, text });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text);
    }
    if (m.method === 'Network.loadingFailed') {
      failedRequests.push(m.params.errorText);
    }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      const err = m.error;
      if (err) p.reject(new Error(JSON.stringify(err)));
      else p.resolve(m.result);
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
  ['home', '/#/', 1700],
  ['products', '/#/products', 1400],
  ['product-detail', '/#/product/netflix-premium', 1400],
  ['login', '/#/login', 1000],
  ['register', '/#/register', 1000],
  ['support', '/#/support', 1200],
  ['checkout', '/#/checkout', 1200],
  ['orders', '/#/orders', 1200],
  ['wallet', '/#/wallet', 1200],
  ['licenses', '/#/licenses', 1200],
  ['account', '/#/account', 1200],
  ['admin', '/#/admin', 1400],
  ['not-found', '/#/khong-ton-tai', 900],
];

const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
];

await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

const report = [];

for (const [vpName, w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: vpName === 'mobile',
  });

  for (const [name, path, wait] of PAGES) {
    consoleMsgs.length = 0;
    pageErrors.length = 0;
    failedRequests.length = 0;

    await send('Page.navigate', { url: BASE + path });
    await sleep(wait);
    /*
     * Điều hướng chỉ đổi hash không nạp lại tài liệu, nên ảnh có thể chụp lại
     * nội dung của trang TRƯỚC. Ép nạp lại thật rồi chờ router chạy xong để
     * mỗi ảnh đúng là trạng thái của route đang kiểm tra.
     */
    await send('Page.reload', { ignoreCache: false });
    await sleep(wait);

    // Đo tràn ngang — lỗi responsive phổ biến nhất và không thấy được bằng mắt trên ảnh chụp.
    let overflowPx = 0;
    let overflowEls = [];
    try {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const d = document.documentElement;
          const over = d.scrollWidth - d.clientWidth;
          const bad = [];
          if (over > 1) {
            for (const el of document.querySelectorAll('body *')) {
              const b = el.getBoundingClientRect();
              if (b.width > 0 && (b.right > d.clientWidth + 1 || b.left < -1)) {
                bad.push((el.tagName || '') + '.' + (el.className || '').toString().split(' ')[0]
                  + ' [' + Math.round(b.left) + ',' + Math.round(b.right) + ']');
              }
            }
          }
          return JSON.stringify({ over, bad: bad.slice(0, 6) });
        })()`,
        returnByValue: true,
      });
      const parsed = JSON.parse(r.result.value);
      overflowPx = parsed.over;
      overflowEls = parsed.bad;
    } catch { /* bỏ qua */ }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = `${OUT}/${vpName}-${name}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    const badConsole = consoleMsgs.filter(
      (m) => m.level === 'error' && !/favicon|fonts\.g|fonts\.googleapis/i.test(m.text),
    );

    report.push({
      viewport: vpName, page: name, file,
      overflowPx, overflowEls,
      consoleErrors: badConsole.map((m) => m.text),
      pageErrors,
      failedRequests: failedRequests.filter((t) => !/favicon/i.test(t)),
    });

    process.stdout.write(`  ${vpName}/${name}\n`);
  }
}

console.log('\n================ REPORT ================');
let problems = 0;
for (const r of report) {
  const issues = [];
  if (r.overflowPx > 1) issues.push(`OVERFLOW ${r.overflowPx}px ${JSON.stringify(r.overflowEls)}`);
  if (r.pageErrors.length) issues.push(`JS: ${r.pageErrors.join(' | ')}`);
  if (r.consoleErrors.length) issues.push(`CONSOLE: ${r.consoleErrors.join(' | ')}`);
  if (r.failedRequests.length) issues.push(`NET: ${r.failedRequests.join(' | ')}`);
  if (issues.length) {
    problems++;
    console.log(`✗ ${r.viewport}/${r.page}`);
    issues.forEach((i) => console.log(`    ${i}`));
  }
}
if (problems === 0) console.log('✓ Không phát hiện lỗi render nào.');
else console.log(`\n${problems}/${report.length} trang có vấn đề.`);

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
ws.close();
