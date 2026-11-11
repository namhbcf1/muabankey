/**
 * Kiểm chứng giao diện trên production: render sạch, không lỗi, không tràn.
 *
 * Cách dùng: node scripts/verify-ui.mjs [baseUrl] [outDir]
 * Cần Chrome đang mở cổng CDP 9222.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'https://xienhl.com';
const OUT = process.argv[3] || 'shots/verify';
mkdirSync(OUT, { recursive: true });

let ws; let msgId = 0;
const pending = new Map();
let pageErrors = [];
let consoleErrors = [];
let failedReqs = [];
/** requestId → URL, để biết request nào thất bại thay vì chỉ có errorText rỗng. */
const reqUrls = new Map();

const list = await (await fetch(CDP + '/json/list')).json();
const target = list.find((x) => x.type === 'page');
if (!target) { console.error('Không có tab page trên CDP'); process.exit(1); }

ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 160));
  }
  if (m.method === 'Network.requestWillBeSent') {
    reqUrls.set(m.params.requestId, m.params.request.url);
  }
  if (m.method === 'Network.loadingFailed') {
    const url = reqUrls.get(m.params.requestId) || '(unknown)';
    failedReqs.push(`${m.params.errorText || 'aborted'} :: ${url}`.slice(0, 200));
  }
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
await send('Network.setCacheDisabled', { cacheDisabled: true });

const PAGES = [
  ['home', '/#/'], ['products', '/#/products'],
  ['product-detail', '/#/product/windows-11-pro'],
  ['login', '/#/login'], ['register', '/#/register'],
  ['support', '/#/support'], ['not-found', '/#/khong-co'],
];
const VIEWPORTS = [['desktop', 1440, 900], ['mobile', 390, 844]];

const report = [];
for (const [vp, w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: vp === 'mobile',
  });
  for (const [name, path] of PAGES) {
    pageErrors = []; consoleErrors = []; failedReqs = []; reqUrls.clear();
    await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#${path.slice(1)}` });
    await sleep(2600);

    const st = JSON.parse((await send('Runtime.evaluate', {
      expression: `(() => {
        const d = document.documentElement;
        const imgs = [...document.images];
        return JSON.stringify({
          hash: location.hash,
          over: d.scrollWidth - d.clientWidth,
          brokenImgs: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
          imgs: imgs.length,
          len: (document.getElementById('app') || {}).innerHTML.length,
          emojiText: /[\\u{1F300}-\\u{1FAFF}\\u{2B50}\\u{FE0F}]/u.test((document.body.innerText || '').slice(0, 4000))
        });
      })()`,
      returnByValue: true,
    })).result.value);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}/${vp}-${name}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    /*
     * Bỏ qua request hỏng do bên thứ ba: beacon Cloudflare Insights bị CSP chặn
     * là chủ ý bảo mật (script-src 'self'), không phải lỗi ứng dụng.
     */
    const badConsole = consoleErrors.filter((t) => !/favicon|cloudflareinsights|fonts\./i.test(t));
    const badFailed = failedReqs.filter((t) => !/cloudflareinsights|favicon|fonts\.googleapis/i.test(t));

    report.push({ vp, name, file, ...st, pageErrors: [...pageErrors], consoleErrors: badConsole, failedReqs: badFailed });
    process.stdout.write(`  ${vp}/${name}  over=${st.over}px  broken=${st.brokenImgs}/${st.imgs}  emoji=${st.emojiText}\n`);
  }
}

console.log('\n================ TỔNG HỢP ================');
let bad = 0;
for (const r of report) {
  const issues = [];
  if (r.over > 1) issues.push(`OVERFLOW ${r.over}px`);
  if (r.brokenImgs > 0) issues.push(`BROKEN IMG ${r.brokenImgs}`);
  if (r.pageErrors.length) issues.push(`JS: ${r.pageErrors[0]}`);
  if (r.consoleErrors.length) issues.push(`CONSOLE: ${r.consoleErrors[0]}`);
  if (r.failedReqs.length) issues.push(`NET: ${r.failedReqs[0]}`);
  if (r.emojiText) issues.push('EMOJI trong text render');
  if (r.len < 500) issues.push(`TRANG RỖNG (${r.len} bytes)`);
  if (issues.length) { bad++; console.log(`✗ ${r.vp}/${r.name}\n    ${issues.join('\n    ')}`); }
}
console.log(bad === 0 ? `✓ ${report.length}/${report.length} tổ hợp render sạch.` : `\n✗ ${bad}/${report.length} có vấn đề.`);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
ws.close();
process.exit(bad === 0 ? 0 : 1);
