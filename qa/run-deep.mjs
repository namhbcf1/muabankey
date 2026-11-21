import { launch, connect, newPage, sleep, PROD } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import { adminCredentials } from './qa-guard.mjs';

const ADMIN = (() => { const c = adminCredentials(); return { u: c.username, p: c.password }; })();

const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function hardGoto(page, hashPath) {
  await page.S('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await page.S('Page.navigate', { url: PROD + '/#' + hashPath });
  await sleep(400);
  await page.waitFor(`document.readyState==='complete'`);
  await page.waitIdle(1500, 25000);
}
async function login(page, account, password) {
  await hardGoto(page, '/login');
  await page.waitFor(`!!document.querySelector('#login-form')`);
  await page.eval(`(()=>{document.querySelector('#lg-email').value=${JSON.stringify(account)};
    document.querySelector('#lg-pwd').value=${JSON.stringify(password)};
    document.querySelector('#login-form').requestSubmit(); return true;})()`);
  await sleep(2600);
}
const STATE = `(()=>{
  const app=document.getElementById('app');
  return {
    appHTML: app? app.innerHTML.length : -1,
    boot: !!document.querySelector('.boot-screen'),
    header: !!document.getElementById('main-header'),
    bodyText: (document.body.innerText||'').slice(0,400).replace(/\\n+/g,' | '),
    sentinel: ['undefined','NaN','[object Object]'].filter(b=>(document.body.innerText||'').includes(b)),
    toasts:[...document.querySelectorAll('.toast-wrap .toast')].map(x=>x.innerText.replace(/\\n/g,' ')),
    alerts:[...document.querySelectorAll('.alert')].map(x=>x.innerText.replace(/\\n/g,' ').slice(0,160)),
    empty:[...document.querySelectorAll('.empty-state')].map(x=>x.innerText.replace(/\\n/g,' ').slice(0,120)),
    grid: document.querySelectorAll('.product-card').length,
  };})()`;

(async () => {
  const b = await launch({ port: 9337 });
  const browser = await connect(b.port);

  /* ================= 1. Lazy image check (avoid false positive) ================= */
  const p0 = await newPage(browser, { width: 375, height: 812, mobile: true });
  await p0.goto(PROD + '/#/');
  await sleep(2500);
  const imgInfo = await p0.eval(`(()=>{
    const imgs=[...document.images].map(i=>({src:(i.currentSrc||i.src).split('/').pop(), loading:i.loading, complete:i.complete, nw:i.naturalWidth}));
    const notLoaded=imgs.filter(i=>i.nw===0);
    return { total:imgs.length, notLoaded, allLazy: imgs.every(i=>i.loading!=='eager') };
  })()`);
  log({ test: 'A-home-images-lazy', ...imgInfo });
  await p0.close();

  /* ================= 2. 500 / 401 / offline — deeper ================= */
  const fp = await newPage(browser, { width: 1440, height: 900 });
  await login(fp, 'demo', 'Demo@123456');
  await fp.S('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  let mode = 'none';
  browser.on('Fetch.requestPaused', async (ev) => {
    if (ev.sessionId !== fp.sessionId) return;
    const url = ev.request.url;
    try {
      if (mode === 'e500' && url.includes('/api/products?')) {
        await fp.S('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 500,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: false, error: 'Đã có lỗi xảy ra, vui lòng thử lại sau', code: 'INTERNAL' })).toString('base64') });
        return;
      }
      if (mode === 'e401' && url.includes('/api/orders?')) {
        await fp.S('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 401,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: false, error: 'Phiên đăng nhập đã hết hạn', code: 'UNAUTHENTICATED' })).toString('base64') });
        return;
      }
      if (mode === 'offline' && url.includes('/api/')) {
        await fp.S('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'InternetDisconnected' });
        return;
      }
      if (mode === 'zerobal') {
        const u = new URL(url);
        if (u.pathname === '/api/auth/me') {
          const cur = await fp.eval(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.text())`);
          console.log('   (skip self-interception)');
        }
      }
      await fp.S('Fetch.continueRequest', { requestId: ev.requestId });
    } catch { /* ignore */ }
  });

  mode = 'e500'; fp.clearLogs();
  await hardGoto(fp, '/products'); await sleep(1500);
  log({ test: 'B18-500-products', ...(await fp.eval(STATE)), jsErr: fp.errors.map(e => e.desc || e.text) });

  mode = 'e401'; fp.clearLogs();
  await hardGoto(fp, '/orders'); await sleep(1500);
  log({ test: 'B19-401-orders', ...(await fp.eval(STATE)), hash: await fp.eval('location.hash') });

  mode = 'offline'; fp.clearLogs();
  await hardGoto(fp, '/products'); await sleep(2000);
  log({ test: 'B20-offline', ...(await fp.eval(STATE)) });

  mode = 'none';
  await fp.S('Fetch.disable');
  await fp.close();

  /* ================= 3. Zero balance checkout (simulated, no DB writes) ================= */
  const zp = await newPage(browser, { width: 1440, height: 900 });
  await login(zp, 'demo', 'Demo@123456');
  // override /api/auth/me and /api/wallet to report balance 0
  await zp.S('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  browser.on('Fetch.requestPaused', async (ev) => {
    if (ev.sessionId !== zp.sessionId) return;
    const url = ev.request.url;
    try {
      if (url.includes('/api/auth/me')) {
        await zp.S('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: true, user: { id: 'u-demo', email: 'demo@muabankey.vn', fullName: 'Khách Demo', role: 'user', balance: 0 }, stats: { orders: 2, spent: 520000 } })).toString('base64') });
        return;
      }
      if (url.match(/\/api\/wallet$/)) {
        await zp.S('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: true, balance: 0, summary: { income: 0, expense: 0 }, transactions: [], page: 1, perPage: 30 })).toString('base64') });
        return;
      }
      await zp.S('Fetch.continueRequest', { requestId: ev.requestId });
    } catch { /* ignore */ }
  });
  await zp.eval(`localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-win11',slug:'windows-11-pro',name:'Windows 11 Pro Retail',price:450000,imageUrl:'/img/windows-11-pro.svg',quantity:1,stock:4,deliveryType:'key'}])); true`);
  await hardGoto(zp, '/checkout');
  await zp.waitFor(`!!document.querySelector('#btn-place-order')`, 20000);
  const zs = await zp.eval(`(()=>({
    bal: document.querySelector('#wallet-balance')?.textContent,
    total: document.querySelector('#sum-total')?.textContent,
    warn: {d: getComputedStyle(document.querySelector('#balance-warning')).display, t: document.querySelector('#balance-warning').textContent},
    topup: getComputedStyle(document.querySelector('#btn-topup')).display,
    btnLabel: document.querySelector('#btn-place-order')?.textContent.trim(),
    btnDisabled: document.querySelector('#btn-place-order')?.disabled,
  }))()`);
  log({ test: 'B15-zero-balance-screen', ...zs });
  zp.clearLogs();
  await zp.eval(`document.querySelector('#btn-place-order').click(); true`);
  await sleep(5000);
  const zs2 = await zp.eval(`(()=>({
    hash: location.hash,
    toasts: [...document.querySelectorAll('.toast-wrap .toast')].map(x=>x.innerText.replace(/\\n/g,' ')),
    body: (document.body.innerText||'').slice(0,320).replace(/\\n+/g,' | '),
    btnLabel: document.querySelector('#btn-place-order')?.textContent?.trim() ?? null,
    btnDisabled: document.querySelector('#btn-place-order')?.disabled ?? null,
    ordersCreated: null,
  }))()`);
  log({ test: 'B15-zero-balance-submit', ...zs2, jsErr: zp.errors.map(e => e.desc || e.text) });
  await zp.S('Fetch.disable');
  await zp.close();

  /* ================= 4. buynow flow ================= */
  const bp = await newPage(browser, { width: 1440, height: 900 });
  await login(bp, 'demo', 'Demo@123456');
  // guest buynow -> login redirect path
  await bp.eval(`localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-lic-month',slug:'license-xarena-thang',name:'old',price:1,quantity:3,deliveryType:'license'}])); true`);
  await hardGoto(bp, '/product/license-xarena-thang');
  await bp.waitFor(`!!document.querySelector('#btn-buy-now')`, 20000);
  await bp.eval(`document.querySelector('#btn-buy-now').click(); true`);
  await sleep(2500);
  const bn = await bp.eval(`(()=>({ hash: location.hash,
    cartLS: JSON.parse(localStorage.getItem('mbk_cart')||'[]').map(x=>x.productId+':'+x.quantity),
    buynow: JSON.parse(localStorage.getItem('mbk_buynow')||'null'),
    body: (document.body.innerText||'').slice(0,300).replace(/\\n+/g,' | ') }))()`);
  log({ test: 'B-buynow-flow', ...bn });

  /* ================= 5. admin keys tab without product & with product ================= */
  await bp.close();
  const ap = await newPage(browser, { width: 1600, height: 950 });
  await login(ap, ADMIN.u, ADMIN.p);
  await hardGoto(ap, '/admin?tab=keys'); await sleep(1200);
  log({ test: 'A-admin-keys-empty', ...(await ap.eval(STATE)) });
  await hardGoto(ap, '/admin?tab=keys&product=p-win11'); await sleep(1800);
  const keys = await ap.eval(`(()=>({ body:(document.querySelector('#admin-content')?.innerText||'').slice(0,400).replace(/\\n+/g,' | '), rows: document.querySelectorAll('#admin-content tbody tr').length }))()`);
  log({ test: 'A-admin-keys-product', ...keys });

  /* ================= 6. admin orders: processing status filter/action ================= */
  await hardGoto(ap, '/admin?tab=orders'); await sleep(1500);
  const of = await ap.eval(`(()=>({
    options: [...document.querySelectorAll('#order-status-filter option')].map(o=>o.value),
    rowsWithProcessing: [...document.querySelectorAll('#admin-content tbody tr')].filter(r=>r.innerText.includes('processing')).map(r=>({txt:r.innerText.replace(/\\n/g,' | '), btns:[...r.querySelectorAll('button')].map(b=>b.innerText)})),
  }))()`);
  log({ test: 'A-admin-orders-processing', ...of });

  await ap.close();
  await browser.ws.close();
  await b.close();
  writeFileSync('qa/results-deep.json', JSON.stringify(out, null, 2));
  console.log('done');
})();
