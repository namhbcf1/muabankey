import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9408, headless: true, width: 1500, height: 950 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1500, height: 950 });

await p.goto(PROD + '/#/login');
let ok = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  ok = await p.eval(`!!(document.querySelector('input[name=email]') && document.querySelector('input[name=password]'))`).catch(() => false);
  if (ok) break;
}
console.log('form ready:', ok);
await sleep(500);
const sub = await p.eval(`(() => {
  const u = document.querySelector('input[name=email]'); const pw = document.querySelector('input[name=password]');
  if (!u || !pw) return 'still-null';
  const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  d.set.call(u,'namhbcf'); u.dispatchEvent(new Event('input',{bubbles:true}));
  d.set.call(pw,'namhbcf123'); pw.dispatchEvent(new Event('input',{bubbles:true}));
  const btn = document.querySelector('#login-submit') || document.querySelector('form button[type=submit]');
  if (!btn) return 'no-btn';
  btn.click(); return 'ok';
})()`).catch(e => 'ERR ' + e.message);
console.log('submit:', sub);
await sleep(4500);
console.log('isAdmin:', await p.eval(`/Quản trị hệ thống/.test(document.body.innerText)`));

const tab = async (t) => { await p.eval(`(()=>{const el=document.querySelector('[data-tab="${t}"]'); if(el) el.click(); return 1})()`); await sleep(2500); };

// ===== SEARCH FILTER TEST per tab =====
for (const t of ['trial', 'users', 'licenses', 'orders']) {
  await tab(t);
  const before = await p.eval(`document.querySelectorAll('tbody tr').length`);
  const typed = await p.eval(`(() => {
    const inp = document.querySelector('input[placeholder*="ìm"], input[type=search]');
    if (!inp) return 'none';
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    d.set.call(inp, 'zzzznomatch999');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(2500);
  const after = await p.eval(`({rows: document.querySelectorAll('tbody tr').length, empty: /Không tìm thấy|không có|Trống/i.test(document.querySelector('tbody')?.innerText||'')})`);
  console.log(`TAB ${t}: rows ${before} -> ${after.rows} | typed=${typed} | emptyMsg=${after.empty}`);
  // clear
  await p.eval(`(() => { const inp = document.querySelector('input[placeholder*="ìm"], input[type=search]'); if(inp){const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value'); d.set.call(inp,''); inp.dispatchEvent(new Event('input',{bubbles:true}));} return 1 })()`);
  await sleep(1200);
}

// ===== TRIAL RESET BUTTON =====
await tab('trial');
const resetRes = await p.eval(`(async () => {
  const row = document.querySelector('tbody tr');
  const name = row ? row.innerText.replace(/\\s+/g,' ').slice(0,60) : null;
  const btn = row ? [...row.querySelectorAll('button')].find(b=>/Reset/.test(b.textContent)) : null;
  if (!btn) return { err: 'no reset btn' };
  btn.click();
  await new Promise(r=>setTimeout(r,900));
  const ov = document.querySelector('.modal-overlay');
  return { name, modalOpened: !!ov, modalText: ov ? ov.innerText.slice(0,250) : null };
})()`);
console.log('\nTRIAL RESET click:', JSON.stringify(resetRes, null, 1));
// confirm reset if dialog
const confirmed = await p.eval(`(async () => {
  const ov = document.querySelector('.modal-overlay');
  if (!ov) return 'no-modal';
  const y = [...ov.querySelectorAll('button')].find(b=>/Xác nhận|Đồng ý|^Reset$|Có/.test(b.textContent.trim()));
  if (!y) return 'no-confirm-btn: ' + [...ov.querySelectorAll('button')].map(b=>b.textContent.trim()).join('|');
  y.click();
  await new Promise(r=>setTimeout(r,2500));
  const t = document.body.innerText;
  return { toast: document.querySelector('[class*=toast]')?.innerText || null, hasErr: /Lỗi|thất bại/i.test(t) };
})()`);
console.log('TRIAL RESET confirm:', JSON.stringify(confirmed));

// ===== EMAIL/VALUE ENCODING SCAN IN DOM =====
await tab('logs');
const encScan = await p.eval(`(() => {
  const t = document.body.innerText;
  return {
    mojibake: (t.match(/Ã.|Â.|Ä./g)||[]).slice(0,10),
    replacement: (t.match(/\\uFFFD/g)||[]).length,
    hasUndefined: /undefined|NaN|\\[object Object\\]/.test(t),
    sample: t.slice(0,250)
  };
})()`);
console.log('\nENCODING scan (admin logs):', JSON.stringify(encScan, null, 1));

await p.close(); await b.close();
console.log('DONE');
