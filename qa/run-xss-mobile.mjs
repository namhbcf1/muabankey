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
  await page.waitIdle(1400, 25000);
}
async function login(page, account, password) {
  await hardGoto(page, '/login');
  await page.waitFor(`!!document.querySelector('#login-form')`);
  await page.eval(`(()=>{document.querySelector('#lg-email').value=${JSON.stringify(account)};
    document.querySelector('#lg-pwd').value=${JSON.stringify(password)};
    document.querySelector('#login-form').requestSubmit(); return true;})()`);
  await sleep(2600);
}

(async () => {
  const b = await launch({ port: 9336 });
  const browser = await connect(b.port);

  /* ---------- 1. XSS via admin users tab (DB has <script>alert(1)</script> names) ---------- */
  const p = await newPage(browser, { width: 1600, height: 950 });
  await login(p, 'namhbcf', 'namhbcf123');
  await hardGoto(p, '/admin?tab=users');
  await sleep(1500);
  const xss = await p.eval(`(()=>{
    const rows=[...document.querySelectorAll('#admin-content tbody tr')];
    const bad=rows.filter(r=>r.textContent.includes('<script>'));
    const injected=document.querySelectorAll('#admin-content script').length;
    return { rows:rows.length, rowsWithLiteralScriptText:bad.length,
      sample: bad[0]? bad[0].querySelectorAll('td')[1].innerHTML : null,
      scriptTagsInjected: injected,
      dialogs: window.__xssFired||false };
  })()`);
  log({ test: 'C28-xss-admin-users', ...xss, browserDialogs: p.dialogs });

  /* ---------- 2. status 'processing' missing from STATUS_MAP ---------- */
  const proc = await p.eval(`fetch('/api/admin/orders?status=processing',{credentials:'same-origin'}).then(r=>r.json()).then(j=>({n:j.orders.length, s:j.orders.map(o=>o.status)}))`);
  log({ test: 'C-status-processing-api', ...proc });

  // find order with processing and check rendering
  await hardGoto(p, '/admin?tab=orders');
  await sleep(1200);
  const procRow = await p.eval(`(()=>{
    const rows=[...document.querySelectorAll('#admin-content tbody tr')];
    const r=rows.find(x=>x.textContent.includes('processing'));
    return r? r.innerText.replace(/\\n/g,' | ') : null;
  })()`);
  log({ test: 'C-status-processing-adminrow', row: procRow });

  await p.close();

  /* ---------- 3. /orders page user: check status rendering for all statuses ---------- */
  const up = await newPage(browser, { width: 1440, height: 900 });
  await login(up, 'demo', 'Demo@123456');
  await hardGoto(up, '/orders');
  await sleep(2000);
  const ord = await up.eval(`(()=>{
    const panels=[...document.querySelectorAll('.panel')];
    const pills=[...document.querySelectorAll('.pill')].map(x=>x.innerText.trim());
    return { panelCount: panels.length, pills: [...new Set(pills)],
      text: (document.querySelector('#orders-content')?.innerText||'').slice(0,600).replace(/\\n+/g,' | ') };
  })()`);
  log({ test: 'A-orders-user', ...ord });

  /* ---------- 4. dates / license expiry formatting ---------- */
  await hardGoto(up, '/licenses');
  await sleep(2000);
  const lic = await up.eval(`(()=>{
    const t=(document.querySelector('#lic-content')?.innerText||'');
    return { text: t.slice(0,900).replace(/\\n+/g,' | ') };
  })()`);
  log({ test: 'A-licenses-user', ...lic });

  /* ---------- 5. wallet ---------- */
  await hardGoto(up, '/wallet');
  await sleep(2000);
  const wal = await up.eval(`(()=>{
    const t=(document.querySelector('#wallet-content')?.innerText||'');
    return { text: t.slice(0,700).replace(/\\n+/g,' | '),
      amt: document.querySelector('#topup-amount')?.value };
  })()`);
  log({ test: 'A-wallet-user', ...wal });
  // topup form validation: type 1 digit
  const val = await up.eval(`(()=>{
    const i=document.querySelector('#topup-amount');
    i.value='1'; i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#btn-create-topup').click();
    return i.value;
  })()`);
  await sleep(900);
  const toasts = await up.eval(`[...document.querySelectorAll('.toast-wrap .toast')].map(x=>x.innerText.replace(/\\n/g,' '))`);
  log({ test: 'A-wallet-topup-min', inputAfter: val, toasts });

  /* ---------- 6. account page: name with special chars ---------- */
  await hardGoto(up, '/account');
  await sleep(1800);
  const acc = await up.eval(`(()=>{
    const t=(document.querySelector('#account-content')?.innerText||'');
    return { text: t.slice(0,700).replace(/\\n+/g,' | '),
      headerAvatar: document.querySelector('.icon-btn span')?.textContent };
  })()`);
  log({ test: 'A-account-user', ...acc });

  /* ---------- 7. mobile admin table horizontal scroll ---------- */
  await up.close();
  const mp = await newPage(browser, { width: 375, height: 812, mobile: true });
  await login(mp, 'namhbcf', 'namhbcf123');
  for (const tab of ['orders', 'licenses', 'users', 'logs', 'dashboard', 'settings']) {
    await hardGoto(mp, '/admin?tab=' + tab);
    await sleep(1400);
    const m = await mp.eval(`(()=>{
      const de=document.documentElement;
      const tw=document.querySelector('#admin-content .table-wrap');
      const nav=document.querySelector('.admin-nav');
      return {
        pageOverflow: de.scrollWidth-de.clientWidth,
        tableScrollW: tw? tw.scrollWidth : null,
        tableClientW: tw? tw.clientWidth : null,
        tableScrollable: tw? tw.scrollWidth>tw.clientWidth+1 : null,
        navScroll: nav? {sw:nav.scrollWidth, cw:nav.clientWidth, ox:getComputedStyle(nav).overflowX} : null,
        wideEls: (()=>{const vw=de.clientWidth;const r=[];document.querySelectorAll('#admin-content *').forEach(el=>{const b=el.getBoundingClientRect();if(b.width>0&&b.right>vw+2){const cs=getComputedStyle(el);if(cs.position==='fixed')return;r.push(el.tagName+'.'+(el.className||'').toString().slice(0,30)+' r='+Math.round(b.right));}});return r.slice(0,6);})(),
      };
    })()`);
    log({ test: 'D-mobile-admin-' + tab, ...m });
    await mp.screenshot(`qa/shots/m-admin-${tab}.png`, { fullPage: true });
  }
  await mp.close();

  await browser.ws.close();
  await b.close();
  writeFileSync('qa/results-xss-mobile.json', JSON.stringify(out, null, 2));
  console.log('done');
})();
