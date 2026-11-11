/**
 * Kiểm chứng luồng mua hàng end-to-end trên production bằng browser thật.
 *
 * Vì sao cần: các e2e hiện có gọi API trực tiếp nên không phát hiện lỗi ở
 * tầng giao diện — nút bấm không gắn handler, modal không mở, giá hiển thị
 * sai. Script này bấm như người dùng thật để chắc khách mua được.
 *
 * Cách dùng: node scripts/verify-purchase-flow.mjs <baseUrl> <username> <password>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'https://xienhl.com';
const USER = process.argv[3];
const PASS = process.argv[4];
const OUT = 'shots/purchase';
mkdirSync(OUT, { recursive: true });

if (!USER || !PASS) {
  console.error('Thiếu tài khoản. node scripts/verify-purchase-flow.mjs <base> <user> <pass>');
  process.exit(1);
}

let ws; let msgId = 0;
const pending = new Map();
let jsErrors = [];

const list = await (await fetch(CDP + '/json/list')).json();
const target = list.find((x) => x.type === 'page');
ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    jsErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
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

async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

const steps = [];
function step(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

console.log('\n=== 1. Đăng nhập qua giao diện ===');
jsErrors = [];
await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#/login` });
await sleep(3500);

const hasForm = await evaluate("!!document.getElementById('login-form')");
step('form đăng nhập render', hasForm);

if (hasForm) {
  // Gõ như người dùng: đặt value rồi phát sự kiện input
  await evaluate(`(() => {
    const u = document.getElementById('lg-email') || document.querySelector('#login-form input[type=text], #login-form input:not([type=password])');
    const p = document.getElementById('lg-pwd');
    if (u) { u.value = ${JSON.stringify(USER)}; u.dispatchEvent(new Event('input', {bubbles:true})); }
    if (p) { p.value = ${JSON.stringify(PASS)}; p.dispatchEvent(new Event('input', {bubbles:true})); }
    return !!(u && p);
  })()`);
  await evaluate("document.querySelector('#login-form button[type=submit], #login-form button:not([type=button])').click()");
  await sleep(4000);
  const afterLogin = await evaluate("JSON.stringify({hash: location.hash, hasLogout: !!document.getElementById('btn-logout')})");
  const al = JSON.parse(afterLogin);
  step('đăng nhập thành công (có nút đăng xuất)', al.hasLogout, al.hash);
}

console.log('\n=== 2. Duyệt và thêm vào giỏ ===');
jsErrors = [];
await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#/products` });
await sleep(4000);

const cardInfo = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.product-card')];
  const inStock = cards.find(c => {
    const btn = c.querySelector('[data-add]');
    return btn && !btn.disabled;
  });
  if (!inStock) return JSON.stringify({found:false, total:cards.length});
  return JSON.stringify({
    found: true,
    total: cards.length,
    slug: inStock.dataset.slug,
    name: (inStock.querySelector('.product-name')||{}).textContent || '',
    price: (inStock.querySelector('.price-now')||{}).textContent || ''
  });
})()`);
const ci = JSON.parse(cardInfo);
step('tìm được sản phẩm còn hàng', ci.found, `${ci.total} thẻ, chọn: ${ci.name} ${ci.price}`);

if (ci.found) {
  await evaluate(`(() => {
    const c = document.querySelector('.product-card[data-slug="${ci.slug}"]');
    c.querySelector('[data-add]').click();
  })()`);
  await sleep(1500);
  const badge = await evaluate("JSON.stringify({n: (document.getElementById('cart-badge')||{}).textContent||'0', visible: (document.getElementById('cart-badge')||{}).style.display !== 'none'})");
  const b = JSON.parse(badge);
  step('badge giỏ hàng cập nhật', b.visible && Number(b.n) > 0, `badge=${b.n}`);
}

console.log('\n=== 3. Mở giỏ hàng (drawer) ===');
jsErrors = [];
await evaluate("document.getElementById('btn-cart').click()");
await sleep(1200);
const drawer = await evaluate(`JSON.stringify({
  open: !!document.getElementById('cart-drawer') && document.getElementById('cart-drawer').classList.contains('open'),
  items: document.querySelectorAll('.cart-item').length,
  hasCheckout: !!document.getElementById('goto-checkout'),
  total: (document.querySelector('.summary-row.total .val')||{}).textContent || ''
})`);
const d = JSON.parse(drawer);
step('drawer giỏ hàng mở', d.open);
step('có dòng sản phẩm', d.items > 0, `${d.items} dòng`);
step('có nút thanh toán', d.hasCheckout, `tổng=${d.total}`);

const shotDrawer = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/1-cart-drawer.png`, Buffer.from(shotDrawer.data, 'base64'));

console.log('\n=== 4. Vào trang thanh toán ===');
jsErrors = [];
if (d.hasCheckout) {
  await evaluate("document.getElementById('goto-checkout').click()");
  await sleep(4500);
  const ck = await evaluate(`JSON.stringify({
    hash: location.hash,
    hasSummary: !!document.querySelector('.ck-summary'),
    bodyLen: (document.getElementById('app')||{}).innerHTML.length,
    hasPayBtn: !!document.querySelector('#btn-place-order, #btn-pay, [data-pay]'),
    payBtnLabel: (document.querySelector('#btn-place-order') || {}).textContent?.trim() || '',
    payDisabled: !!(document.querySelector('#btn-place-order') || {}).disabled,
    insufficient: /không đủ/i.test((document.getElementById('app')||{}).textContent||'')
  })`);
  const c = JSON.parse(ck);
  step('vào được trang thanh toán', c.hash.includes('checkout') && c.bodyLen > 2000, c.hash);
  step('hiển thị tóm tắt đơn', c.hasSummary);
  step('có nút thanh toán', c.hasPayBtn, `${c.payBtnLabel}${c.payDisabled ? ' (đang disabled)' : ''}`);
  if (c.insufficient) step('cảnh báo số dư không đủ (đúng vì ví trống)', true);

  const shotCk = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/2-checkout.png`, Buffer.from(shotCk.data, 'base64'));
}

console.log('\n=== 5. Mobile: menu + giỏ hàng ===');
jsErrors = [];
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Page.navigate', { url: `${BASE}/index.html?t=${Date.now()}#/` });
await sleep(3500);

const mobileMenu = await evaluate(`(() => {
  const t = document.getElementById('nav-toggle');
  const n = document.getElementById('mobile-nav');
  if (!t || !n) return JSON.stringify({ok:false});
  t.click();
  const open = n.classList.contains('open');
  const expanded = t.getAttribute('aria-expanded');
  const links = n.querySelectorAll('a').length;
  return JSON.stringify({ok:true, open, expanded, links});
})()`);
const mm = JSON.parse(mobileMenu);
step('mobile menu mở được', mm.ok && mm.open, `aria-expanded=${mm.expanded}, ${mm.links} link`);

const shotMobile = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/3-mobile-menu.png`, Buffer.from(shotMobile.data, 'base64'));

console.log('\n================ KẾT QUẢ ================');
const pass = steps.filter((s) => s.ok).length;
const fail = steps.filter((s) => !s.ok);
console.log(`Đạt: ${pass}/${steps.length}`);
if (fail.length) {
  console.log('Không đạt:');
  fail.forEach((f) => console.log(`  • ${f.name} ${f.detail}`));
}
writeFileSync(`${OUT}/report.json`, JSON.stringify({ steps, jsErrors }, null, 2));
ws.close();
process.exit(fail.length ? 1 : 0);
