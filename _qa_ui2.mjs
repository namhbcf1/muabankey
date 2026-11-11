import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9402, headless: true, width: 1440, height: 900 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1440, height: 900 });

const R = [];

async function go(hash, waitMs = 2000) {
  p.clearLogs();
  await p.goto(PROD + '/' + hash);
  await sleep(waitMs);
  return {
    hash,
    txtLen: await p.eval('document.body.innerText.length').catch(()=>-1),
    bodyLen: await p.eval('document.body.innerHTML.length').catch(()=>-1),
    boot: await p.eval(`!!document.querySelector('.boot-screen')`).catch(()=>null),
    notFound: await p.eval(`/404|Không tìm thấy trang/i.test(document.body.innerText)`).catch(()=>null),
    jsErrors: p.errors.length,
    jsErrDetail: p.errors.slice(0,3).map(e=>e.desc||e.text),
    httpErr: p.httpErrors.filter(x=>!/favicon/.test(x.url)).slice(0,5).map(x=>x.status+' '+x.url),
    reqFail: p.reqFailed.slice(0,3).map(x=>x.err+' '+x.type),
  };
}

// ---------- MODAL TEST (precise) ----------
await p.goto(PROD + '/');
await p.waitIdle(1500);
await p.eval(`(() => { document.querySelectorAll('.modal-overlay').forEach(e=>e.remove()); const x=document.querySelector('[data-trial-kind="1h"]'); x.click(); return 1; })()`);
await sleep(3000);
const modal = await p.eval(`(() => {
  const ov = document.querySelector('.modal-overlay');
  if (!ov) return { present: false, bodyHasCurl: /curl -L/i.test(document.body.innerText) };
  const t = ov.innerText;
  return {
    present: true,
    title: ov.querySelector('.modal-title')?.innerText,
    hasCopyBtn: !!ov.querySelector('[data-copycmd]'),
    hasCurl: /curl -L/i.test(t),
    hasTrialKeyMention: /trial-key/i.test(t),
    keyShown: (t.match(/TR-[A-Z0-9-]+/)||[])[0],
    quotaShown: (t.match(/Còn \\d+\\/\\d+ lượt/)||[])[0],
    text: t.slice(0,700),
  };
})()`);
console.log('=== A2 MODAL DETAIL ===');
console.log(JSON.stringify(modal, null, 1));
R.push(modal);
await p.screenshot('_qa_shots/02b-trial-modal.png', { fullPage: false });

// Click "Copy lệnh" and read clipboard
const copyTest = await p.eval(`(async () => {
  const ov = document.querySelector('.modal-overlay');
  const btn = ov.querySelector('[data-copycmd]');
  if (!btn) return 'no-copy-btn';
  btn.click();
  await new Promise(r=>setTimeout(r,600));
  const toastEl = document.querySelector('.toast, [class*=toast]');
  return { toast: toastEl ? toastEl.innerText : null };
})()`);
console.log('=== COPY BTN ===', JSON.stringify(copyTest));

// close modal by clicking [data-close]
await p.eval(`(()=>{const ov=document.querySelector('.modal-overlay'); const c=ov&&ov.querySelector('[data-close]'); if(c){c.click();return 1} return 0})()`);
await sleep(600);

// ---------- PAGE SWEEP ----------
const routes = [
  ['#/', 'home'],
  ['#/products', 'products'],
  ['#/products?category=license-xarena', 'products-xarena'],
  ['#/product/license-xarena-thang', 'product-license-month'],
  ['#/product/windows-11-pro', 'product-win11'],
  ['#/product/khong-ton-tai-xyz', 'product-missing'],
  ['#/orders', 'orders-guest'],
  ['#/wallet', 'wallet-guest'],
  ['#/account', 'account-guest'],
  ['#/licenses', 'licenses-guest'],
  ['#/login', 'login'],
  ['#/register', 'register'],
  ['#/support', 'support'],
  ['#/admin', 'admin-guest'],
  ['#/khong-ton-tai', '404'],
];

console.log('\n=== PAGE SWEEP (desktop 1440x900) ===');
for (const [h, name] of routes) {
  const r = await go(h, 2200);
  r.name = name;
  R.push(r);
  console.log(JSON.stringify(r));
}

// mobile
const pm = await newPage(s, { width: 390, height: 844, mobile: true });
console.log('\n=== MOBILE 390x844 ===');
const mres = [];
for (const [h, name] of routes) {
  pm.clearLogs();
  await pm.goto(PROD + '/' + h);
  await sleep(2200);
  const info = await pm.eval(`(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth > de.clientWidth + 2;
    const wide = [];
    document.querySelectorAll('body *').forEach(el=>{
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 8 && getComputedStyle(el).position!=='fixed') {
        wide.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,50), right: Math.round(r.right) });
      }
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowX, wideCount: wide.length, wideSample: wide.slice(0,4) };
  })()`).catch(e=>({err:String(e)}));
  const rec = { name, ...info, jsErrors: pm.errors.length, jsErr: pm.errors.slice(0,2).map(e=>e.desc||e.text) };
  mres.push(rec);
  console.log(JSON.stringify(rec));
  if (overflowX = info.overflowX) await pm.screenshot(`_qa_shots/m-${name}.png`, { fullPage: false });
}
await pm.close();

console.log('\n=== DONE ===');
await p.close(); await b.close();
