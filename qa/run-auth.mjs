import { launch, connect, newPage, sleep, PROD } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import { adminCredentials } from './qa-guard.mjs';

const ADMIN = (() => { const c = adminCredentials(); return { u: c.username, p: c.password }; })();

const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function login(page, account, password) {
  await page.goto(PROD + '/#/login');
  await page.waitFor(`!!document.querySelector('#login-form')`);
  await page.eval(`(()=>{
    const a=document.querySelector('#lg-email'); const p=document.querySelector('#lg-pwd');
    a.value=${JSON.stringify(account)}; p.value=${JSON.stringify(password)};
    a.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#login-form').requestSubmit();
    return true;
  })()`);
  await sleep(2500);
  const me = await page.eval(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).catch(e=>({err:String(e)}))`);
  return me;
}

const AUDIT = `(() => {
  const t = document.body.innerText || '';
  const bads = ['undefined','NaN','[object Object]','Infinity'];
  const de = document.documentElement;
  return {
    text: t.slice(0, 4000),
    sentinel: bads.filter(b => t.includes(b)),
    overflowX: de.scrollWidth - de.clientWidth,
    toasts: [...document.querySelectorAll('.toast-wrap .toast')].map(x=>x.innerText.trim()).slice(0,5),
    modals: document.querySelectorAll('.modal-overlay').length,
    hash: location.hash,
  };
})()`;

(async () => {
  const b = await launch({ port: 9334 });
  const browser = await connect(b.port);

  /* ============ A. DEMO USER FLOWS ============ */
  const p = await newPage(browser, { width: 1440, height: 900 });
  p.clearLogs();

  // --- login as demo ---
  const me = await login(p, 'demo', 'Demo@123456');
  log({ test: 'login-demo', me: me.user ? { role: me.user.role, balance: me.user.balance } : me, hash: await p.eval('location.hash') });

  // --- B15: zero balance purchase ---
  // read current balance
  const balBefore = (await p.eval(`fetch('/api/wallet',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.balance)`));
  log({ test: 'balance-before', bal: balBefore });

  // Add product to cart via product detail page
  await p.goto(PROD + '/#/product/windows-11-pro');
  await p.waitFor(`!!document.querySelector('#btn-add-cart')`);
  await p.eval(`document.querySelector('#btn-add-cart').click(); true`);
  await sleep(1200);
  const cart = await p.eval(`JSON.parse(localStorage.getItem('mbk_cart')||'[]')`);
  log({ test: 'add-to-cart', cart: cart.map(c => ({ id: c.productId, name: c.name, qty: c.quantity, price: c.price })), toast: (await p.eval(AUDIT)).toasts });

  // --- B21: double-click place order ---
  await p.goto(PROD + '/#/checkout');
  await p.waitFor(`!!document.querySelector('#btn-place-order')`, 20000);
  const before = (await p.eval(`fetch('/api/orders?perPage=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.orders.length)`));
  // double click fast
  await p.eval(`(()=>{const b=document.querySelector('#btn-place-order'); b.click(); b.click(); return b.disabled;})()`);
  await sleep(5000);
  const after = (await p.eval(`fetch('/api/orders?perPage=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.orders.length)`));
  const chk = await p.eval(AUDIT);
  log({ test: 'double-click-order', ordersBefore: before, ordersAfter: after, delta: after - before, hash: chk.hash, sentinel: chk.sentinel, textSnip: chk.text.slice(0, 300), toasts: chk.toasts });

  // --- B15b: insufficient balance behavior ---
  // now set cart price above balance by adding many items of expensive product
  await p.eval(`localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-win11',slug:'windows-11-pro',name:'Windows 11 Pro Retail',price:450000,imageUrl:'/img/windows-11-pro.svg',quantity:1,stock:4,deliveryType:'key'}])); true`);
  await p.goto(PROD + '/#/checkout');
  await p.waitFor(`!!document.querySelector('#btn-place-order')`, 20000);
  const warn = await p.eval(`(()=>{
    const w=document.querySelector('#balance-warning');
    return { warnVisible: w? getComputedStyle(w).display : null, warnText: w? w.textContent : null,
      topupVisible: (()=>{const t=document.querySelector('#btn-topup'); return t? getComputedStyle(t).display:'?'})(),
      total: document.querySelector('#sum-total')?.textContent,
      balance: document.querySelector('#wallet-balance')?.textContent };
  })()`);
  log({ test: 'checkout-footer-state', ...warn });

  await p.close();

  /* ============ B. ADMIN TABS ============ */
  const ap = await newPage(browser, { width: 1600, height: 950 });
  ap.clearLogs();
  const ame = await login(ap, ADMIN.u, ADMIN.p);
  log({ test: 'login-admin', role: ame.user?.role, hash: await ap.eval('location.hash') });

  const TABS = ['dashboard', 'orders', 'topups', 'products', 'keys', 'licenses', 'users', 'coupons', 'settings', 'logs'];
  for (const tab of TABS) {
    ap.clearLogs();
    await ap.goto(PROD + '/#/admin?tab=' + tab);
    await ap.waitIdle(1500, 20000);
    await sleep(800);
    const a = await ap.eval(AUDIT);
    // count rendered rows / key nodes
    const stat = await ap.eval(`(()=>{
      const rows = document.querySelectorAll('#admin-content tbody tr').length;
      const cards = document.querySelectorAll('#admin-content .stat-card').length;
      const inputs = document.querySelectorAll('#admin-content input, #admin-content select, #admin-content textarea').length;
      const emptyState = document.querySelectorAll('#admin-content .empty-state').length;
      return { rows, cards, inputs, emptyState };
    })()`);
    log({
      test: 'admin-tab-' + tab, ...stat,
      jsErrors: ap.errors.map(e => (e.desc || e.text || '').slice(0, 200)),
      consoleErr: ap.logs.filter(l => l.type === 'error' || l.type === 'log.error').map(l => l.text.slice(0, 200)),
      httpErr: ap.httpErrors.map(h => h.status + ' ' + h.url.replace(PROD, '')).slice(0, 6),
      sentinel: a.sentinel, overflowX: a.overflowX, textSnip: a.text.slice(0, 240).replace(/\n+/g, ' | '),
    });
    await ap.screenshot(`qa/shots/admin-${tab}.png`, { fullPage: true });
  }

  await ap.close();
  await browser.ws.close();
  await b.close();
  writeFileSync('qa/results-auth.json', JSON.stringify(out, null, 2));
  console.log('done');
})();
