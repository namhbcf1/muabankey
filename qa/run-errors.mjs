import { launch, connect, newPage, sleep, PROD } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function hardGoto(page, hashPath) {
  await page.S('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await page.S('Page.navigate', { url: PROD + '/#' + hashPath });
  await sleep(400);
  await page.waitFor(`document.readyState==='complete'`);
  await page.waitIdle(1200, 20000);
}

async function login(page, account, password) {
  await hardGoto(page, '/login');
  await page.waitFor(`!!document.querySelector('#login-form')`);
  await page.eval(`(()=>{
    document.querySelector('#lg-email').value=${JSON.stringify(account)};
    document.querySelector('#lg-pwd').value=${JSON.stringify(password)};
    document.querySelector('#login-form').requestSubmit(); return true;})()`);
  await sleep(2600);
  return page.eval(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json())`);
}

const TXT = `(()=>{const t=document.body.innerText||'';const de=document.documentElement;return{
 text:t.slice(0,2500), sentinel:['undefined','NaN','[object Object]','Infinity'].filter(b=>t.includes(b)),
 overflowX:de.scrollWidth-de.clientWidth, hash:location.hash,
 toasts:[...document.querySelectorAll('.toast-wrap .toast')].map(x=>x.innerText.replace(/\\n/g,' ')),
 alerts:[...document.querySelectorAll('.alert')].map(x=>x.innerText.replace(/\\n/g,' ').slice(0,150)),
 modals:document.querySelectorAll('.modal-overlay').length,
 emptyStates:[...document.querySelectorAll('.empty-state')].map(x=>x.innerText.replace(/\\n/g,' ').slice(0,120)),
 btnDisabled: document.querySelector('#btn-place-order')?.disabled ?? null,
 btnText: document.querySelector('#btn-place-order')?.textContent?.trim() ?? null,
 balance: document.querySelector('#wallet-balance')?.textContent ?? null,
 total: document.querySelector('#sum-total')?.textContent ?? null,
 warn: document.querySelector('#balance-warning')? {disp:getComputedStyle(document.querySelector('#balance-warning')).display, txt:document.querySelector('#balance-warning').textContent} : null,
 topupBtn: document.querySelector('#btn-topup')? getComputedStyle(document.querySelector('#btn-topup')).display : null,
};})()`;

(async () => {
  const b = await launch({ port: 9335 });
  const browser = await connect(b.port);
  const p = await newPage(browser, { width: 1440, height: 900 });
  p.clearLogs();
  await login(p, 'demo', 'Demo@123456');

  /* ===== B15+22: checkout happy path with forced reload ===== */
  await p.eval(`localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-win11',slug:'windows-11-pro',name:'Windows 11 Pro Retail',price:450000,imageUrl:'/img/windows-11-pro.svg',quantity:1,stock:4,deliveryType:'key'}])); true`);
  await hardGoto(p, '/checkout');
  await p.waitFor(`!!document.querySelector('#btn-place-order')`, 20000);
  const cs = await p.eval(TXT);
  log({ test: 'B-checkout-render', balance: cs.balance, total: cs.total, warn: cs.warn, topupBtn: cs.topupBtn, sentinel: cs.sentinel });

  // F5 mid-checkout
  const before = await p.eval(`fetch('/api/orders?perPage=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.orders.length)`);
  await p.eval(`location.reload()`);
  await sleep(3500);
  const afterReload = await p.eval(TXT);
  log({ test: 'B22-F5-mid-checkout', hash: afterReload.hash, carts: await p.eval(`JSON.parse(localStorage.getItem('mbk_cart')||'[]').length`), hasBtn: await p.eval(`!!document.querySelector('#btn-place-order')`), sentinel: afterReload.sentinel });

  // place order, single click
  await p.eval(`document.querySelector('#btn-place-order').click(); true`);
  await sleep(5000);
  const done = await p.eval(TXT);
  const after = await p.eval(`fetch('/api/orders?perPage=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.orders.length)`);
  log({ test: 'B-checkout-place-order', orderDelta: after - before, hash: done.hash, sentinel: done.sentinel, hasSuccess: done.text.includes('Thanh toán thành công'), firstLine: done.text.slice(0, 200).replace(/\n/g, ' | '), toasts: done.toasts, cartAfter: await p.eval(`JSON.parse(localStorage.getItem('mbk_cart')||'[]').length`) });

  /* ===== B15: insufficient balance ===== */
  await p.eval(`localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-win11',slug:'windows-11-pro',name:'Windows 11 Pro Retail',price:450000,imageUrl:'/img/windows-11-pro.svg',quantity:19,stock:4,deliveryType:'key'}])); true`);
  await hardGoto(p, '/checkout');
  await p.waitFor(`!!document.querySelector('#btn-place-order')`, 20000);
  const ib = await p.eval(TXT);
  log({ test: 'B15-insufficient-warning', balance: ib.balance, total: ib.total, warn: ib.warn, topupBtn: ib.topupBtn });

  // click place order with insufficient -> where does it go?
  p.clearLogs();
  await p.eval(`document.querySelector('#btn-place-order').click(); true`);
  await sleep(4500);
  const ib2 = await p.eval(TXT);
  log({ test: 'B15-insufficient-submit', hash: ib2.hash, toasts: ib2.toasts, text: ib2.text.slice(0, 260).replace(/\n/g, ' | '), jsErr: p.errors.map(e => e.desc || e.text) });

  /* ===== B16: empty cart checkout ===== */
  await p.eval(`localStorage.removeItem('mbk_cart'); localStorage.removeItem('mbk_buynow'); true`);
  await hardGoto(p, '/checkout');
  await sleep(1500);
  const ec = await p.eval(TXT);
  log({ test: 'B16-empty-cart', emptyStates: ec.emptyStates, hash: ec.hash, text: ec.text.slice(0, 200).replace(/\n/g, ' | ') });

  /* ===== D33: modal / toast / confirm ===== */
  await hardGoto(p, '/products');
  await sleep(1000);
  const toastTest = await p.eval(`(async()=>{
    const m = await import('/assets/lib.js');
    for (let i=0;i<8;i++) m.toast('Lỗi thử #'+i, 'error');
    await new Promise(r=>setTimeout(r,60));
    const wrap = document.querySelector('.toast-wrap');
    return { count: wrap? wrap.children.length : -1, heights: wrap? [...wrap.children].map(c=>Math.round(c.getBoundingClientRect().height)) : [] };
  })()`);
  log({ test: 'E34-toast-stacking', ...toastTest });

  const modalTest = await p.eval(`(async()=>{
    const m = await import('/assets/lib.js');
    for (let i=0;i<10;i++) m.openModal('<div class="modal-title">T'+i+'</div>');
    await new Promise(r=>setTimeout(r,200));
    const n = document.querySelectorAll('.modal-overlay').length;
    // close with ESC, one at a time
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    await new Promise(r=>setTimeout(r,450));
    const n2 = document.querySelectorAll('.modal-overlay').length;
    return { opened: n, afterOneEsc: n2 };
  })()`);
  log({ test: 'E35/E36-modal-leak', ...modalTest });

  const confirmTest = await p.eval(`(async()=>{
    const m = await import('/assets/lib.js');
    // click outside (overlay)
    const pr = m.confirmDialog('Test?','msg','OK');
    await new Promise(r=>setTimeout(r,150));
    const ov = document.querySelector('.modal-overlay');
    ov.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const outside = await Promise.race([pr, new Promise(r=>setTimeout(()=>r('PENDING'),600))]);
    await new Promise(r=>setTimeout(r,400));
    // ESC
    const pr2 = m.confirmDialog('Test2?','msg2','OK');
    await new Promise(r=>setTimeout(r,150));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    const esc = await Promise.race([pr2, new Promise(r=>setTimeout(()=>r('PENDING'),600))]);
    await new Promise(r=>setTimeout(r,400));
    // yes
    const pr3 = m.confirmDialog('Test3?','m','OK');
    await new Promise(r=>setTimeout(r,150));
    document.querySelector('.modal-overlay [data-yes]').click();
    const yes = await pr3;
    return { outsideClick: outside, escPress: esc, yesBtn: yes, leftover: document.querySelectorAll('.modal-overlay').length };
  })()`);
  log({ test: 'E37-confirm-dialog', ...confirmTest });

  await p.close();

  /* ===== B18/19/20: API failure simulation ===== */
  const fp = await newPage(browser, { width: 1440, height: 900 });
  await login(fp, 'demo', 'Demo@123456');
  await fp.S('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  let mode = 'none';
  browser.on('Fetch.requestPaused', async (ev) => {
    if (ev.sessionId !== fp.sessionId) return;
    const url = ev.request.url;
    try {
      if (mode === 'e500' && (url.includes('/api/products?'))) {
        await fp.S('Fetch.fulfillRequest', {
          requestId: ev.requestId, responseCode: 500,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: false, error: 'Đã có lỗi xảy ra, vui lòng thử lại sau', code: 'INTERNAL' })).toString('base64'),
        });
        return;
      }
      if (mode === 'e401' && url.includes('/api/orders')) {
        await fp.S('Fetch.fulfillRequest', {
          requestId: ev.requestId, responseCode: 401,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: false, error: 'Phiên đăng nhập đã hết hạn', code: 'UNAUTHENTICATED' })).toString('base64'),
        });
        return;
      }
      if (mode === 'offline') {
        await fp.S('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'InternetDisconnected' });
        return;
      }
      await fp.S('Fetch.continueRequest', { requestId: ev.requestId });
    } catch { /* ignore */ }
  });

  // 500 on product list
  mode = 'e500';
  fp.clearLogs();
  await hardGoto(fp, '/products');
  await sleep(2000);
  const r500 = await fp.eval(TXT);
  log({ test: 'B18-api-500-products', hash: r500.hash, text: r500.text.slice(0, 300).replace(/\n/g, ' | '), toasts: r500.toasts, jsErr: fp.errors.length });

  // 401 on orders page
  mode = 'e401';
  fp.clearLogs();
  await hardGoto(fp, '/orders');
  await sleep(2000);
  const r401 = await fp.eval(TXT);
  log({ test: 'B19-api-401-orders', hash: r401.hash, text: r401.text.slice(0, 300).replace(/\n/g, ' | '), toasts: r401.toasts, jsErr: fp.errors.map(e => e.desc || e.text) });

  // offline
  mode = 'offline';
  fp.clearLogs();
  await hardGoto(fp, '/products');
  await sleep(2500);
  const roff = await fp.eval(TXT);
  log({ test: 'B20-offline-products', hash: roff.hash, text: roff.text.slice(0, 300).replace(/\n/g, ' | '), toasts: roff.toasts });

  mode = 'none';
  await fp.S('Fetch.disable');
  await fp.close();

  await browser.ws.close();
  await b.close();
  writeFileSync('qa/results-errors.json', JSON.stringify(out, null, 2));
  console.log('done');
})();
