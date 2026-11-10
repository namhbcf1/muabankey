/**
 * Kiểm chứng trang quản trị sau đại tu giao diện.
 *
 * Mỗi tab admin được nạp ở hai khổ màn hình; đo tràn ngang, đếm SVG, quét emoji
 * và rà inline style tĩnh còn sót. Script tự mở một tab CDP riêng nên chạy song
 * song với script khác không tranh chấp.
 *
 * node scripts/verify-admin-ui.mjs <baseUrl> <cookie> [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';
const OUT = process.argv[4] || 'shots/admin';

if (!COOKIE) {
  console.error('Thiếu cookie phiên. Dùng: node scripts/verify-admin-ui.mjs <base> "mbk_session=..."');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

let ws;
let msgId = 0;
const pending = new Map();
let pageErrors = [];
let consoleErrors = [];

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
};

async function connect() {
  const created = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new globalThis.WebSocket(created.webSocketDebuggerUrl);
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
  return created.id;
}

/* Mọi tab trong thanh điều hướng quản trị. */
const TABS = [
  ['dashboard', 'Tổng quan'],
  ['orders', 'Đơn hàng'],
  ['products', 'Sản phẩm'],
  ['keys', 'Kho key'],
  ['licenses', 'License'],
  ['trial', 'Dùng thử'],
  ['users', 'Người dùng'],
  ['settings', 'Cài đặt'],
  ['logs', 'Nhật ký'],
  ['topups', 'Nạp tiền'],
];

const VIEWPORTS = [['desktop', 1440, 900], ['mobile', 390, 844]];

const targetId = await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// ES module được cache theo URL; không tắt cache thì trình duyệt chạy bản cũ.
await send('Network.setCacheDisabled', { cacheDisabled: true });

/*
 * Đặt cookie rồi đi qua about:blank để lần vào trang là một lượt boot sạch.
 * Chỉ đổi hash không tạo tài liệu mới -> SPA giữ state.user cũ (ẩn danh).
 */
await send('Page.navigate', { url: BASE + '/#/' });
await sleep(900);
const eq = COOKIE.indexOf('=');
/*
 * Cookie phiên có cờ `Secure`; đặt bằng `domain` khi trang chạy HTTP khiến
 * Chrome lưu nhưng không gửi kèm request. Dùng `url` để gắn đúng origin.
 */
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq),
  value: COOKIE.slice(eq + 1),
  url: BASE + '/',
  path: '/',
});
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);

// Xác nhận phiên admin có hiệu lực trước khi đo giao diện.
await send('Page.navigate', { url: `${BASE}/#/admin?tab=dashboard` });
await sleep(2000);
const who = await ev(
  `fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?(d.user.role||'?'):'none')`
);
if (who !== 'admin' && who !== 'staff') {
  console.error(`Phiên không phải admin (role=${who}). Cookie không dùng được.`);
  ws.close();
  await fetch(CDP + '/json/close/' + targetId).catch(() => {});
  process.exit(1);
}
console.log(`Phiên admin hợp lệ (role=${who}).`);

const report = [];

for (const [vpName, w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: vpName === 'mobile',
  });

  for (const [tab, label] of TABS) {
    pageErrors = [];
    consoleErrors = [];

    await send('Page.navigate', { url: `${BASE}/#/admin?tab=${tab}&_r=${Date.now()}` });
    await sleep(2300);

    const raw = await ev(`(() => {
      const d = document.documentElement;
      const content = document.getElementById('admin-content');
      const navActive = document.querySelector('.admin-nav-item.active');
      const svgCount = content ? content.querySelectorAll('svg.i').length : 0;
      const emoji = content ? (content.innerText || '').match(
        /[\\u2190-\\u21FF\\u2300-\\u27BF\\u2B00-\\u2BFF\\uFE0F]/g) : null;
      // Inline style còn lại trong nội dung, bỏ qua width động của bar-fill.
      const styles = content ? [...content.querySelectorAll('[style]')]
        .map((e) => e.getAttribute('style') || '')
        .filter((s) => s && !/^width:\\s*\\d+(\\.\\d+)?%$/.test(s.trim())) : [];
      return JSON.stringify({
        hash: location.hash,
        over: d.scrollWidth - d.clientWidth,
        heading: (document.querySelector('h1') || {}).textContent || '',
        navActive: navActive ? navActive.textContent.trim() : null,
        contentLen: content ? (content.innerText || '').trim().length : 0,
        hasStatGrid: !!document.querySelector('.stat-grid'),
        tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tbody tr').length,
        svgCount,
        emoji: emoji ? [...new Set(emoji)] : [],
        nonDynamicStyles: styles,
        redirected: /login/.test(location.hash),
      });
    })()`);

    if (raw && raw.__err) {
      report.push({ viewport: vpName, tab, label, evalError: raw.__err, pageErrors, consoleErrors });
      console.log(`  ${vpName}/${tab.padEnd(10)} EVAL ERROR`);
      continue;
    }

    const s = JSON.parse(raw);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = `${OUT}/${vpName}-${tab}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    report.push({
      viewport: vpName, tab, label, file, ...s,
      pageErrors: [...pageErrors],
      consoleErrors: consoleErrors.filter((t) => !/favicon|fonts\.|ERR_/i.test(t)),
    });
    console.log(
      `  ${vpName}/${tab.padEnd(10)} over=${String(s.over).padStart(3)}px ` +
      `rows=${String(s.rows).padStart(2)} svg=${String(s.svgCount).padStart(2)} ` +
      `inline=${s.nonDynamicStyles.length} emoji=${s.emoji.length}`
    );
  }
}

console.log('\n================ REPORT ================');
let bad = 0;
for (const r of report) {
  const issues = [];
  if (r.evalError) issues.push(`EVAL: ${r.evalError}`);
  if (r.redirected) issues.push('BỊ ĐÁ VỀ LOGIN (cookie không hiệu lực)');
  if (r.over > 1) issues.push(`TRÀN NGANG ${r.over}px`);
  if (!r.contentLen) issues.push('NỘI DUNG RỖNG');
  if (r.emoji && r.emoji.length) issues.push(`CÒN EMOJI: ${r.emoji.join(' ')}`);
  if (r.nonDynamicStyles && r.nonDynamicStyles.length) {
    issues.push(`INLINE STYLE: ${r.nonDynamicStyles.slice(0, 3).join(' || ')}`);
  }
  if (r.pageErrors.length) issues.push(`JS: ${r.pageErrors.join(' | ')}`);
  if (r.consoleErrors.length) issues.push(`CONSOLE: ${r.consoleErrors.join(' | ')}`);
  if (issues.length) {
    bad++;
    console.log(`✗ ${r.viewport}/${r.tab}\n    ${issues.join('\n    ')}`);
  }
}
if (!bad) {
  console.log(`✓ ${report.length} lượt chụp: không tràn ngang, không lỗi JS, không emoji, không inline style tĩnh.`);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
ws.close();
await fetch(CDP + '/json/close/' + targetId).catch(() => {});
process.exitCode = bad ? 1 : 0;
