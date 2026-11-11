import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9407, headless: true, width: 1500, height: 950 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1500, height: 950 });

await p.goto(PROD + '/#/login');
await p.waitFor(`!!document.querySelector('#password')`, 20000);
await sleep(800);
const dbg = await p.eval(`(() => {
  const u = document.querySelector('#email');
  const pw = document.querySelector('#password');
  return { u: u ? u.tagName + '/' + u.type + '/' + (u.name||'') : 'null', pw: pw ? pw.tagName + '/' + pw.type : 'null' };
})()`);
console.log('login fields:', JSON.stringify(dbg));
const loginRes = await p.eval(`(() => {
  const u = document.querySelector('input#email') || document.querySelector('input[name=email]');
  const pw = document.querySelector('input#password') || document.querySelector('input[name=password]');
  if (!u || !pw) return 'no-inputs';
  const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  d.set.call(u, 'namhbcf');
  u.dispatchEvent(new Event('input', { bubbles: true }));
  d.set.call(pw, 'namhbcf123');
  pw.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = document.querySelector('form button[type=submit]') || document.querySelector('form .btn-primary');
  if (!btn) return 'no-submit';
  btn.click();
  return 'ok';
})()`);
console.log('login submit:', loginRes);
await sleep(4000);
const isAdmin = await p.eval(`/Quản trị hệ thống/.test(document.body.innerText)`);
console.log('isAdmin:', isAdmin);
if (!isAdmin) { await p.close(); await b.close(); process.exit(1); }

async function tab(t) {
  await p.eval(`(()=>{const el=document.querySelector('[data-tab="${t}"]'); if(el) el.click(); return 1})()`);
  await sleep(2400);
}

// ---- Settings tab: read all values, then test "Lưu" ----
await tab('settings');
const settingsState = await p.eval(`(() => {
  const inputs = [...document.querySelectorAll('input, select')].map(i=>({n:i.name||i.id, t:i.type, v:i.value}));
  const btns = [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(x=>x&&x.length<30);
  return { inputs: inputs.slice(0,25), btns: [...new Set(btns)].slice(0,20) };
})()`);
console.log('SETTINGS inputs:', JSON.stringify(settingsState.inputs, null, 1));
console.log('SETTINGS buttons:', JSON.stringify(settingsState.btns));

// ---- Trial tab: check action buttons exist ----
await tab('trial');
const trialBtns = await p.eval(`(() => {
  const rows = [...document.querySelectorAll('tbody tr')].slice(0,3);
  return {
    rowCount: document.querySelectorAll('tbody tr').length,
    buttonsInRow: rows[0] ? [...rows[0].querySelectorAll('button')].map(b=>b.textContent.trim()) : [],
    allButtons: [...new Set([...document.querySelectorAll('button')].map(b=>b.textContent.trim()))].filter(Boolean).slice(0,25),
    searchInput: !!document.querySelector('input[type=search], input[placeholder*="ìm"]'),
  };
})()`);
console.log('\nTRIAL tab:', JSON.stringify(trialBtns, null, 1));

// test search input in trial tab
const searchTest = await p.eval(`(() => {
  const inp = document.querySelector('input[placeholder*="ìm"], input[type=search]');
  if (!inp) return 'no-search';
  const setVal=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  setVal(inp, 'zzzznonexistent');
  return 'typed';
})()`);
await sleep(1500);
const afterSearch = await p.eval(`(() => ({ rows: document.querySelectorAll('tbody tr').length, txt: document.querySelector('tbody')?.innerText.slice(0,200) }))()`);
console.log('SEARCH test:', searchTest, '->', JSON.stringify(afterSearch));

// ---- Orders tab: filter + action buttons ----
await tab('orders');
const orderInfo = await p.eval(`(() => ({
  rows: document.querySelectorAll('tbody tr').length,
  filters: [...document.querySelectorAll('select, [data-filter]')].map(e=>e.tagName+':'+(e.value||'')),
  rowButtons: document.querySelector('tbody tr') ? [...document.querySelector('tbody tr').querySelectorAll('button')].map(b=>b.textContent.trim()) : []
}))()`);
console.log('\nORDERS:', JSON.stringify(orderInfo, null, 1));

// ---- Users tab: buttons ----
await tab('users');
const userInfo = await p.eval(`(() => ({
  rows: document.querySelectorAll('tbody tr').length,
  rowButtons: document.querySelector('tbody tr') ? [...document.querySelector('tbody tr').querySelectorAll('button')].map(b=>b.textContent.trim()) : [],
}))()`);
console.log('\nUSERS:', JSON.stringify(userInfo));

// ---- Whitelist tab: add dialog ----
await tab('whitelist');
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/\\+ Thêm|Thêm/.test(x.textContent)); if(b) b.click(); return 1})()`);
await sleep(1500);
const wlModal = await p.eval(`(() => {
  const ov = document.querySelector('.modal-overlay');
  if (!ov) return { modal: false };
  return { modal: true, title: ov.querySelector('.modal-title')?.innerText, text: ov.innerText.slice(0,300),
    selects: [...ov.querySelectorAll('select')].map(s=>({v:s.value, opts:[...s.options].map(o=>o.value)})),
    inputs: [...ov.querySelectorAll('input')].map(i=>({n:i.name||i.id, ph:i.placeholder, t:i.type})) };
})()`);
console.log('\nWHITELIST add modal:', JSON.stringify(wlModal, null, 1));
await p.screenshot('_qa_shots/admin-whitelist-modal.png');

// close
await p.eval(`(()=>{const ov=document.querySelector('.modal-overlay'); if(ov){const c=ov.querySelector('[data-close], .btn-ghost'); if(c)c.click(); else ov.remove();} return 1})()`);

// ---- Products tab: open "Thêm sản phẩm" ----
await tab('products');
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Thêm sản phẩm/.test(x.textContent)); if(b) b.click(); return 1})()`);
await sleep(1500);
const prodModal = await p.eval(`(() => {
  const ov = document.querySelector('.modal-overlay');
  if (!ov) return { modal: false };
  return { modal: true, title: ov.querySelector('.modal-title')?.innerText,
    fields: [...ov.querySelectorAll('input,select,textarea')].map(i=>i.name||i.id||i.placeholder).slice(0,20) };
})()`);
console.log('\nPRODUCTS add modal:', JSON.stringify(prodModal, null, 1));
await p.eval(`(()=>{document.querySelectorAll('.modal-overlay').forEach(o=>o.remove()); return 1})()`);

// ---- License tab: create form ----
await tab('licenses');
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Tạo$/.test(x.textContent.trim())); if(b) b.click(); return 1})()`);
await sleep(2500);
const licCreate = await p.eval(`(() => {
  const t = document.body.innerText;
  const m = t.match(/Đã tạo[^\\n]{0,80}|QA[0-9A-Z-]{8,}|Lỗi[^\\n]{0,60}/);
  return { feedback: m ? m[0] : null, toast: document.querySelector('[class*=toast]')?.innerText || null };
})()`);
console.log('\nLICENSE create (default fields):', JSON.stringify(licCreate));

console.log('\nJS ERRORS total:', p.errors.length, JSON.stringify(p.errors.slice(0,5).map(e=>(e.desc||e.text||'').slice(0,150))));
console.log('HTTP ERRORS:', JSON.stringify(p.httpErrors.slice(0,8)));
await p.close(); await b.close();
console.log('DONE');
